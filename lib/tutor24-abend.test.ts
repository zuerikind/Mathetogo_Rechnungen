import { describe, expect, it } from "vitest";
import { tagesberichtText, type Tagesdaten } from "./tutor24-abend";
import { emptyCounts, type PassLog } from "./tutor24-autopilot";

const pass = (start: string, p: Partial<PassLog> = {}): PassLog => ({
  start, ende: start, modus: "an", quelle: "plan",
  erst: { ...emptyCounts(), gesendet: 4 }, nachfassen: { ...emptyCounts(), gesendet: 1 }, antworten: 1, fehler: [], stopp: null, ...p,
});
const e = (urteil: "ok" | "auffaellig", art: "erst" | "nachfassen" = "erst", tag = "2026-11-14", probe?: boolean) =>
  ({ am: "", tag, id: "1", art, titel: "Mathe Sek", urteil, grund: urteil === "ok" ? "" : "Grammatik", probe });
const base: Tagesdaten = {
  tag: "2026-11-14", zeiten: ["10:00", "16:00"], state: { modus: "an", gestoppt: null }, verfallen: 0,
  passes: [pass("2026-11-14T09:00:30Z"), pass("2026-11-14T15:00:20Z")], agent: [e("ok"), e("auffaellig")],
};

describe("Tagesbericht (13.11.)", () => {
  it("alles gut: erste Zeile ✅, Zahlen, zurückgehalten mit Grund, beide Durchgänge ja", () => {
    const t = tagesberichtText(base);
    expect(t.split("\n")[1]).toBe("✅ Alles in Ordnung");
    expect(t).toContain("Gesendet: 8 Erst-Nachrichten, 2 Nachfassen");
    expect(t).toContain("Antworten: 2");
    expect(t).toContain("Vom Agenten zurückgehalten: 1\n• Mathe Sek: Grammatik");
    expect(t).toContain("Durchgänge: 10:00 ja, 16:00 ja");
  });

  it("fehlender Durchgang, /run zählt nicht, nachgeholt zählt", () => {
    const t = tagesberichtText({ ...base, passes: [pass("2026-11-14T09:00:30Z"), pass("2026-11-14T15:05:00Z", { quelle: "run" })] });
    expect(t).toContain("⚠️ Handlung nötig: Durchgang 16:00 ist nicht gelaufen");
    expect(t).toContain("16:00 nein");
    expect(tagesberichtText({ ...base, passes: [pass("2026-11-14T09:00:30Z"), pass("2026-11-14T16:01:00Z", { quelle: "nachgeholt" })] })).toContain("16:00 ja");
  });

  it("automatisch gestoppt → Handlung nötig; eigener /stop nicht", () => {
    expect(tagesberichtText({ ...base, state: { modus: "aus", gestoppt: { grund: "429", am: "" } } })).toContain("Automatik gestoppt (429)");
    expect(tagesberichtText({ ...base, state: { modus: "aus", gestoppt: { grund: "per Telegram /stop", am: "" } } }).split("\n")[1]).toBe("✅ Alles in Ordnung");
  });

  it("Probe: würden gesendet, nur Probe-Urteile; mehr als 2 Nachfassen zurückgehalten → Hinweis", () => {
    const pr = tagesberichtText({ ...base, state: { modus: "probe", gestoppt: null }, passes: [pass("2026-11-14T09:00:30Z", { modus: "probe", erst: { ...emptyCounts(), wuerde: 5 } })], agent: [e("ok", "erst", "2026-11-14", true)] });
    expect(pr).toContain("(PROBE)");
    expect(pr).toContain("Würden gesendet: 5 Erst-Nachrichten");
    expect(pr).toContain("Vom Agenten zurückgehalten: 0");
    const nf = tagesberichtText({ ...base, agent: [e("auffaellig", "nachfassen", "2026-11-12"), e("auffaellig", "nachfassen", "2026-11-13"), e("auffaellig", "nachfassen")] });
    expect(nf).toContain("Senden-Knopf");
  });
});
