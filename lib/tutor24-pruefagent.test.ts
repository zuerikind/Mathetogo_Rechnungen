import { describe, expect, it } from "vitest";
import { agentPass, agentZaehlen, parseUrteil, pruefAgent } from "./tutor24-pruefagent";
import { agentText } from "./tutor24-abend";
import { vergleicheGesendet } from "./tutor24-followup-runner";

const ok = { urteil: "ok" as const, grund: "" };
const auff = { urteil: "auffaellig" as const, grund: "x" };
const fehler = { urteil: "fehler" as const, grund: "Prüf-Agent nicht erreichbar" };

describe("Prüf-Agent", () => {
  it("liest die Antwort", () => {
    expect(parseUrteil('{"urteil":"ok"}')).toEqual(ok);
    expect(parseUrteil('{"urteil":"auffällig","grund":"Anrede falsch"}')).toEqual({ urteil: "auffaellig", grund: "Anrede falsch" });
    expect(parseUrteil("Sieht gut aus").urteil).toBe("fehler");
  });

  it("nicht erreichbar = fehler, nie ok", async () => {
    const client = { chat: { completions: { create: async () => { throw new Error("timeout"); } } } };
    expect((await pruefAgent({ art: "erst", titel: "t", beschreibung: "", text: "x" }, client)).urteil).toBe("fehler");
  });

  it("Stopp: mehr als 4 auffällig", () => {
    const p = agentPass();
    for (let i = 0; i < 20; i++) agentZaehlen(p, ok);
    for (let i = 0; i < 4; i++) agentZaehlen(p, auff);
    expect(p.halt).toBeNull();
    agentZaehlen(p, auff);
    expect(p.aus).toBe(true);
  });

  it("Stopp: mehr als 30 % erst ab 5 geprüften", () => {
    const p = agentPass();
    agentZaehlen(p, auff);
    agentZaehlen(p, ok);
    agentZaehlen(p, ok);
    expect(p.halt).toBeNull(); // 1 von 3, aber erst 3 geprueft
    agentZaehlen(p, ok);
    agentZaehlen(p, auff); // 2 von 5 = 40 %
    expect(p.aus).toBe(true);
    const q = agentPass();
    for (const u of [auff, ok, ok, ok, ok]) agentZaehlen(q, u); // 20 %
    expect(q.halt).toBeNull();
  });

  it("zweimal nicht erreichbar → Durchgang hält an, Automatik bleibt an", () => {
    const p = agentPass();
    agentZaehlen(p, fehler);
    agentZaehlen(p, ok);
    agentZaehlen(p, fehler);
    expect(p.halt).toBeNull();
    agentZaehlen(p, fehler);
    expect(p.halt).toMatch(/zweimal/);
    expect(p.aus).toBe(false);
  });

  it("Nachkontrolle vergleicht nur Buchstaben", () => {
    const text = "Guten Tag,\n\ngerne unterstütze ich Sie. WhatsApp 078 693 68 98\n\nFreundliche Grüsse\nOmid";
    expect(vergleicheGesendet(text, ["11.11.26 10:05\nGuten Tag, \ngerne unterstütze ich Sie. WhatsApp ***\nFreundliche Grüsse Omid"]).ok).toBe(true);
    expect(vergleicheGesendet(text, ["Guten Tag, gerne unterstütze ich dich."]).ok).toBe(false);
    expect(vergleicheGesendet(text, []).hinweis).toMatch(/keine eigene/);
  });

  it("Abend: zurückgehalten mit Grund, erste Woche Summe seit Start, Probe zählt nicht", () => {
    const e = (tag: string, urteil: "ok" | "auffaellig", probe?: boolean) => ({ am: "", tag, id: "1", art: "erst" as const, titel: "Mathe Sek", urteil, grund: urteil === "ok" ? "" : "Stufe passt nicht", probe });
    const t = agentText("2026-11-12", [e("2026-11-12", "ok"), e("2026-11-12", "auffaellig"), e("2026-11-11", "ok"), e("2026-11-12", "ok", true)]);
    expect(t).toContain("1 mit ok durchgelassen, 1 zurückgehalten");
    expect(t).toContain("Stufe passt nicht");
    expect(t).toContain("Seit Start insgesamt: 2 ok, 1 auffällig");
    expect(agentText("2026-11-25", [e("2026-11-25", "ok")])).not.toContain("Seit Start");
    expect(agentText("2026-11-12", [])).toBe("");
  });

  it("Abend: mehr als 2 zurückgehaltene Nachfassen → Hinweis (nur am Tag eines neuen, bis 26.11.)", () => {
    const nf = (tag: string) => ({ am: "", tag, id: "1", art: "nachfassen" as const, titel: "t", urteil: "auffaellig" as const, grund: "g" });
    expect(agentText("2026-11-13", [nf("2026-11-12"), nf("2026-11-13")])).not.toContain("Senden-Knopf");
    expect(agentText("2026-11-14", [nf("2026-11-12"), nf("2026-11-13"), nf("2026-11-14")])).toContain("3 Nachfassen");
    expect(agentText("2026-11-15", [nf("2026-11-12"), nf("2026-11-13"), nf("2026-11-14")])).not.toContain("Senden-Knopf");
    expect(agentText("2026-11-27", [nf("2026-11-25"), nf("2026-11-26"), nf("2026-11-27")])).not.toContain("Senden-Knopf");
  });
});
