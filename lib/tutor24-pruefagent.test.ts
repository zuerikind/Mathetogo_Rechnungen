import { describe, expect, it } from "vitest";
import { agentPass, agentZaehlen, parseSprache, parseUrteil, pruefAgent } from "./tutor24-pruefagent";
import { vergleicheGesendet } from "./tutor24-followup-runner";

const ok = { urteil: "ok" as const, grund: "" };
const auff = { urteil: "auffaellig" as const, grund: "x" };
const fehler = { urteil: "fehler" as const, grund: "Prüf-Agent nicht erreichbar" };

describe("Prüf-Agent", () => {
  it("liest die Antwort", () => {
    expect(parseUrteil('{"urteil":"ok"}')).toEqual(ok);
    expect(parseUrteil('{"urteil":"auffällig","grund":"Anrede falsch"}')).toEqual({ urteil: "auffaellig", grund: "Anrede falsch" });
    expect(parseUrteil("Sieht gut aus").urteil).toBe("fehler");
    // 13.11.: Sprach-Aufruf — Sprachfehler eingetragen → auffaellig; leer oder {} → ok; unlesbar → fehler
    expect(parseSprache('{"persoenlich":"x","sprachfehler":"Beim Berufsmatura Niveau"}').urteil).toBe("auffaellig");
    expect(parseSprache('{"persoenlich":"x","sprachfehler":""}')).toEqual(ok);
    expect(parseSprache("{}")).toEqual(ok);
    expect(parseSprache("kaputt").urteil).toBe("fehler");
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
});
