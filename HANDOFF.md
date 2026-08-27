# Übergabe — Stand 28. August 2026

Dieses Dokument beim Wiedereinstieg vollständig hereingeben.

---

## Arbeitsregeln (gelten immer)

1. **Erst analysieren, Plan zeigen, dann bauen.** Nichts ungefragt umsetzen.
2. **Destruktive Migrationen nur nach ausdrücklichem „ja"** — und nur nach
   verifiziertem Backup (siehe Backup-Status).
3. **GET-Routen mutieren nicht.** Browser laden Links spekulativ vor; jede
   Zustandsänderung braucht POST.
4. **Ausgelieferte Rechnungen werden nie hart gelöscht.** „Ausgeliefert" =
   `isDelivered()` = `sentAt || paidAt || firstDownloadedAt || voidedAt`.
   Korrektur läuft über Neuausstellung (Revision) oder Storno, nie über Überschreiben.
5. Vor jedem Schreibzugriff auf Produktionsdaten: lesend zeigen, was sich ändert.

---

## Aktueller Stand — Rechnungs-Härtung (August 2026)

Ein vollständiger Rechnungs-Audit (6 parallele Agenten + Produktionsanalyse
read-only) lief am 27./28.08. Ergebnis: der Geldpfad selbst war korrekt
(Rundung cent-exakt, Decimal-Grenze sauber, 0 Sessions auf zwei Rechnungen),
die **Schutzmechanismen darum herum** waren es nicht.

### Behobene Fehler

| # | Schwere | Fehler | Fix |
|---|---|---|---|
| 1 | CRITICAL | Beim Umhängen eines Kindes von Eltern A zu Eltern B wurden bereits auf A's ausgelieferter Rechnung fakturierte Lektionen ein zweites Mal berechnet | `getInvoicePayload` schliesst Sessions aus, die in `sessionIds` einer anderen ausgelieferten, nicht stornierten Rechnung stehen |
| 2 | CRITICAL | E-Mail-Versand und „gesendet"/„bezahlt" froren **nichts** ein → Rechnung unveränderlich ohne Nachweis, was fakturiert wurde | `freezeInvoiceSnapshot()` aus allen Auslieferungspfaden |
| 3 | CRITICAL | Storno setzte `paidAt` zurück; war die Rechnung nur darüber ausgeliefert, wurde sie wieder zum löschbaren Entwurf | `voidedAt` in `isDelivered` / `DELIVERED_INVOICE_WHERE` / `isPrunableDraft` |
| 4 | HIGH | `reserveInvoiceRow` schrieb Betrag/Positionen **vor** dem PDF-Bau → Zeile sagte 480, `pdfPath` zeigte auf das alte 360-PDF | `commitInvoiceContent()` schreibt erst **nach** erfolgreichem Upload |
| 5 | HIGH | Doppelklick verbrannte eine Nummer und konnte ein PDF mit einer Nummer ausliefern, die die DB nicht hat | `pg_advisory_xact_lock` auf (Schüler, Jahr, Monat) in `reserveInvoiceRow` |
| 6 | CRITICAL | Snapshot las die Lektionen bei der **Auslieferung** neu, `totalCHF` kam aus der Zeile → Snapshot konnte dem ausgelieferten PDF widersprechen, Abweichungserkennung blind | `generatedPayloadJson` (siehe unten) |
| 7 | MEDIUM | ZIP-Export fror Rechnungen fortlaufend ein → Abbruch bei Nr. 5 liess 1–4 unveränderlich ausgeliefert, ohne dass der Nutzer ein Archiv bekam | Drei-Phasen-Export (siehe unten) |

Ausserdem: stornierte Rechnungen können nicht mehr versendet oder im Status
geändert werden; `send` und `status` haben jetzt eigene `auth()`-Prüfungen
(vorher nur Middleware).

### Neue Architektur: `Invoice.generatedPayloadJson`

Der Erzeugungsstand wird an der Rechnung festgehalten und bei der Auslieferung
**unverändert** zum Snapshot. Es gibt für neu erzeugte Rechnungen keine zweite
Lektionsabfrage mehr, die den bereits gedruckten Inhalt neu definieren könnte.

