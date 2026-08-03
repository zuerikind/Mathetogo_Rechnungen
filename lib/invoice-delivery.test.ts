import { describe, expect, it } from "vitest";
import { DELIVERED_INVOICE_WHERE, isDelivered } from "./invoice-delivery";

const at = new Date("2026-08-02T08:57:20Z");
const none = { sentAt: null, paidAt: null, firstDownloadedAt: null };

describe("isDelivered", () => {
  it("is false only while nothing has gone out", () => {
    expect(isDelivered(none)).toBe(false);
  });

  it("counts a download as delivered, not just sent or paid", () => {
    expect(isDelivered({ ...none, firstDownloadedAt: at })).toBe(true);
    expect(isDelivered({ ...none, sentAt: at })).toBe(true);
    expect(isDelivered({ ...none, paidAt: at })).toBe(true);
  });

  it("keeps the Prisma filter in sync with the predicate", () => {
    // NOT(alle null) muss dieselben drei Felder pruefen wie isDelivered.
    expect(Object.keys(DELIVERED_INVOICE_WHERE.NOT).sort()).toEqual(Object.keys(none).sort());
  });
});
