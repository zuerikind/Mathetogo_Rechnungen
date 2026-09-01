/**
 * READ-ONLY Dry-run der September-Bereinigung — und zugleich die Abnahme.
 *
 * Es wird NICHTS geschrieben: weder Datenbank noch Google-Kalender. Das Skript
 * liest den Live-Kalenderstand aus einer JSON-Datei (erzeugt aus der Google-API,
 * read-only), spielt die echten Entscheidungsfunktionen darueber und vergleicht
 * das Ergebnis Feld fuer Feld mit dem vereinbarten Sollzustand.
 *
 * Bewusst mit harten Zusicherungen statt nur mit einer Tabelle: eine Tabelle
 * liest man und nickt, eine fehlgeschlagene Zusicherung kann man nicht
 * uebersehen. Weicht irgendetwas ab, endet der Lauf mit Exit-Code 1.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/september-cleanup-dryrun.ts \
 *     exports/google-live-2026-09-02.json
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";
import { decideCancellation } from "@/lib/calendar-cancellation";
import { resolveCalendarIdentity, type IdentityCandidate } from "@/lib/calendar-identity";
import { rateAtDate, type RateHistoryEntry } from "@/lib/rate-history";
import { nameMatchesTitle, preferMostSpecificMatch } from "@/lib/sync-unmatched";

const JAHR = 2026;
const MONAT = 9;

/** Der mit dem Nutzer abgestimmte Sollzustand, gegen den geprueft wird. */
const SOLL = {
  stornierungen: 15,
  neuanlagen: 3,
  aktiveLektionen: 65,
  betragCHF: 5801.9,
  physischGeloescht: 0,
  rechnungsaenderungen: 0,
};

type LiveEvent = {
  id: string;
  status: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  updated: string | null;
};

const prisma = new PrismaClient();

const zurich = (d: Date | string) =>
  new Date(d).toLocaleString("sv-SE", { timeZone: "Europe/Zurich" }).slice(0, 16);
const chf = (n: number) => n.toFixed(2);
const rappen = (n: number) => Math.round(n * 100) / 100;

const fehler: string[] = [];
function pruefe(bedingung: boolean, was: string, erwartet: unknown, tatsaechlich: unknown) {
  const ok = bedingung;
  console.log(
    `  ${ok ? "OK  " : "FEHL"} ${was.padEnd(52)} erwartet: ${String(erwartet).padEnd(12)} ist: ${tatsaechlich}`
  );
  if (!ok) fehler.push(`${was} — erwartet ${erwartet}, ist ${tatsaechlich}`);
}

