import { describe, expect, it } from "vitest";
import {
  dueReminderStage,
  formatBetrag,
  formatFaelligkeit,
  formatPeriode,
  renderReminder,
  type ReminderTokenInput,
} from "./reminder-tokens";

const base: ReminderTokenInput = {
  name: "Aiyana",
  totalCHF: 1234.5,
  invoiceNumber: "2026-0042",
  month: 6, // Juni
  year: 2026,
};

describe("formatBetrag", () => {
  it("uses apostrophe thousands and two decimals, no currency symbol", () => {
    expect(formatBetrag(1234.5)).toBe("1'234.50");
    expect(formatBetrag(1000000)).toBe("1'000'000.00");
    expect(formatBetrag(9.9)).toBe("9.90");
    expect(formatBetrag(0)).toBe("0.00");
  });
});

describe("formatPeriode", () => {
  it("returns the German month name alone, no year", () => {
    expect(formatPeriode(2026, 6)).toBe("Juni");
    expect(formatPeriode(2026, 12)).toBe("Dezember");
  });
});

describe("formatFaelligkeit", () => {
  it("is the 15th of the following month as DD.MM.YYYY", () => {
    expect(formatFaelligkeit(2026, 6)).toBe("15.07.2026");
  });
  it("rolls over the year for December periods", () => {
    expect(formatFaelligkeit(2026, 12)).toBe("15.01.2027");
  });
});

describe("dueReminderStage", () => {
  it("maps days overdue to the due stage at the 0/10/20 thresholds", () => {
    expect(dueReminderStage(-1)).toBeNull();
    expect(dueReminderStage(0)?.stage).toBe(1);
    expect(dueReminderStage(9)?.stage).toBe(1);
    expect(dueReminderStage(10)?.stage).toBe(2);
    expect(dueReminderStage(19)?.stage).toBe(2);
    expect(dueReminderStage(20)?.stage).toBe(3);
  });
});

describe("renderReminder", () => {
  it("substitutes every known token", () => {
    const out = renderReminder(
      "{name} · {betrag} · {rechnungsnummer} · {faelligkeit} · {periode}",
      base
    );
    expect(out).toBe("Aiyana · 1'234.50 · 2026-0042 · 15.07.2026 · Juni");
  });

  it("replaces ALL occurrences of a repeated token, not just the first", () => {
    expect(renderReminder("{periode}/{periode}/{periode}", base)).toBe("Juni/Juni/Juni");
  });

  it("leaves unknown tokens as literal text", () => {
    expect(renderReminder("Hallo {name}, {unbekannt} bleibt.", base)).toBe(
      "Hallo Aiyana, {unbekannt} bleibt."
    );
  });
});
