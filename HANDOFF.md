# Übergabe — Stand 6. August 2026

Dieses Dokument beim Wiedereinstieg vollständig hereingeben.

---

## Arbeitsregeln (gelten immer)

1. **Erst analysieren, Plan zeigen, dann bauen.** Nichts ungefragt umsetzen.
2. **Destruktive Migrationen nur nach ausdrücklichem „ja"** — und nur nach
   verifiziertem Backup (siehe Backup-Status).
3. **GET-Routen mutieren nicht.** Browser laden Links spekulativ vor; jede
   Zustandsänderung braucht POST.
4. **Ausgelieferte Rechnungen werden nie hart gelöscht.** „Ausgeliefert" =
   `isDelivered()` = `sentAt || paidAt || firstDownloadedAt`. Korrektur läuft
   über Neuausstellung (Revision) oder Storno, nie über Überschreiben.
5. Vor jedem Schreibzugriff auf Produktionsdaten: lesend zeigen, was sich ändert.

---

## Zustand beim Wiedereinstieg

**P2c ist live und verifiziert.** Production-Stand: **`1ccd89e`**. Die Geldfelder
liegen als `numeric` in der Datenbank, das Dashboard zeigt geprüfte Zahlen.

**Pending-Deletion ist VOLLSTÄNDIG live** (`cc7c71c` vormerken + `9aab272`
auflösen), inzwischen ergänzt um das Löschband auf dem Dashboard (`7bd6439`).
Es hat in Produktion bereits gearbeitet: am 05.08. wurden drei Vormerkungen
bestätigt (CHF 78 + 65 + 78 = **221.00**), Sessions 658 → **655**.

Es gibt keine offenen Sperren — Sync und Rechnungserstellung laufen normal.

**Der nächste Durchgang ist P2b** — von den offenen Migrationsschritten der
einzige verbliebene. Der Plan steht, die Entscheidung des Nutzers liegt vor,
gebaut ist nichts. (Daneben bleibt „Fund 3" offen: Analyse liegt vor, nichts
gebaut, kein Migrationsschritt.)

> Eine frühere Fassung dieses Dokuments warnte, `9aab272` sei nicht deployt. Das
> war schon beim Schreiben überholt: die Vercel-GitHub-Integration deployt bei
> jedem Push auf `main` automatisch, `9aab272` ging als `khfd11410` um 07:58 live,
> `05e4809` als `51wu8agyu` um 08:00. **Merke für künftige Übergaben:** Push auf
> `main` = Production-Deploy. Den Live-Stand nie aus dem Gedächtnis notieren,
> sondern gegen `vercel ls --prod` bzw. die Deployment-Metadaten prüfen.

---

## Live in Produktion

| Commit | Inhalt | Deployment |
|---|---|---|
| `fa49722` | Tarif-Verlauf: Korrektur ersetzt spätere Einträge; Datenkorrektur CHF 181 | `9dk5igfcp` |
| `259c3fb` | **Batch 1** — `isDelivered()` überall, Tarif-Warnung, Prune-Schutz, Tarif bei umgehängter Lektion | `ojulds6fw` |
| `8310342` · `26245ce` · `1a74e28` | **P6.1–6.3** — versionierte PDF-Pfade, `reissue`/`accept`, Entscheid-UI, Middleware 401 statt Redirect | `8om0pa2wo` |
| *(P6.4)* | 409-Guards in `generate`/ZIP-Export, `force` entfernt, `upsert` an `isDelivered()` gebunden | `pa1pyhyxv` |
| *(childrenBilled)* | Familienrechnung: ausgeliefertes Kind wird nicht doppelt fakturiert | `e9s7boigr` |
| `0d6cb9d` + `e8e9df1` | **Storno** (`voidedAt`) + Löschweg-Guard | `mnsl4axrr` |
| `cc7c71c` | **Sync merkt vor statt zu löschen** (erste Hälfte) | `1h5we7nif` |
| `9aab272` | **Vormerkungen auflösen** (zweite Hälfte) | `khfd11410` |
| `05e4809` | HANDOFF.md (nur Doku) | `51wu8agyu` |
| `c913779` | Backup sichert auch die Rechnungs-PDFs | — |
| `a801ace` | **P2c** — 18 Geldfelder auf `numeric`, Decimal-Extender in `lib/prisma.ts` | — |
| `7bd6439` | **Löschband auch auf dem Dashboard** (`PendingDeletionBanner`) | — |
| `1ccd89e` | **P2c-Nachtrag** — `aggregate`/`groupBy` im `$allOperations`-Hook wandeln — **aktueller Production-Stand** | — |