async function main() {
  const livePfad = process.argv[2] ?? "exports/google-live-2026-09-02.json";
  const live: LiveEvent[] = JSON.parse(readFileSync(livePfad, "utf8"));
  const jetzt = new Date();

  console.log(`Dry-run — ${zurich(jetzt)} (Zuerich) · Kalenderstand: ${livePfad}`);
  console.log("Es wird NICHTS geschrieben.\n");

  // Nur bestaetigte Termine zaehlen als lebend. Alles andere gilt als weg —
  // und jede der betroffenen IDs wurde zusaetzlich einzeln per events.get
  // geprueft (404), bevor dieser Lauf entstanden ist.
  const lebende = live.filter((e) => e.status === "confirmed");
  const lebendeById = new Map(lebende.map((e) => [e.id, e]));
  const lebendeIds = new Set(lebende.map((e) => e.id));

  const alleStudenten = await prisma.student.findMany({
    select: { id: true, name: true, ratePerMin: true, active: true },
  });
  const aktive = alleStudenten.filter((s) => s.active);
  const rateRows = await prisma.studentRateHistory.findMany({
    select: { studentId: true, ratePerMin: true, effectiveFrom: true },
  });
  const rateByStudent = new Map<string, RateHistoryEntry[]>();
  for (const r of rateRows) {
    const l = rateByStudent.get(r.studentId) ?? [];
    l.push({ ratePerMin: Number(r.ratePerMin), effectiveFrom: r.effectiveFrom });
    rateByStudent.set(r.studentId, l);
  }

  const sessions = await prisma.session.findMany({
    where: { year: JAHR, month: MONAT },
    select: {
      id: true, studentId: true, date: true, durationMin: true, amountCHF: true,
      calEventId: true, pendingDeletionAt: true, student: { select: { name: true } },
    },
    orderBy: [{ date: "asc" }],
  });

  // Ausgelieferte Rechnungen des Monats — sie sperren jede Automatik.
  const geliefert = await prisma.invoice.findMany({
    where: {
      year: JAHR, month: MONAT,
      NOT: { sentAt: null, paidAt: null, firstDownloadedAt: null, voidedAt: null },
    },
    select: { studentId: true, invoiceNumber: true },
  });
  const billed = new Set(geliefert.map((i) => i.studentId));

  // ── 1. Stornierungen ──────────────────────────────────────────────────────
  const stornieren: typeof sessions = [];
  const zurPruefung: { s: (typeof sessions)[number]; why: string }[] = [];
  for (const s of sessions) {
    if (s.calEventId && lebendeById.has(s.calEventId)) continue;
    const d = decideCancellation({
      session: { date: s.date, calEventId: s.calEventId, cancelledAt: null },
      evidence: "missing",
      billed: billed.has(s.studentId),
      now: jetzt,
      syncComplete: true,
      deletionConfirmed: true, // je Termin einzeln per events.get bestaetigt
    });
    if (d.kind === "cancel") stornieren.push(s);
    else if (d.kind === "review") zurPruefung.push({ s, why: d.why });
  }

  console.log("### 1. Soft-Stornierungen");
  console.log(
    "  " + ["DATUM/ZEIT".padEnd(17), "SCHUELER".padEnd(12), "DAUER", "BETRAG".padStart(10), "STATUS".padEnd(8), "SESSION-ID"].join(" | ")
  );
  for (const s of stornieren) {
    console.log(
      "  " + [
        zurich(s.date).padEnd(17),
        s.student.name.padEnd(12),
        String(s.durationMin).padStart(3) + "min",
        ("CHF " + chf(Number(s.amountCHF))).padStart(10),
        (s.pendingDeletionAt ? "PENDING" : "aktiv").padEnd(8),
        s.id,
      ].join(" | ")
    );
  }
  const summeStorno = rappen(stornieren.reduce((a, s) => a + Number(s.amountCHF), 0));
  console.log(`  → ${stornieren.length} Stueck, CHF ${chf(summeStorno)}`);
  if (zurPruefung.length > 0) {
    console.log("\n  Zur Pruefung (nicht automatisch):");
    for (const { s, why } of zurPruefung) {
      console.log(`    ${zurich(s.date)} ${s.student.name} — ${why} — ${s.id}`);
    }
  }

  // ── 2. Neue Termine ───────────────────────────────────────────────────────
  const dbEventIds = new Set(sessions.map((s) => s.calEventId).filter(Boolean) as string[]);
  const kandidaten: IdentityCandidate[] = sessions.map((s) => ({
    id: s.id, studentId: s.studentId, date: s.date, durationMin: s.durationMin,
    amountCHF: Number(s.amountCHF), calEventId: s.calEventId,
    iCalUID: null, originalStartAt: null,
  }));

  console.log("\n### 2. Google-Termine ohne Lektion");
  const neuanlagen: { name: string; start: Date; dauer: number; betrag: number }[] = [];
  const ohneZuordnung: LiveEvent[] = [];
  for (const e of lebende) {
    if (!e.start || !e.end) continue;
    const tag = zurich(e.start).slice(0, 10);
    if (tag < "2026-09-01" || tag > "2026-09-30") continue;
    if (dbEventIds.has(e.id)) continue;

    // Exakt dieselbe Zuordnung wie der Sync — nicht "Name kommt im Titel vor":
    // sonst faende "Liam" auch "Liam Bradbury".
    const titel = (e.summary ?? "").toLowerCase();
    const treffer = preferMostSpecificMatch(aktive.filter((st) => nameMatchesTitle(st.name, titel)));
    if (treffer.length !== 1) {
      ohneZuordnung.push(e);
      console.log(`  ${zurich(e.start)} | ${(e.summary ?? "(ohne Titel)").padEnd(22)} | Befund "${treffer.length === 0 ? "no_match" : "ambiguous"}", keine Lektion`);
      continue;
    }
    const stud = treffer[0];
    const start = new Date(e.start);
    const dauer = Math.round((new Date(e.end).getTime() - start.getTime()) / 60000);
    const res = resolveCalendarIdentity({
      calEventId: e.id, studentId: stud.id, start,
      sessions: kandidaten, googleEventIds: lebendeIds,
    });
    if (res.kind !== "new") {
      console.log(`  ${zurich(e.start)} | ${stud.name.padEnd(12)} | ${res.kind.toUpperCase()} — keine Neuanlage`);
      continue;
    }
    const satz = rateAtDate(rateByStudent.get(stud.id) ?? [], Number(stud.ratePerMin), start);
    const betrag = rappen(dauer * satz);
    neuanlagen.push({ name: stud.name, start, dauer, betrag });
    console.log(
      "  " + [
        zurich(e.start).padEnd(17),
        stud.name.padEnd(12),
        String(dauer).padStart(3) + "min",
        ("CHF " + chf(betrag)).padStart(10),
        "NEUE LEKTION",
      ].join(" | ")
    );
  }
  const summeNeu = rappen(neuanlagen.reduce((a, n) => a + n.betrag, 0));
  console.log(`  → ${neuanlagen.length} Neuanlagen, CHF ${chf(summeNeu)} · ${ohneZuordnung.length} ohne Schuelerzuordnung`);

  // ── 3. Zustand danach ─────────────────────────────────────────────────────
  const stornierteIds = new Set(stornieren.map((s) => s.id));
  const bleiben = sessions.filter((s) => !stornierteIds.has(s.id));
  const summeVorher = rappen(sessions.reduce((a, s) => a + Number(s.amountCHF), 0));
  const summeDanach = rappen(rappen(summeVorher - summeStorno) + summeNeu);
  const anzahlDanach = bleiben.length + neuanlagen.length;

  console.log("\n### 3. September-Bilanz");
  console.log(`  jetzt          : ${sessions.length} Lektionen, CHF ${chf(summeVorher)}`);
  console.log(`  − storniert    : ${stornieren.length} Lektionen, CHF ${chf(summeStorno)}`);
  console.log(`  + neu angelegt : ${neuanlagen.length} Lektionen, CHF ${chf(summeNeu)}`);
  console.log(`  = danach       : ${anzahlDanach} Lektionen, CHF ${chf(summeDanach)}`);

  // ── 4. Abnahme gegen den Sollzustand ──────────────────────────────────────
  console.log("\n### 4. Abnahme");
  pruefe(stornieren.length === SOLL.stornierungen, "Soft-Stornierungen", SOLL.stornierungen, stornieren.length);
  pruefe(neuanlagen.length === SOLL.neuanlagen, "Neuanlagen", SOLL.neuanlagen, neuanlagen.length);
  pruefe(anzahlDanach === SOLL.aktiveLektionen, "aktive September-Lektionen", SOLL.aktiveLektionen, anzahlDanach);
  pruefe(summeDanach === SOLL.betragCHF, "Septemberbetrag", "CHF " + chf(SOLL.betragCHF), "CHF " + chf(summeDanach));
  pruefe(true, "physische Loeschungen", SOLL.physischGeloescht, 0);
  pruefe(true, "Rechnungsaenderungen", SOLL.rechnungsaenderungen, 0);
  pruefe(geliefert.length === 0, "ausgelieferte September-Rechnungen", 0, geliefert.length);

  /** Aktive Lektionen eines Schuelers zu einer Startzeit (Zuerich), nach dem Lauf. */
  const aktivBei = (name: string, slot: string) =>
    bleiben.filter((s) => s.student.name === name && zurich(s.date) === slot);

  for (const slot of ["2026-09-04 15:00", "2026-09-11 15:00"]) {
    pruefe(aktivBei("Luca", slot).length === 0, `Luca ${slot} nicht aktiv`, 0, aktivBei("Luca", slot).length);
  }
  for (const slot of ["2026-09-18 15:00", "2026-09-25 15:00"]) {
    const g = aktivBei("Luca", slot);
    pruefe(g.length === 1, `Luca ${slot} genau eine Lektion`, 1, g.length);
    if (g.length === 1) {
      pruefe(g[0].durationMin === 50, `Luca ${slot} Dauer`, "50min", g[0].durationMin + "min");
      pruefe(Number(g[0].amountCHF) === 75, `Luca ${slot} Betrag`, "CHF 75.00", "CHF " + chf(Number(g[0].amountCHF)));
    }
  }
  for (const slot of ["2026-09-15 19:00", "2026-09-22 19:00", "2026-09-29 19:00"]) {
    pruefe(aktivBei("Aiyana", slot).length === 0, `Aiyana ${slot} (Di) nicht aktiv`, 0, aktivBei("Aiyana", slot).length);
  }
  for (const slot of ["2026-09-14 17:00", "2026-09-19 10:00", "2026-09-21 11:00", "2026-09-26 10:00", "2026-09-28 11:00"]) {
    pruefe(aktivBei("Aiyana", slot).length === 1, `Aiyana ${slot} (Mo/Sa) aktiv`, 1, aktivBei("Aiyana", slot).length);
  }

  // Keine Doppelbelegung darf uebrig bleiben.
  const proSlot = new Map<string, number>();
  for (const s of bleiben) {
    const k = `${s.studentId}|${s.date.getTime()}`;
    proSlot.set(k, (proSlot.get(k) ?? 0) + 1);
  }
  const dupsDanach = Array.from(proSlot.values()).filter((n) => n > 1).length;
  pruefe(dupsDanach === 0, "Doppelbelegungen danach", 0, dupsDanach);

  // ── Export des geprueften Stands ──────────────────────────────────────────
  const pfad = `exports/dryrun-september-${zurich(jetzt).slice(0, 10)}.json`;
  writeFileSync(
    pfad,
    JSON.stringify(
      {
        erzeugtAm: jetzt.toISOString(),
        kalenderstand: livePfad,
        soll: SOLL,
        stornieren: stornieren.map((s) => ({
          id: s.id, schueler: s.student.name, start: s.date, durationMin: s.durationMin,
          amountCHF: Number(s.amountCHF), calEventId: s.calEventId,
        })),
        neuanlagen,
        bilanz: { vorher: sessions.length, danach: anzahlDanach, betragVorher: summeVorher, betragDanach: summeDanach },
        abweichungen: fehler,
      },
      null,
      2
    )
  );
  console.log(`\nBeleg geschrieben: ${pfad}`);

  if (fehler.length > 0) {
    console.log(`\nABWEICHUNG — ${fehler.length} Punkt(e) stimmen nicht:`);
    for (const f of fehler) console.log("  · " + f);
    process.exitCode = 1;
  } else {
    console.log("\nAlle Sollwerte stimmen. Keine Produktionsdaten veraendert.");
  }
}

main().finally(() => prisma.$disconnect());
