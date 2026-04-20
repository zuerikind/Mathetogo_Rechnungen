import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/InvoicePDF";
import { InvoicePayload } from "@/lib/invoice";

export async function buildInvoicePdf(payload: InvoicePayload): Promise<Buffer> {
  const pdf = <InvoicePDF payload={payload} issueDate={new Date()} />;
  const data = await renderToBuffer(pdf);
  return Buffer.from(data);
}