> Die Deployment-IDs der letzten fünf Commits sind hier **nicht** eingetragen:
> in dieser Sitzung war keine Vercel CLI installiert, und geraten wird nichts.
> Bei Bedarf mit `vercel ls --prod` nachtragen. Dass sie live sind, ist anders
> belegt — Push auf `main` deployt automatisch, und der Nutzer hat Dashboard und
> Rechnungsübersicht nach dem Deploy geprüft.

---

## Datenbank

**Migrationen auf der DB** (alle angewendet, die letzten beiden von heute):

```
20260727000000_p2a_invoice_lifecycle_fields
20260729000000_p3_invoice_number_sequence
20260803140000_add_invoice_voided_at          ← Storno
20260803230000_add_session_pending_deletion   ← Vormerkung
20260804100000_p2c_money_decimal              ← P2c, angewendet 05.08. 09:42 UTC
```

Die Spalten aus Storno und Vormerkung sind **additiv und nullable**, kein Backfill.

**Geldspalten seit P2c:** **18 von 18 auf `numeric`**, keine mehr `double
precision`. Beträge `numeric(10,2)` · **Raten `numeric(6,4)`** · FX `numeric(12,6)`.

> **Raten bewusst (6,4), nicht (6,2).** `ratePerMin` ist ein Preis pro Minute; auf
> zwei Stellen gerundet wäre der kleinste Schritt 0.01/Min = **0.60/Stunde**, und
> ein Stundensatz, der nicht auf 0.60 aufgeht, liesse sich nicht eintragen.
> Obergrenze ist damit 99.9999 — aktuell liegen alle Raten zwischen 1.0 und 1.8.

**Stand:** Nummernzähler `2026 = 117` · 117 Rechnungen · **655 Sessions** · **0 offene Vormerkungen**

### Falle: `extra_float_digits = 0`

Die Produktions-DB steht auf `extra_float_digits = 0`. Damit druckt
`"totalCHF"::text` auf einer Float-Spalte den Wert `495.0000000000001` als
schlichtes **`495`** — und `::numeric` kollabiert ihn genauso.

Bei P2c hat das die erste Vorher-Aufnahme fast wertlos gemacht: sie meldete **0
Rauschwerte**, obwohl 31 existierten. **Vor jeder Geld- oder Float-Prüfung gegen
diese DB `SET extra_float_digits = 3;` setzen.** Als Vergleichsschlüssel zwischen
zwei Typzuständen taugt nur `round(x::numeric, n)` — das ist vor und nach einer
Migration identisch darstellbar.

### Decimal an der Grenze — zwei Wege, beide nötig

`lib/prisma.ts` wandelt Decimal zurück auf `number`, sonst macht `JSON.stringify`
daraus eine **Zeichenkette** und aus `a + b` eine Konkatenation.

1. **`result`-Extender** für die 18 Felder — greift auf Feldern eines Datensatzes
   (`findMany`, `findUnique`) und fliesst in die generierten Typen ein.
2. **`$allOperations`-Hook** für `aggregate` und `groupBy` — die liefern kein
   Datensatzobjekt, sondern `_sum`/`_avg`, und **der `result`-Extender erreicht
   sie grundsätzlich nicht**. Genau das war der Fehler nach dem ersten P2c-Push:
   Einzelbeträge stimmten, aber Summen-Kacheln standen auf CHF 0.00 und
   Diagrammachsen gingen bis 60'000'000.

**`$queryRaw` umgeht beide Wege.** Deshalb lesen die manuellen Q1-Felder jetzt
über `prisma.tutorProfile.findUnique` mit `MANUAL_Q1_SELECT` aus
`lib/manual-revenue.ts` — dasselbe SQL stand vorher sechsmal da, und derselbe
Fehler entstand sechsmal.

**Prüfwerkzeug:** `npx dotenv -e .env.local -- npx tsx scripts/verify-money-types.ts`
vergleicht den Typ **nach JSON-Rundlauf** gegen die SQL-Summe der Datenbank. Die
Sollwerte kommen aus der DB selbst, nicht aus festen Zahlen — feste Beträge
veralten bei jedem Sync und melden dann einen Fehler, wo keiner ist.

