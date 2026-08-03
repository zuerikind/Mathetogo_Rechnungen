/**
 * Client-seitiges Auslösen eines Rechnungs-Downloads.
 *
 * Bewusst POST: der Server hält beim ersten Download fest, dass die Rechnung
 * ausgeliefert wurde (firstDownloadedAt + Snapshot + Audit-Log). Ein GET dafür
 * war ein Fehler — Browser holen Links beim Hover/Scrollen spekulativ vor und
 * haben damit Rechnungen eingefroren, die nie jemand angeklickt hat.
 */

/** Speichert einen Blob unter dem gegebenen Namen im Download-Ordner. */
export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

/** Dateiname aus dem Content-Disposition-Header, sonst null. */
function fileNameFromResponse(res: Response): string | null {
  const header = res.headers.get("content-disposition");
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? null;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === "string" && body.error.trim().length > 0) return body.error;
  } catch {
    // Kein JSON — Standardtext.
  }
  return fallback;
}

/**
 * Lädt die Rechnungs-PDF herunter und lässt den Download serverseitig erfassen.
 * Gibt null zurück, wenn alles geklappt hat, sonst die Fehlermeldung.
 */
export async function downloadInvoicePdf(
  invoiceId: string,
  /** Ohne Angabe die aktuelle Fassung; sonst eine frueher ausgelieferte Revision. */
  revision?: number
): Promise<string | null> {
  const query = revision === undefined ? "" : `?revision=${revision}`;
  let res: Response;
  try {
    res = await fetch(`/api/invoices/${invoiceId}/download${query}`, { method: "POST" });
  } catch {
    return "Download fehlgeschlagen. Bitte erneut versuchen.";
  }
  if (!res.ok) return errorMessage(res, "Download fehlgeschlagen.");

  const blob = await res.blob();
  saveBlob(blob, fileNameFromResponse(res) ?? `rechnung-${invoiceId}.pdf`);
  return null;
}
