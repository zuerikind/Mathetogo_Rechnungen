import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";
import { InvoicePayload } from "@/lib/invoice";

function sniffImageMime(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString("ascii") === "RIFF" &&
    buf.slice(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

type RasterImage = {
  dataUrl: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
};

function readPngDimensions(buf: Buffer): { widthPx: number; heightPx: number } | undefined {
  if (buf.length < 24) return undefined;
  // PNG signature + first chunk must be IHDR
  let o = 8;
  const len = buf.readUInt32BE(o);
  o += 4;
  const type = buf.toString("ascii", o, o + 4);
  o += 4;
  if (type !== "IHDR" || len < 13) return undefined;
  const widthPx = buf.readUInt32BE(o);
  const heightPx = buf.readUInt32BE(o + 4);
  return { widthPx, heightPx };
}

function readJpegDimensions(buf: Buffer): { widthPx: number; heightPx: number } | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined;
  let o = 2;
  while (o + 1 < buf.length) {
    if (buf[o] !== 0xff) {
      o += 1;
      continue;
    }
    const marker = buf[o + 1];
    o += 2;

    // Start of scan / end of image
    if (marker === 0xd9) break;
    if (marker === 0xda) break;

    if (o + 1 >= buf.length) break;
    const segLen = buf.readUInt16BE(o);
    o += 2;
    if (segLen < 2 || o + segLen - 2 > buf.length) break;

    const dataStart = o;
    const dataEnd = o + segLen - 2;
    o = dataEnd;

    // SOF0 / SOF1 / SOF2 ...
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7 ||
      marker === 0xc9 ||
      marker === 0xca ||
      marker === 0xcb ||
      marker === 0xcd ||
      marker === 0xce ||
      marker === 0xcf
    ) {
      if (dataEnd - dataStart < 7) continue;
      const precision = buf[dataStart];
      if (precision !== 8) continue;
      const heightPx = buf.readUInt16BE(dataStart + 1);
      const widthPx = buf.readUInt16BE(dataStart + 3);
      if (widthPx > 0 && heightPx > 0) return { widthPx, heightPx };
    }
  }
  return undefined;
}

function readWebpVp8Dimensions(buf: Buffer): { widthPx: number; heightPx: number } | undefined {
  // Minimal parser for lossy WebP ("VP8 ") bitstream header (not VP8L / VP8X).
  if (buf.length < 30) return undefined;
  if (buf.slice(0, 4).toString("ascii") !== "RIFF") return undefined;
  if (buf.slice(8, 12).toString("ascii") !== "WEBP") return undefined;
  let o = 12;
  while (o + 8 <= buf.length) {
    const chunkId = buf.slice(o, o + 4).toString("ascii");
    const chunkSize = buf.readUInt32LE(o + 4);
    const payloadStart = o + 8;
    const payloadEnd = payloadStart + chunkSize + (chunkSize % 2);
    if (payloadEnd > buf.length) break;

    if (chunkId === "VP8 " && payloadStart + 10 <= buf.length) {
      // https://tools.ietf.org/html/rfc6386 (frame tag + 10-byte sync code 9d 01 2a)
      const b = buf[payloadStart];
      if ((b & 0x01) !== 0) return undefined;
      if (
        buf[payloadStart + 3] !== 0x9d ||
        buf[payloadStart + 4] !== 0x01 ||
        buf[payloadStart + 5] !== 0x2a
      ) {
        return undefined;
      }
      const w = buf.readUInt16LE(payloadStart + 6) & 0x3fff;
      const h = buf.readUInt16LE(payloadStart + 8) & 0x3fff;
      if (w > 0 && h > 0) return { widthPx: w, heightPx: h };
      return undefined;
    }

    o = payloadEnd;
  }
  return undefined;
}

function readRasterImageMeta(buf: Buffer): Pick<RasterImage, "mimeType" | "widthPx" | "heightPx"> | undefined {
  const mime = sniffImageMime(buf);
  if (mime === "image/png") {
    const dims = readPngDimensions(buf);
    if (!dims) return undefined;
    return { mimeType: mime, ...dims };
  }
  if (mime === "image/jpeg") {
    const dims = readJpegDimensions(buf);
    if (!dims) return undefined;
    return { mimeType: mime, ...dims };
  }
  if (mime === "image/webp") {
    const dims = readWebpVp8Dimensions(buf);
    if (!dims) return undefined;
    return { mimeType: mime, ...dims };
  }
  return undefined;
}

function scaleToMaxWidth(widthPx: number, heightPx: number, maxWidthPt: number) {
  // Treat raster pixels as points at 1:1 unless it would overflow the printable width.
  let w = widthPx;
  let h = heightPx;
  if (w > maxWidthPt) {
    const s = maxWidthPt / w;
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  return { widthPt: w, heightPt: h };
}

async function readRasterImage(filePath: string): Promise<RasterImage | undefined> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".pdf") return undefined;

  const extMime =
    ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".webp"
        ? "image/webp"
        : ext === ".png"
          ? "image/png"
          : undefined;

  try {
    const file = await readFile(filePath);
    const mimeType = sniffImageMime(file) ?? extMime;
    if (!mimeType) return undefined;
    const meta = readRasterImageMeta(file);
    if (!meta) return undefined;
    return {
      dataUrl: `data:${mimeType};base64,${file.toString("base64")}`,
      mimeType: meta.mimeType,
      widthPx: meta.widthPx,
      heightPx: meta.heightPx,
    };
  } catch {
    return undefined;
  }
}

async function getFirstAvailableRasterImage(
  candidates: string[]
): Promise<RasterImage | undefined> {
  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.join(process.cwd(), candidate);
    const img = await readRasterImage(resolved);
    if (img) return img;
  }
  return undefined;
}

export async function buildInvoicePdf(payload: InvoicePayload): Promise<Buffer> {
  const logoSrc = (await getFirstAvailableRasterImage([
    "public/mathetogo-logo-clean.png",
    "public/mathetogo-logo.png",
  ]))?.dataUrl;

  const slip = await getFirstAvailableRasterImage([
    "public/qr-raiffeisen-payment-slip.png",
    process.env.INVOICE_PAYMENT_SLIP_PATH ?? "",
    "public/einzahlungsschein.png",
    "public/payment-slip.png",
  ].filter(Boolean));

  const maxSlipWidthPt = 515; // A4 width minus page padding (40 * 2)
  const slipDims =
    slip ? scaleToMaxWidth(slip.widthPx, slip.heightPx, maxSlipWidthPt) : undefined;

  const pdf = (
    <InvoicePDF
      payload={payload}
      issueDate={new Date()}
      logoSrc={logoSrc}
      paymentSlipSrc={slip?.dataUrl}
      paymentSlipWidthPt={slipDims?.widthPt}
      paymentSlipHeightPt={slipDims?.heightPt}
    />
  );
  const data = await renderToBuffer(pdf);
  return Buffer.from(data);
}
