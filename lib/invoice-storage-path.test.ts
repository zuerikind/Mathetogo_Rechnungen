import { describe, expect, it } from "vitest";
import { invoiceStoragePath } from "./invoice-storage-path";

const STUDENT = "cmo8rn87o000tarp1t2fat2fd";

describe("invoiceStoragePath", () => {
  it("keeps the historical path for revision 1 — the existing files must stay reachable", () => {
    const legacy = `2026-07-${STUDENT}.pdf`;
    expect(invoiceStoragePath(2026, 7, STUDENT)).toBe(legacy);
    expect(invoiceStoragePath(2026, 7, STUDENT, 1)).toBe(legacy);
  });

  it("writes every later revision beside the original, never over it", () => {
    expect(invoiceStoragePath(2026, 7, STUDENT, 2)).toBe(`2026-07-${STUDENT}-r2.pdf`);
    expect(invoiceStoragePath(2026, 7, STUDENT, 3)).toBe(`2026-07-${STUDENT}-r3.pdf`);
    const all = [1, 2, 3].map((r) => invoiceStoragePath(2026, 7, STUDENT, r));
    expect(new Set(all).size).toBe(3);
  });

  it("pads the month", () => {
    expect(invoiceStoragePath(2026, 4, STUDENT)).toBe(`2026-04-${STUDENT}.pdf`);
  });
});
