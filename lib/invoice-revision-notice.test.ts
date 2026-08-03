import { describe, expect, it } from "vitest";
import { getRevisionNotice } from "./invoice-format";

describe("getRevisionNotice", () => {
  it("stays silent on the first issue — it replaces nothing", () => {
    expect(getRevisionNotice(1, null)).toBeNull();
    expect(getRevisionNotice(1, new Date("2026-08-02T08:57:20Z"))).toBeNull();
  });

  it("names the replaced delivery, because the invoice number stays the same", () => {
    expect(getRevisionNotice(2, new Date("2026-08-02T08:57:20Z"))).toBe(
      "Revision 2 — ersetzt die Fassung vom 2.8.2026"
    );
    expect(getRevisionNotice(3, new Date("2026-08-02T08:57:20Z"))).toBe(
      "Revision 3 — ersetzt die Fassung vom 2.8.2026"
    );
  });

  it("still marks the revision when no delivery date is known", () => {
    expect(getRevisionNotice(2, null)).toBe("Revision 2 — ersetzt die vorherige Fassung");
  });
});