**Migrationen ausführen:** `DIRECT_URL` zeigt auf den IPv6-Host und läuft in
einen Timeout. Vorher auf den IPv4-Session-Pooler umbiegen — derselbe Host wie
`DATABASE_URL`, aber **Port 5432 statt 6543**, ohne `pgbouncer`-Parameter.

---

## Backup-Status

| | |
|---|---|
| `pg_dump` | vorhanden unter `C:\Program Files\PostgreSQL\17\bin` (**nicht im PATH**) |
| Dump | `H:\Meine Ablage\Daten von tracker\mathetogo-2026-08-05-vor-p2c.dump`, 346 KB, **54 Tabellen mit Daten** (`pg_restore --list` gelesen) — vor P2c gezogen |
| Älteres Dump | `mathetogo-2026-08-03.dump`, 344 KB (Basis der Ladeprobe unten) |
| Archiv lesbar | ✅ `pg_restore --list` exit 0, 465 TOC-Einträge |
| Inhalt geprüft | ✅ 1689 Zeilen, zeilengenau gegen Produktion |
| **Ladeprobe** | ✅ **BESTANDEN am 04.08.2026** (siehe unten) |
| **PDF-Bytes** | ✅ **gesichert seit 04.08.2026** — `mathetogo-pdfs\`, 120 Dateien, 22,2 MB |
| Notfallexport | `mathetogo-notfallexport-2026-08-03.json`, 621 KB, verifiziert — Brücke |

`backup-db.ps1` ist auf `pg_dump` umgestellt (vorher sicherte es die tote
`prisma/dev.db`; letzte Sicherung dort war vom 20.04.). Es findet die Binaries
auch ohne PATH und verwirft ein Dump, das die Grössen- oder
`pg_restore --list`-Prüfung nicht besteht.

### PDF-Sicherung — aktiv seit 04.08.2026

`backup-db.ps1` hat einen zweiten Teil, der die Belege aus dem Storage-Bucket
`invoices` nach `H:\Meine Ablage\Daten von tracker\mathetogo-pdfs\` zieht.

- **Ein mitwachsender Ordner**, kein Ordner pro Tag: die Objekte sind
  unveränderlich (P6.1-Pfade, r1 bleibt bytegleich), tägliche Kopien wären
  vierzehnmal dasselbe. Der Name endet nicht auf `.dump` und fällt damit nicht
  unter die 14-Tage-Rotation.
- **Inkrementell** — geladen wird nur, was lokal fehlt. Kein Hash-Vergleich, weil
  bestehende Objekte sich nie ändern.
- Auflistung über die **Storage-REST-API**, nicht per SQL: sonst hinge der
  PDF-Teil an derselben Verbindung wie das Dump und fiele mit ihr aus. Nutzt
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` aus `.env.local` — keine neue
  Abhängigkeit, kein neuer Token.
- Download erst nach `.part`, dann umbenennen: ein Abbruch darf beim nächsten
  Lauf nicht als fertige Datei durchgehen.

**Die beiden Teile sind unabhängig** und beide Richtungen sind geprüft: bei
kaputtem Bucket lief das Dump vollständig durch, bei nicht erreichbarer Datenbank
lief der PDF-Teil vollständig durch. Jeder Teil meldet sich einzeln, der
Exit-Code kommt erst nach beiden.

**Verifiziert am 04.08.2026:** erster Lauf 120 neu geladen, lokal
**23'263'538 Bytes — exakt die Bucket-Grösse**, keine `.part`-Reste. Zweiter Lauf
**0 neu geladen** (idempotent).

### Ladeprobe — bestanden am 04.08.2026

Das Dump wurde auf einer **unabhängigen PostgreSQL-Instanz** wiederhergestellt,
nicht gegen den Produktionsserver.