```
reserveInvoiceRow      → Advisory-Lock; nur Zeile + Nummer
                         (bei BESTEHENDER Zeile Betrag/Positionen unangetastet)
buildInvoicePdf(payload)
upload PDF
commitInvoiceContent   → totalCHF + sessionIds + pdfPath + generatedPayloadJson
                         in EINEM update, aus DEMSELBEN payload
──────── Inhalt steht fest ────────
Auslieferung (Download │ E-Mail │ Status gesendet/bezahlt │ ZIP)
  → resolveSnapshotPayload → gespeicherter Erzeugungsstand, wörtlich
  → InvoiceSnapshot + Audit-Eintrag, idempotent je (invoiceId, revision)
```

- `shapeSnapshotFromGeneration()` (rein, `lib/invoice-snapshot-shape.ts`) formt den
  Stand aus dem Payload; delegiert an `shapeInvoiceSnapshot`, also **eine**
  Abschnittslogik, nicht zwei.
- `pickStoredGenerationPayload()` (rein) entscheidet gespeichert vs. live.
- **Altbestand ohne `generatedPayloadJson` nutzt weiter die Live-Abfrage.**
  Bewusst kein Backfill, keine Änderung historischer Belege.
- Genau drei Stellen legen einen Snapshot an: `invoice-download.ts` (2×, beide über
  `resolveSnapshotPayload`) und `invoice-revision.ts` (über `shapeSnapshotFromGeneration`).
  `buildInvoiceSnapshotPayload` wird nur noch aus `resolveSnapshotPayload` als
  Rückfall aufgerufen.

### ZIP-Export: drei Phasen

1. **Vorbereiten** — je Schüler Nummer, PDF, Upload, `commitInvoiceContent`, ins
   Archiv legen, ID auf `zuFrieren` merken. **Nichts wird eingefroren.**
2. **Archiv bauen** — `zip.generateAsync()`.
3. **Ausliefern** — erst jetzt `recordInvoiceDownload` für alle gemerkten IDs,
   jede in try/catch (ein Fehler hier darf das fertige Archiv nicht zurückhalten).

Ausfallverhalten (verifiziert):

| Fehler bei | Archiv | ausgeliefert |
|---|---|---|
| erster / mittlerer / letzter Rechnung (Phase 1) | nein | **keine** — die vorherigen bleiben Entwürfe |
| Archivbau (Phase 2) | nein | keine |
| Phase 3 | ja | nur was tatsächlich im Archiv liegt |
| Wiederholung | ja | alle |

Wiederholung ist idempotent: dieselbe Nummer (`reserveInvoiceRow`), keine zweite
Zeile (`@@unique([studentId, month, year])`), PDF überschreibt denselben Pfad,
`recordInvoiceDownload` steigt bei bereits eingefrorenen Rechnungen aus.

### Testzahlen

- **Voll: 278 / 278** (21 Dateien) — vorher 242
- **Rechnungsspezifisch: 119 / 119** (9 Dateien)
- `npx tsc --noEmit` sauber · `next lint` sauber · `next build` ✓ 38/38

---

## Datenbank

**Migrationen im Repo: 19.** Angewendet: 18. Ausstehend: **1**.

| Migration | Status |
|---|---|
| … bis `20260804100000_p2c_money_decimal` | ✅ angewendet |
| `20260827120000_session_deletion_rejected` | ✅ angewendet 27.08. |
| `20260827120100_calendar_sync_issue` | ✅ angewendet 27.08. |
| **`20260828090000_invoice_generated_payload`** | ❌ **NICHT angewendet** |

Die offene Migration ist rein additiv:

```sql
ALTER TABLE "Invoice" ADD COLUMN "generatedPayloadJson" JSONB;
```

nullable, kein Backfill, kein DROP, kein ALTER COLUMN, keine Änderung an
bestehenden Finanzwerten. `npx prisma validate` bestätigt das Schema.

**Migration ausführen** (`DIRECT_URL` zeigt auf den IPv6-Host und läuft in einen
Timeout — auf den IPv4-Session-Pooler umbiegen: gleicher Host wie `DATABASE_URL`,
**Port 5432 statt 6543**, ohne `pgbouncer`):

```
DIRECT_URL="postgresql://<user>:<pass>@aws-1-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require" \
  npx dotenv -e .env.local -- npx prisma migrate deploy
```

