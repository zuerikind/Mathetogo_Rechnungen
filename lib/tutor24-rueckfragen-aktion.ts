/**
 * Knopf einer Rueckfrage anwenden — gleich fuer Telegram (scripts/telegram-bot.mts) und /kurse (app/api/tutor24/batch).
 * Senden = freigeben (gesendet wird im naechsten erlaubten Lauf), Ueberspringen = Liste ki_verbesserungen.md,
 * du/Sie = Text mit der anderen Anrede neu erstellen (gleiche Pruefung wie beim Batch) und nochmals zeigen.
 */
import { composeFirstMessage } from "./tutor24";
import { inSendWindow } from "./tutor24-autopilot";
import { addresseeFor } from "./tutor24-batch";
import { earliestNext } from "./tutor24-lock";
import { SAMMEL_MIN, anredeSetzen, findeRueckfrage, freigeben, rueckfrageKnoepfe, rueckfrageText, ueberspringen } from "./tutor24-rueckfragen";

export type RueckfrageAktion = "send" | "skip" | "du" | "sie";
const hhmm = (d: Date) => d.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });

export async function rueckfrageAktion(aktion: RueckfrageAktion, id: string, now = new Date()): Promise<{ text: string; knoepfe?: object }> {
  const r = findeRueckfrage(id);
  if (!r) return { text: `Rückfrage ${id} nicht (mehr) bekannt.` };
  if (r.status === "freigegeben" && aktion !== "skip") return { text: `„${r.titel}“ ist schon freigegeben${r.probe ? " (Probe)" : ""}.` };
  if (r.status === "gesendet") return { text: `„${r.titel}“ ist schon gesendet.` };
  if (r.status === "uebersprungen") return { text: `„${r.titel}“ wurde schon übersprungen.` };

  // Probe: Knoepfe wirken auf die Probe-Rueckfrage, aber nichts wird gesendet, gezaehlt oder notiert
  if (r.probe && aktion === "send") {
    freigeben(id, now);
    return { text: `🧪 PROBE: „${r.titel}“ wäre jetzt freigegeben und würde im nächsten erlaubten Lauf gesendet (10 min nach dem letzten Knopf, 2 h Abstand, 8–20 Uhr, Tageslimit). Im Probemodus wird nichts gesendet.` };
  }
  if (r.probe && aktion === "skip") {
    ueberspringen(id, now);
    return { text: `🧪 PROBE: „${r.titel}“ wäre übersprungen und in ki_verbesserungen.md notiert. Im Probemodus wird nichts notiert.` };
  }
  if (aktion === "send") {
    const f = freigeben(id, now);
    if (!f || f.status !== "freigegeben") return { text: `„${r.titel}“ konnte nicht freigegeben werden (Stand: ${r.status}).` };
    const gap = earliestNext(now);
    const soonest = new Date(Math.max(now.getTime() + SAMMEL_MIN * 60_000, gap?.getTime() ?? 0));
    const wann = inSendWindow(soonest) ? `frühestens um ${hhmm(soonest)}` : "morgen ab 8:00";
    return { text: `✅ Freigegeben: „${r.titel}“. Gesendet wird im nächsten erlaubten Lauf, ${wann} (2 h Abstand, 8–20 Uhr, Tageslimit). Vorher wird nochmals geprüft, dass niemand doppelt angeschrieben wird.` };
  }
  if (aktion === "skip") {
    ueberspringen(id, now);
    return { text: `⏭ Übersprungen: „${r.titel}“. In ki_verbesserungen.md notiert — sag mir bei Gelegenheit, was nicht gepasst hat.` };
  }
  // Anrede umstellen: du oder Sie (neutral); Eltern-Fassungen gibt es auf /kurse im Batch
  if (r.sprache !== "de") return { text: "Anrede umstellen geht nur bei deutschen Nachrichten." };
  const wahl = aktion === "du" ? "du" : "unklar";
  const composed = await composeFirstMessage(r.info, () => {}, now, "de", addresseeFor(wahl));
  if (composed.problem) return { text: `Neuer Text mit Anrede „${aktion === "du" ? "du" : "Sie"}“ besteht die Prüfung nicht (${composed.problem}). Anrede nicht geändert.` };
  const neu = anredeSetzen(id, wahl, composed.text);
  if (!neu) return { text: `Rückfrage ${id} nicht (mehr) bekannt.` };
  return { text: rueckfrageText({ ...neu, grund: `${neu.grund} · Anrede umgestellt auf ${aktion === "du" ? "du" : "Sie"}` }, 0).replace(/^❓ Rückfrage 0\/\d+/, "❓ Rückfrage, neuer Text"), knoepfe: rueckfrageKnoepfe(neu) };
}
