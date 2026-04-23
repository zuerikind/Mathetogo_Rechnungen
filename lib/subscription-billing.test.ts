import { describe, it, expect } from "vitest";
import {
  getSubscriptionInvoiceLines,
  subscriptionProrationForMonth,
  subscriptionProrationYearTotal,
} from "./subscription-billing";

const sub6 = {
  id: "a",
  studentId: "s1",
  amountCHF: 40,
  billingMethod: "invoice",
  durationMonths: 6,
  startMonth: 4,
  startYear: 2026,
};

describe("getSubscriptionInvoiceLines", () => {
  it("adds full contract amount on start month for invoice billing only", () => {
    expect(getSubscriptionInvoiceLines([sub6], 2026, 4)).toEqual([
      expect.objectContaining({ amountCHF: 240, description: expect.stringContaining("6 Monate") }),
    ]);
    expect(getSubscriptionInvoiceLines([sub6], 2026, 5)).toEqual([]);
  });

  it("omits direct (Ueberweisung) from invoice", () => {
    expect(
      getSubscriptionInvoiceLines([{ ...sub6, billingMethod: "direct" }], 2026, 4)
    ).toEqual([]);
  });
});

describe("subscriptionProrationForMonth", () => {
  it("adds full CHF/month for each covered month", () => {
    expect(subscriptionProrationForMonth([sub6], 2026, 4)).toBe(40);
    expect(subscriptionProrationForMonth([sub6], 2026, 9)).toBe(40);
    expect(subscriptionProrationForMonth([sub6], 2026, 10)).toBe(0);
  });
});

describe("subscriptionProrationYearTotal", () => {
  it("sums monthly CHF across covered months", () => {
    expect(subscriptionProrationYearTotal([sub6], 2026)).toBe(240);
  });
});