**Methode.** Die lokale Installation unter `C:\Program Files\PostgreSQL\17`
enthält nur `bin\` — `share\` fehlt, deshalb scheiterte `initdb` bisher an
`postgres.bki does not exist`. Lösung ohne Systemeingriff: das
**Binaries-only-ZIP** von EnterpriseDB
(`postgresql-17.10-1-windows-x64-binaries.zip`, 318 MB, SHA256 `F9AAFCA5…4F5A821`)
in einen Wegwerf-Ordner entpacken — nur `bin`, `lib`, `share`, denn die tiefen
`pgAdmin 4`-Pfade reissen sonst das 260-Zeichen-Limit. Daraus `initdb`, Cluster
auf Port 55432 an `127.0.0.1`, `pg_restore --no-owner --no-privileges`, prüfen,
`pg_ctl stop`, Ordner löschen. **Kein Administrator, kein Dienst, keine
Installation** — die Maschine bleibt unverändert.

**Ergebnis.** 43 Indizes, 26 Constraints, 20 Tabellen — identisch zu Produktion.
Der Zeilenabgleich erfolgte gegen den **Produktionsstand zum Dump-Zeitpunkt**
(03.08. 13:08:32), nicht gegen den heutigen: jede Tabelle trifft exakt, die
`public`-Summe ohne `_prisma_migrations` ergibt wieder **1689**. Keine einzige
Tabelle hat weniger Zeilen als das Dump enthielt.

> **Der Exit-Code 1 ist erwartet — kein Fehlschlag.** `pg_restore` meldet
> `errors ignored on restore: 3`, alle drei aus derselben Ursache: die Extension
> `supabase_vault` existiert auf normalem PostgreSQL nicht, dadurch entsteht
> `vault.secrets` nicht und das zugehörige `COPY` scheitert. **In Produktion hat
> `vault.secrets` 0 Zeilen — es geht nichts verloren.** Bei einem echten Restore
> also entweder `--no-comments` setzen oder diese drei Fehler bewusst ignorieren,
> sonst sieht ein geglückter Restore wie ein gescheiterter aus. Die zusätzliche
> Warnung zu `wal_level` betrifft logische Replikation und ist folgenlos.

**Für P2b ist das DB-Backup ausreichend** — P2b fasst die Datenbank an, nicht den
Storage. **Trotzdem gilt: erster Schritt der nächsten Sitzung ist ein frisches
`pg_dump`**, siehe unten. Das vorhandene Dump ist vom 05.08. und altert.

**Aufräumen bei Gelegenheit:** `rollback-p2c.sql` liegt noch im Scratchpad-Ordner
der P2c-Sitzung. P2c ist verifiziert live, der Rückrollweg wird nicht mehr
gebraucht und kann weg.

---

## Offen — grosse Punkte

### Fund 3 — gesendet, aber nie heruntergeladen
Die Abweichungserkennung (P5) läuft nur für Rechnungen mit Snapshot, und
Snapshots entstehen erst beim Download. Rechnungen, die **gesendet, aber nie
heruntergeladen** wurden, sind damit unbewacht — Abweichungen fallen nie auf.
Betroffen sind vier der fünf bekannten Divergenzen (Leo 04, Una 04, Joseph 06,
Liam 06; Raffael 05 ist inzwischen storniert). **Analyse liegt vor, nichts
gebaut.**

### P2b — Umnummerierung + Unique-Constraint  ← **nächster Durchgang**
**11 Nummern mehrfach vergeben über 45 Zeilen, davon 34 umzunummerieren.** Alle
betroffenen Rechnungen sind gesendet *und* bezahlt, alle `revision = 1`.
`legacyInvoiceNumber` ist bei 0 Zeilen gesetzt — P2b ist nie gelaufen.

**Entscheidung des Nutzers liegt vor:** umnummerieren ist okay,
`legacyInvoiceNumber` setzen, **alte PDFs unangetastet**.

Plan: pro Duplikatgruppe behält die Zeile mit dem frühesten `createdAt` ihre
Nummer, die übrigen 34 bekommen neue aus dem laufenden Zähler
(**2026-0118 … 2026-0151**), je Zeile ein Audit-Eintrag `renumbered` mit alt→neu.
Erst danach `@unique` auf `invoiceNumber` — als **Teil-Index**
(`WHERE "invoiceNumber" <> ''`), weil das Feld den Default `""` hat.

**Eigener Durchgang, nur nach ausdrücklichem „ja", nur nach Backup.**

**Ablauf für die nächste Sitzung — vom Nutzer so festgelegt:**

1. **Erster Schritt: frisches `pg_dump`**, lesbar bestätigt (`pg_restore --list`).
2. Dann P2b als **eigener kontrollierter Durchgang**, Schritt für Schritt gezeigt.
3. **Kein Schreibzugriff ohne ausdrückliches „ja" des Nutzers.**

Das Vorgehen aus P2c hat sich bewährt und ist die Vorlage: Vorher-Aufnahme
ziehen → Migration zeigen, nicht fahren → Freigabe abwarten → migrieren →
sofort Nachher-Aufnahme und Abgleich → erst bei grünem Abgleich pushen. Und
**vor jeder Prüfabfrage `SET extra_float_digits = 3;`**, siehe die Falle oben.

### P2c — Float → Decimal  ✅ **ERLEDIGT, live seit 05.08.2026**
Migration `20260804100000_p2c_money_decimal` angewendet, Code live als `a801ace`
+ `1ccd89e`. 18/18 Geldspalten `numeric`, Raten `(6,4)`.

Abgleich über alle **902 Einzelwerte**: gerundete Differenz **exakt 0**, verändert
haben sich **nur die 31 bekannten Rauschwerte** (Ruby 2026-02
`495.0000000000001` → `495`, dazu 30 Session-Beträge um 1e-14). Aggregate
unverändert: Invoice **41923.50**, Snapshots **9755.00**, MonthlyExpense
**25390.44**. Session lag bei 55267.40 und steht seit den drei bestätigten
Löschvormerkungen bei **55046.40** — die Differenz von 221.00 ist Absicht und im
Audit-Log belegt.

Nachgereicht in `1ccd89e`: `aggregate`/`groupBy` liefen am `result`-Extender
vorbei, siehe „Decimal an der Grenze" oben. Details dort, nicht hier.

---

## Offen — kleinere Punkte

- **UI-Knopf für den Storno fehlt.** `POST /api/invoices/[id]/void` existiert und
  ist verifiziert, aber nur per API erreichbar. Es braucht einen Knopf mit
  Begründungsdialog, analog zu „Neu ausstellen".
- **Vincent/Aurel — eingefroren.** Zwei Juli-Lektionen (13.07., 17.07., je CHF 78)
  laufen über Kalendertitel `Vincent/Aurel` auf Vincents Rechnung. Der Satz
  `Vincent/Aurel` existiert, ist **inaktiv** und hat nie eigene Lektionen gehabt.
  Vincents Juli-Betrag von 474.50 gilt so. **Plan für Aurels Rückkehr:**
  reaktivieren, `billedToId` → Vincent, danach im Kalender getrennte Titel
  „Vincent" und „Aurel".
- **`Student.currency` ist ein totes Feld.** Wird in den Rechnungs-Payload geladen
  (`lib/invoice.ts:67`), aber nirgends verwendet. Ein Schüler in EUR bekäme
  stillschweigend eine CHF-Rechnung.
- **Optionale `SessionAuditLog`-Tabelle.** Audit-Einträge zu gelöschten Lektionen
  hängen derzeit an der Rechnung des Monats, oder — wenn keine existiert — an
  einem Ersatzschlüssel `month:<studentId>:<jahr>-<monat>` im `InvoiceAuditLog`.
  Funktioniert, wäre mit eigener Tabelle aber sauberer.
- **YTD enthält den ganzen laufenden Monat.** Am 3.8. steckten CHF 4'462 noch
  nicht gehaltener August-Lektionen im Gesamtverdienst (~9 %). Der Gesamtverdienst
  rechnet aus **Sessions**, das Dashboard aus **Rechnungen mit `sentAt`/`paidAt`` —
  zwei Zahlen, zwei Bedeutungen.

---

## Referenz: die heute aufgelösten Fälle

| Rechnung | Schüler | Ergebnis |
|---|---|---|
| 2026-0115 | Runqian | **r2**, CHF 1430.00 (Neuausstellung, +30) |
| 2026-0117 | Vincent | **r2**, CHF 474.50 (Neuausstellung, +30) |
| 2026-0108 | Alexandra | **accept**, CHF 792.00 unverändert — nur Datum verschoben, bereits gesendet |
| 2026-0112 | Leo | **r2**, CHF 585.00 (Juli-Tarif auf 1.30 gesenkt) |
| 2026-0084 | Raffael | **storniert** — Lektion fand nie statt, `paidAt` war eine manuelle Markierung |

Bei allen Neuausstellungen: Nummer unverändert, r1-PDF **bytegleich** erhalten,
r2 unter eigenem Pfad, beide Snapshots, Audit-Kette lückenlos.

**Leos Tarif-Historie:** 1.40 ab Epoche · **1.30 ab 01.07.2026** · **1.50 ab
01.08.2026**. August-Rechnung existiert noch nicht; beim Erstellen greifen
CHF 675.00.
