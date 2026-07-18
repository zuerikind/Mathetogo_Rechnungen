/** Structured sync mismatches: calendar title ↔ student name. */

export type SyncUnmatchedReason = "no_match" | "ambiguous" | "inactive_match";

export type SyncUnmatchedEvent = {
  title: string;
  /** ISO start (Europe/Zurich wall time from Google). */
  start: string;
  reason: SyncUnmatchedReason;
  /** Close active student names (typo / partial). */
  suggestions?: string[];
  /** Active students the title matched when ambiguous. */
  ambiguousStudents?: string[];
  /** Inactive student(s) the title matched. */
  inactiveStudents?: string[];
};

const PERSONAL_HINT_RE =
  /\b(meeting|party|anrufen|openair|geschenk|kino|treuhänder|ferien|arzt|zahnarzt|flug|reise|geburtstag)\b/i;

export function nameMatchesTitle(studentName: string, titleLower: string): boolean {
  const nameLower = studentName.toLowerCase().trim();
  if (!nameLower) return false;
  const escaped = nameLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?<![a-zäöü])${escaped}(?![a-zäöü])`, "i");
  return regex.test(titleLower);
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) row[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/** Suggest active students whose name is close to the calendar title. */
export function suggestCloseStudentNames(
  title: string,
  activeNames: string[],
  limit = 2
): string[] {
  const titleNorm = title.toLowerCase().trim();
  if (!titleNorm || activeNames.length === 0) return [];

  const scored = activeNames
    .map((name) => {
      const n = name.toLowerCase().trim();
      const dist = levenshtein(titleNorm, n);
      const maxLen = Math.max(titleNorm.length, n.length);
      const ratio = maxLen === 0 ? 1 : dist / maxLen;
      const firstWord = titleNorm.split(/\s+/)[0] ?? "";
      const nameFirst = n.split(/\s+/)[0] ?? "";
      const firstClose =
        firstWord.length >= 3 &&
        nameFirst.length >= 3 &&
        levenshtein(firstWord, nameFirst) <= 1;
      return { name, dist, ratio, firstClose };
    })
    .filter((x) => x.dist <= 2 || x.ratio <= 0.34 || x.firstClose)
    .sort((a, b) => a.dist - b.dist || a.ratio - b.ratio);

  return scored.slice(0, limit).map((x) => x.name);
}

export function looksLikePersonalEvent(title: string): boolean {
  return PERSONAL_HINT_RE.test(title);
}

export function formatUnmatchedWhen(startIso: string): string {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One clear German sentence for a mismatch row. */
export function formatUnmatchedHeadline(item: SyncUnmatchedEvent): string {
  const when = formatUnmatchedWhen(item.start);
  const whenPart = when ? ` am ${when}` : "";
  const title = item.title.trim() || "(Ohne Titel)";

  if (item.reason === "ambiguous") {
    const names = item.ambiguousStudents?.join(", ") ?? "mehreren Schülern";
    return `«${title}»${whenPart} — passt zu mehreren Schülern: ${names}. Bitte im Kalender den eindeutigen Namen verwenden.`;
  }

  if (item.reason === "inactive_match") {
    const names = item.inactiveStudents?.join(", ") ?? "einem deaktivierten Schüler";
    return `«${title}»${whenPart} — Schüler «${names}» ist deaktiviert. Stunde wurde nicht übernommen.`;
  }

  // no_match
  if (item.suggestions && item.suggestions.length > 0) {
    return `«${title}»${whenPart} — kein aktiver Schüler mit diesem Namen. Meintest du: ${item.suggestions.join(" oder ")}?`;
  }

  if (looksLikePersonalEvent(title)) {
    return `«${title}»${whenPart} — wirkt nicht wie eine Nachhilfestunde (kein Schülername). Wird ignoriert.`;
  }

  return `«${title}»${whenPart} — kein aktiver Schüler mit diesem Namen. Kalendertitel anpassen oder Schüler anlegen.`;
}

export function unmatchedActionHint(item: SyncUnmatchedEvent): string {
  if (item.reason === "ambiguous") {
    return "Im Google-Kalender den genauen Schülernamen als Titel setzen (wie in der Schülerliste).";
  }
  if (item.reason === "inactive_match") {
    return "Schüler wieder aktivieren, oder Kalendereintrag umbenennen.";
  }
  if (item.suggestions?.length) {
    return "Kalendertitel auf den Vorschlag korrigieren, dann erneut syncen.";
  }
  if (looksLikePersonalEvent(item.title)) {
    return "Kein Handlungsbedarf, wenn das kein Schülertermin ist.";
  }
  return "Namen im Kalender an den Schülernamen anpassen, oder neuen Schüler anlegen.";
}
