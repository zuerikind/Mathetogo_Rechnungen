import { describe, expect, it } from "vitest";
import { getInvoiceDueDate, getPeriodLabel } from "./invoice-format";
import { formatFaelligkeit } from "./reminder-tokens";

/**
 * Regression: Faelligkeit und Periode haengen an der Zeitzone des Rechners.
 *
 * `new Date(year, month, 15)` nimmt die lokale Zeitzone. Auf Vercel (UTC) ging
 * das gut, im Browser eines Nutzers oestlich von Zuerich nicht: dort ist die
 * lokale Mitternacht des 15. bereits der 14. in Zuerich, und die Faelligkeit auf
 * Rechnung und Mahnung waere um einen Tag verrutscht — bei Betraegen, die genau
 * an diesem Datum haengen.
 *
 * Die Pruefungen unten legen den erzeugten Zeitpunkt fest, nicht nur seine
 * Formatierung: unter der alten Umsetzung liefert eine Maschine in Zuerich
 * 2026-08-14T22:00:00Z und faellt hier durch.
 */

/** Formatierung in einer beliebigen Zeitzone — so wie jeder Client sie sehen soll. */
const inTz = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("de-CH", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d);

describe("getInvoiceDueDate", () => {
  it("ist der 15. des Folgemonats", () => {
    expect(getInvoiceDueDate(2026, 7).toISOString()).toBe("2026-08-15T12:00:00.000Z");
    expect(getInvoiceDueDate(2026, 1).toISOString()).toBe("2026-02-15T12:00:00.000Z");
  });

  it("Dezember rollt ins Folgejahr", () => {
    expect(getInvoiceDueDate(2026, 12).toISOString()).toBe("2027-01-15T12:00:00.000Z");
  });

  it("ist in Europe/Zurich der 15., unabhaengig von der Zeitzone des Rechners", () => {
    // Das ist der eigentliche Vertrag: alle Anzeigen formatieren mit einem
    // Europe/Zurich-Formatter (invoice-format, reminder-tokens, InvoicePDF). Der
    // erzeugte Zeitpunkt darf deshalb nicht mehr davon abhaengen, wo der Code
    // laeuft — die ISO-Pruefung oben legt ihn absolut fest, diese hier das Ergebnis.
    expect(inTz(getInvoiceDueDate(2026, 7), "Europe/Zurich")).toBe("15.08.2026");
    expect(inTz(getInvoiceDueDate(2026, 12), "Europe/Zurich")).toBe("15.01.2027");
  });

  it("zeigt auch weit entfernten Betrachtern denselben Tag", () => {
    // 12:00 UTC haelt den Kalendertag von UTC-11 bis UTC+11 stabil. Mit der alten
    // lokalen Mitternacht rutschte das Datum je nach Rechner auf den 14. oder 16.
    // Jenseits von UTC+11 (Auckland) faellt jeder einzelne Zeitpunkt irgendwann
    // auf einen anderen Kalendertag — deshalb formatiert die Anwendung ueberall
    // ausdruecklich in Europe/Zurich, siehe Pruefung darueber.
    const due = getInvoiceDueDate(2026, 7);
    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Honolulu"]) {
      expect(inTz(due, tz)).toBe("15.08.2026");
    }
  });

  it("Schaltjahr-Februar bleibt unberuehrt (der 15. existiert immer)", () => {
    expect(inTz(getInvoiceDueDate(2028, 1), "Europe/Zurich")).toBe("15.02.2028");
  });
});

describe("formatFaelligkeit", () => {
  it("nutzt dieselbe Quelle wie die Rechnungs-PDF", () => {
    // {faelligkeit} in der Mahnung und das Datum auf dem PDF duerfen nie
    // auseinanderlaufen — beide kommen aus getInvoiceDueDate.
    expect(formatFaelligkeit(2026, 7)).toBe("15.08.2026");
    expect(formatFaelligkeit(2026, 12)).toBe("15.01.2027");
  });
});

describe("getPeriodLabel", () => {
  it("nennt Monat und Jahr der Rechnungsperiode", () => {
    expect(getPeriodLabel(7, 2026)).toBe("Juli 2026");
    expect(getPeriodLabel(1, 2026)).toBe("Januar 2026");
    expect(getPeriodLabel(12, 2026)).toBe("Dezember 2026");
  });

  it("kippt nicht in den Vormonat, egal wo der Client steht", () => {
    // Mit `new Date(2026, 0, 1)` zeigte ein Client in Tokio "Dezember 2025":
    // lokale Mitternacht des 1. Januar ist in Zuerich noch der 31. Dezember.
    expect(getPeriodLabel(1, 2026)).toBe("Januar 2026");
    expect(getPeriodLabel(3, 2026)).toBe("Maerz 2026".replace("Maerz", "März"));
  });
});
