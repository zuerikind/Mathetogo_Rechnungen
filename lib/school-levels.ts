/**
 * Schulstufen und wohin ein Schueler nach dem Sommer typischerweise wechselt.
 *
 * Die Stufe wird als Text am Schueler gespeichert. Eigene Stufen (alles, was
 * hier nicht steht) sind erlaubt — fuer sie gibt es nur keinen Vorschlag.
 */

export type LevelGroup = { group: string; levels: string[] };

const years = (prefix: (n: number) => string, n: number) =>
  Array.from({ length: n }, (_, i) => prefix(i + 1));

/** Langzeitgymnasium 1–6; ab der 3. Klasse laeuft das Kurzzeitgymnasium parallel. */
const gymLabel = (n: number) => (n >= 3 ? `${n}. Gymnasium (= ${n - 2}. Kurzzeit)` : `${n}. Gymnasium`);

const UNIS = ["Fachhochschule", "UZH", "ETH", "HSG"] as const;
const studyLabel = (uni: string, n: number) => `${uni} Jahr ${n}`;

export const LEVEL_GROUPS: LevelGroup[] = [
  { group: "Primarschule", levels: years((n) => `${n}. Primar`, 6) },
  { group: "Sekundarschule", levels: [...years((n) => `${n}. Sek`, 3), "10. Schuljahr"] },
  { group: "Gymnasium", levels: years(gymLabel, 6) },
  { group: "BMS", levels: years((n) => `BMS Jahr ${n}`, 2) },
  { group: "Matur-Vorbereitung", levels: ["Passerelle-Vorbereitung", "Erwachsenenmatur-Vorbereitung"] },
  ...UNIS.map((uni) => ({ group: uni === "Fachhochschule" ? uni : `Studium ${uni}`, levels: years((n) => studyLabel(uni, n), 5) })),
];

export const KNOWN_LEVELS = LEVEL_GROUPS.flatMap((g) => g.levels);

const firstStudyYears = UNIS.map((uni) => studyLabel(uni, 1));

/** Moegliche Stufen nach dem Sommer, die wahrscheinlichste zuerst. Leer = kein Vorschlag. */
export function nextLevels(level: string | null | undefined): string[] {
  if (!level) return [];
  let m: RegExpMatchArray | null;
  if ((m = level.match(/^(\d)\. Primar$/))) {
    const n = Number(m[1]);
    return n < 6 ? [`${n + 1}. Primar`] : ["1. Sek", gymLabel(1)];
  }
  if (level === "1. Sek") return ["2. Sek"];
  if (level === "2. Sek") return ["3. Sek", gymLabel(3)];
  if (level === "3. Sek") return ["10. Schuljahr", gymLabel(3), "BMS Jahr 1"];
  if (level === "10. Schuljahr") return ["BMS Jahr 1"];
  if ((m = level.match(/^(\d)\. Gymnasium/))) {
    const n = Number(m[1]);
    return n < 6 ? [gymLabel(n + 1)] : firstStudyYears;
  }
  if (level === "BMS Jahr 1") return ["BMS Jahr 2"];
  if (level === "BMS Jahr 2") return ["Fachhochschule Jahr 1", "Passerelle-Vorbereitung"];
  if (level === "Passerelle-Vorbereitung" || level === "Erwachsenenmatur-Vorbereitung") return firstStudyYears;
  if ((m = level.match(/^(.+) Jahr (\d)$/)) && (UNIS as readonly string[]).includes(m[1])) {
    const n = Number(m[2]);
    return n < 5 ? [studyLabel(m[1], n + 1)] : [];
  }
  return [];
}

/** Startjahr des Schuljahres: ab 1. August zaehlt das neue. */
export function currentSchoolYear(now: Date): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Hinweis noetig, sobald ein neues Schuljahr begonnen hat und es noch nicht bestaetigt ist. */
export function levelsReviewNeeded(reviewedYear: number | null | undefined, now: Date): boolean {
  return (reviewedYear ?? 0) < currentSchoolYear(now);
}