Ziel bestätigt: `aws-1-us-west-2.pooler.supabase.com:5432/postgres`, Schema `public`.
Vorher frisches Backup: `powershell -File backup-db.ps1`.

---

## Deployment-Status

**Der Code ist NICHT deploybar, solange die Migration nicht läuft.**
`generatedPayloadJson` wird in `commitInvoiceContent` geschrieben und in beiden
Freeze-Pfaden selektiert — ohne die Spalte scheitert jeder Rechnungszugriff.

Reihenfolge: **Backup → Migration → Deploy (Push auf `main`)**. Die Migration ist
additiv, der aktuell live laufende Code kennt die Spalte nicht und stört sich
nicht daran; es gibt also kein Fenster, in dem etwas bricht.

Nichts davon ist committet — der gesamte Stand liegt als Working-Tree-Änderung vor.

---

## Verbleibende Rechnungs-Themen

### A) Altlasten in den Produktionsdaten — NICHT anfassen, eigener Durchgang

Read-only festgestellt, bewusst unverändert gelassen:

1. **11 Gruppen doppelter Rechnungsnummern** (34 Zeilen), alle ≤ `2026-0069`,
   z. B. `2026-0049` auf 9 Rechnungen. Artefakte des alten `max(invoiceNumber)+1`
   vor P3 (per `git show 12fb992` bestätigt). Der **aktuelle Code kann das nicht
   mehr erzeugen**; `2026-0070…0117` sind sauber. Die geplante Umnummerierung
   („P2b") steht noch aus — erst danach ist ein UNIQUE-Index auf `invoiceNumber`
   möglich.
2. **~100 ausgelieferte Rechnungen ohne Snapshot** (alle `sent + paid`, nie
   heruntergeladen). Ursache war Fehler 2, ab jetzt behoben. **Kein Backfill.**
3. **5 von 117 Rechnungen mit Abweichung Betrag ↔ Sessions:** `2026-0007` (+65,
   1 Session nicht mehr in der DB), `2026-0084` (+84, 1 Session fehlt),
   `2026-0094` (+24), `2026-0098` (+48), `2026-0015` (−5).
4. Unfakturierte Sessions aus `2025-04` (36 Lektionen, CHF 2'795.50) und
   `2025-12` (75, CHF 5'750.00) — vor dem heutigen Rechnungsfluss entstanden.

### B) Offene Punkte im Code — bekannt, nicht blockierend

Aus dem Audit, bewusst nicht behoben:

1. **Session-Monatswechsel über eine ausgelieferte Rechnung hinweg** — verschiebt
   der Kalender eine Lektion vom 30.06. auf den 02.07., schreibt der Sync-Upsert
   `month/year` neu, auch wenn Juni bereits ausgeliefert ist. Die Lektion wandert
   auf die Juli-Rechnung, während sie im Juni-PDF steht. *(HIGH; betrifft erst
   Monate nach dem ersten Versand.)*
2. **Verknüpfen eines Kindes räumt dessen eigenen Entwurf nicht weg** — bis zum
   nächsten Sync/Cleanup steht der Betrag doppelt in der Rechnungsliste. *(MEDIUM)*
3. **`billedToId`-Ketten/Zyklen** nur durch Route-Validierung ohne Sperre
   verhindert, kein DB-Constraint. Eine Kette liesse Lektionen aus der Abrechnung
   fallen. *(MEDIUM)*
4. **Kein UNIQUE-Index auf `Invoice.invoiceNumber`** — hängt an (A1).
5. **Importierte Q1-Lektionen** (`calEventId` beginnt mit `manual-`) werden vom
   Sync als Löschkandidaten geführt. *(MEDIUM, betrifft nur Q1-Monate.)*
6. **PDF-Vorlage**: keine Postadresse, Familienrechnung nennt die Kinder statt des
   Zahlers, Zahlteil ist ein statisches Bild ohne Betrag/Referenz (und **verdeckt
   IBAN/Bank, wenn vorhanden**), Kurzrechnung wird 2-seitig, Tabellenkopf
   wiederholt sich nicht. Bestandsverhalten über 117 versandte Rechnungen —
   bewusst nicht geändert.
7. **`commitInvoiceContent` scheitert nach erfolgreichem Upload**: das neue PDF
   liegt bereits am (deterministischen) Pfad, die Zeile trägt noch den alten
   Stand. Nur bei **Entwürfen** möglich (ausgelieferte sind durch 409 +
   `upsert:false` geschützt) und durch erneutes Generieren behoben. Dokumentiert,
   nicht behoben.
8. **ZIP-Phase 3 ist kein einzelner Commit** — ein Verbindungsabbruch mitten in
   der Markierungsschleife friert einen Teil ein. Nur Rechnungen, die wirklich im
   ausgelieferten Archiv liegen; ein erneuter Export holt den Rest idempotent nach.

---

## Invarianten (Stand jetzt)

| Invariante | Durchgesetzt durch |
|---|---|
| Eine Lektion kann nicht zweimal fakturiert werden | `excludeAlreadyBilledSessions` gegen `sessionIds` ausgelieferter Belege — leitet „schon abgerechnet" aus dem **Beleg** ab, nicht aus der aktuellen Gruppenzugehörigkeit |
| Familienlektionen landen beim richtigen Zahler | `getInvoicePayload` partitioniert nach `studentId`; `BILLED_ELSEWHERE_WHERE` für Ausschlüsse |
| Ausgelieferte Rechnungen ändern sich nicht | Download liefert **gespeicherte PDF-Bytes**, nie ein Re-Render; `isDelivered` inkl. `voidedAt`; Generieren 409 |
| Rechnungsnummern kollidieren nicht | Zählerzeile bis COMMIT gesperrt + `pg_advisory_xact_lock` je Abrechnungsumfang |
| Erzeugungsstand wird persistiert | `generatedPayloadJson`, geschrieben mit Betrag/Positionen/Pfad in einem `update` |
| Snapshot-Quelle | ausschliesslich der gespeicherte Erzeugungsstand (Altbestand: Live-Rückfall) |
| PDF = Zeile = Snapshot | ein Payload, ein Schreibvorgang; für 3 Szenarien inkl. nachträglicher Session-Änderung abgeglichen |
| Geschützte Rechnungen werden nie geprunt | `isPrunableDraft` vor jedem `delete`; storniert/bezahlt/heruntergeladen ausgenommen |
| Rechnungs-GETs sind schreibfrei | Download ist **POST**; `lib/invoice-read-only.test.ts` pinnt das |
| ZIP-Ausfall friert nichts irreführend ein | Drei-Phasen-Export; Freeze erst nach `generateAsync` |

Zwei getrennte Prädikate, nicht vermischen:
- `isDelivered` / `DELIVERED_INVOICE_WHERE` — „darf ich das anfassen?" **Storniert: ja, geschützt.**
- `isBilledElsewhere` / `BILLED_ELSEWHERE_WHERE` — „ist das schon abgerechnet?" **Storniert: nein.**

---

## Backup-Status

| | |
|---|---|
| Letztes Dump | `H:\Meine Ablage\Daten von tracker\mathetogo-2026-08-27.dump`, 370.3 KB, 54 Tabellen, `pg_restore --list` exit 0 (465 TOC-Einträge) |
| PDFs | `mathetogo-pdfs\`, 120 Objekte, vollständig |
| Werkzeug | `powershell -File backup-db.ps1` (pg_dump über den IPv4-Pooler + Storage-Sicherung) |

---

## Vor dem echten Rechnungsversand — Kurzcheckliste

1. Eine Rechnung erzeugen, herunterladen, PDF öffnen: Empfänger, Periode,
   Lektionszahl, Beträge, Total, Nummer gegen die Liste prüfen.
2. **Zahlteil-Bild prüfen** — bei vorhandenem Slip druckt das PDF IBAN und Bank
   *nicht*. Konto auf dem Bild muss stimmen.
3. Eine Familienrechnung stichprobenartig prüfen (5 verknüpfte Schüler, z. B.
   Nikola/William): beide Kinder genau einmal, Summe stimmt.
4. „Generieren" einmal klicken (Doppelklick ist jetzt abgesichert, hält aber die
   Nummernfolge lückenlos).
5. Bricht der Monatsexport ab: **nichts ist ausgeliefert** — Export einfach
   wiederholen.
