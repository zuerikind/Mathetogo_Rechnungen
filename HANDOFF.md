# Übergabe — Stand 4. August 2026

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

## ⚠️ Zustand beim Wiedereinstieg zuerst prüfen

**Produktion läuft auf `cc7c71c` — das Pending-Deletion-Feature ist dort nur zur
Hälfte live.** Der Sync merkt gelöschte Lektionen vor, aber die Auflösung
(`9aab272`) ist **committet und gepusht, jedoch NICHT deployt**.

Solange das so ist:
- Keinen Sync fahren, bei dem Kalendereinträge gelöscht wurden — die Vormerkungen
  liessen sich nicht auflösen und würden den Betrag oben halten.
- Keine Rechnung mit offenen Vormerkungen erstellen.

**Erster Schritt nach dem Neustart:** `9aab272` deployen, dann ist das Feature
vollständig (vormerken **und** auflösen). Stand jetzt: **0 offene Vormerkungen**.

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
| `9aab272` | **Vormerkungen auflösen** (zweite Hälfte) | **NICHT DEPLOYT** |

---

## Datenbank

**Migrationen auf der DB** (alle angewendet, die letzten beiden von heute):

```
20260727000000_p2a_invoice_lifecycle_fields
20260729000000_p3_invoice_number_sequence
20260803140000_add_invoice_voided_at          ← Storno
20260803230000_add_session_pending_deletion   ← Vormerkung
```

Beide neuen Spalten sind **additiv und nullable**, kein Backfill.

**Stand:** Nummernzähler `2026 = 117` · 117 Rechnungen · 658 Sessions · **0 offene Vormerkungen**

**Migrationen ausführen:** `DIRECT_URL` zeigt auf den IPv6-Host und läuft in
einen Timeout. Vorher auf den IPv4-Session-Pooler umbiegen — derselbe Host wie
`DATABASE_URL`, aber **Port 5432 statt 6543**, ohne `pgbouncer`-Parameter.

---

## Backup-Status

| | |
|---|---|
| `pg_dump` | vorhanden unter `C:\Program Files\PostgreSQL\17\bin` (**nicht im PATH**) |
| Dump | `H:\Meine Ablage\Daten von tracker\mathetogo-2026-08-03.dump`, 344 KB |
| Archiv lesbar | ✅ `pg_restore --list` exit 0, 465 TOC-Einträge |
| Inhalt geprüft | ✅ 1689 Zeilen, zeilengenau gegen Produktion |
| **Ladeprobe** | ⚠️ **fehlt** |
| Notfallexport | `mathetogo-notfallexport-2026-08-03.json`, 621 KB, verifiziert — Brücke |

`backup-db.ps1` ist auf `pg_dump` umgestellt (vorher sicherte es die tote
`prisma/dev.db`; letzte Sicherung dort war vom 20.04.). Es findet die Binaries
auch ohne PATH und verwirft ein Dump, das die Grössen- oder
`pg_restore --list`-Prüfung nicht besteht.

**Warum die Ladeprobe fehlt:** Die lokale Installation enthält nur die
Command-Line-Tools — `share/` ist leer, `initdb` scheitert mit
`postgres.bki does not exist`, kein Dienst. Ein Wegwerf-Cluster lässt sich damit
nicht starten.

Ersatzweise wurde das Dump in ein Schema `restore_probe` der Produktions-DB
geladen, **innerhalb einer Transaktion mit Rollback**: 20 Tabellen, 43 Indizes,
26 Constraints, alle Zeilen — danach `ROLLBACK`, Schema weg, Produktion
unberührt. Das beweist, dass ein echter Server das Dump lädt; **nicht** bewiesen
ist eine Wiederherstellung auf einer anderen Maschine.

**Vor P2c/P2b:** entweder die Server-Komponente nachinstallieren
(`winget install PostgreSQL.PostgreSQL.17`, ~350 MB, Windows-Dienst) und einen
echten Restore fahren, oder die Schema-Probe erneut als Nachweis akzeptieren.

---

## Offen — grosse Punkte

### Fund 3 — gesendet, aber nie heruntergeladen
Die Abweichungserkennung (P5) läuft nur für Rechnungen mit Snapshot, und
Snapshots entstehen erst beim Download. Rechnungen, die **gesendet, aber nie
heruntergeladen** wurden, sind damit unbewacht — Abweichungen fallen nie auf.
Betroffen sind vier der fünf bekannten Divergenzen (Leo 04, Una 04, Joseph 06,
Liam 06; Raffael 05 ist inzwischen storniert). **Analyse liegt vor, nichts
gebaut.**

### P2c — Float → Decimal
**R2-Verlustprüfung wiederholt: 0 verlustbehaftete Werte** über alle 18
Geldfelder. Vorgesehen: `Decimal(10,2)` für Beträge, `Decimal(6,2)` für Raten,
`Decimal(12,6)` für FX.

Die Migration ist trivial, **der Aufwand liegt in der Code-Umstellung**: Prisma
liefert danach `Decimal` statt `number`, das berührt jede Betragsaddition
(`reduce`, `invoice-diff.ts`, `dashboard-analytics.ts`, `income-summary.ts`, die
JSON-Serialisierung an die UI). **Eigener Durchgang**, mit Vorher/Nachher-Abgleich
über alle 117 Rechnungssummen.

Motivation nebenbei: Ruby 2026-02 steht mit `495.0000000000001` in der DB.

### P2b — Umnummerierung + Unique-Constraint
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
