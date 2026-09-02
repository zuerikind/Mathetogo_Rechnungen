import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Der Sync-Knopf darf die alte Waisen-Bereinigung nicht mehr ausloesen.
 *
 * Der Fall, der das hier ausgeloest hat: die Oberflaeche zeigte keine Option
 * "Waisen aufraeumen" — weil es keine gab. `pruneOrphans: true` stand fest im
 * Knopf, und damit lief bei JEDEM Klick zusaetzlich die alte Logik: bis zu 50
 * Einzelabfragen bei Google, Loeschvormerkungen, und ein echtes DELETE auf
 * nicht abrechenbare Entwurfsrechnungen. Sichtbar war davon nichts.
 *
 * Geprueft wird gegen den Quelltext, nicht gegen ein Mock: der Fehler lag nicht
 * in einer Funktion, sondern in einem hartkodierten Wert an genau einer Stelle.
 * Ein Test, der die Stelle nicht liest, haette ihn nicht gefunden.
 */

const repo = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(repo, p), "utf8");

const syncButton = read("components/SyncButton.tsx");
const syncRoute = read("app/api/sync/route.ts");

/** Quelltext ohne Kommentare — sonst zaehlen Erlaeuterungen als Code. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("Der Sync-Knopf", () => {
  it("ist der einzige Aufrufer von /api/sync", () => {
    // Alle Dateien, die die Route aufrufen koennten.
    const kandidaten = [
      "components/SyncButton.tsx",
      "app/sync/page.tsx",
      "app/dashboard/page.tsx",
      "components/CalendarReviewPanel.tsx",
    ];
    const aufrufer = kandidaten.filter((p) => /fetch\(\s*["'`]\/api\/sync/.test(read(p)));
    expect(aufrufer).toEqual(["components/SyncButton.tsx"]);
  });

  it("sendet pruneOrphans: false", () => {
    expect(code(syncButton)).toContain("pruneOrphans: false");
  });

  it("sendet nirgends pruneOrphans: true", () => {
    expect(code(syncButton)).not.toContain("pruneOrphans: true");
  });

  it("sendet Jahr und Monat mit", () => {
    expect(code(syncButton)).toMatch(/JSON\.stringify\(\{\s*year,\s*month,\s*pruneOrphans: false,?\s*\}\)/);
  });
});

describe("Serverseitige Ableitung", () => {
  it("allowPruneOrphans entsteht aus einem strikten Vergleich mit true", () => {
    expect(code(syncRoute)).toContain("const allowPruneOrphans = pruneOrphans === true;");
  });

  /**
   * Dieselbe Regel wie in der Route, hier direkt geprueft. `=== true` ist der
   * Punkt: sowohl `false` als auch ein fehlendes Feld ergeben false, und kein
   * anderer Wert ("false", 0, null) kann sie versehentlich einschalten.
   */
  const allowPruneOrphans = (pruneOrphans: unknown) => pruneOrphans === true;

  it("false schaltet nicht ein", () => {
    expect(allowPruneOrphans(false)).toBe(false);
  });

  it("ein fehlendes Feld schaltet nicht ein", () => {
    expect(allowPruneOrphans(undefined)).toBe(false);
  });

  it("kein wahrheitsaehnlicher Wert schaltet ein", () => {
    for (const v of ["true", "false", 1, 0, null, {}, []]) {
      expect(allowPruneOrphans(v)).toBe(false);
    }
  });

  it("nur echtes true schaltet ein", () => {
    expect(allowPruneOrphans(true)).toBe(true);
  });
});

describe("Was an allowPruneOrphans haengt — und was nicht", () => {
  const src = code(syncRoute);

  /**
   * Abschnitt zwischen zwei CODE-Ankern (keine Kommentare — die sind entfernt,
   * und ein Marker, der in einem Kommentar steht, wuerde nie gefunden).
   */
  function abschnitt(von: string, bis: string): string {
    const a = src.indexOf(von);
    const b = src.indexOf(bis, a);
    expect(a, `Anker nicht gefunden: ${von}`).toBeGreaterThan(-1);
    expect(b, `Anker nicht gefunden: ${bis}`).toBeGreaterThan(a);
    return src.slice(a, b);
  }

  it("die alte Waisen-Vormerkung steht hinter dem Guard", () => {
    const guard = src.indexOf("if (allowPruneOrphans) {");
    const vormerkung = src.indexOf("afterDeletionPending(");
    expect(guard).toBeGreaterThan(-1);
    expect(vormerkung).toBeGreaterThan(guard);
    // … und zwar hinter dem ERSTEN Guard, vor dem zweiten (Rechnungs-Pruning).
    const zweiterGuard = src.indexOf("if (allowPruneOrphans) {", guard + 1);
    expect(vormerkung).toBeLessThan(zweiterGuard);
  });

  it("das Loeschen von Entwurfsrechnungen steht hinter dem Guard", () => {
    const zweiterGuard = src.indexOf(
      "if (allowPruneOrphans) {",
      src.indexOf("if (allowPruneOrphans) {") + 1
    );
    const pruning = src.indexOf("pruneStaleInvoicesInScope({");
    expect(zweiterGuard).toBeGreaterThan(-1);
    expect(pruning).toBeGreaterThan(zweiterGuard);
    // Zwischen Guard und Aufruf steht nichts als Zuweisung.
    expect(src.slice(zweiterGuard, pruning)).toMatch(/^\S[\s\S]{0,80}$/);
  });

  it("beide alten Pfade haengen an genau zwei Guards — nicht mehr, nicht weniger", () => {
    expect(src.split("if (allowPruneOrphans) {").length - 1).toBe(2);
  });

  it("die Soft-Stornierung haengt NICHT an allowPruneOrphans", () => {
    const block = abschnitt("let autoCancelled = 0;", "let pendingMarked = 0;");
    expect(block).toContain("decideCancellation(");
    expect(block).toContain("cancelReason: reason");
    expect(block).not.toContain("allowPruneOrphans");
  });

  it("die Integritaetspruefung haengt ebenfalls nicht daran", () => {
    const block = abschnitt("let integrityFindings: IntegrityFinding[] = [];", "let issuesOpen = 0;");
    expect(block).toContain("findCalendarIntegrityIssues(");
    expect(block).not.toContain("allowPruneOrphans");
  });

  it("der Sync loescht niemals physisch eine Lektion", () => {
    for (const verboten of ["session.delete(", "session.deleteMany("]) {
      expect(src).not.toContain(verboten);
    }
  });
});
