import { describe, expect, it } from "vitest";
import { nameMatchesTitle, preferMostSpecificMatch } from "./sync-unmatched";

/** Wie in der Route: erst alle Namenstreffer, dann den spezifischsten wählen. */
function match(title: string, names: string[]): string[] {
  const titleLower = title.toLowerCase();
  const hits = names.filter((name) => nameMatchesTitle(name, titleLower)).map((name) => ({ name }));
  return preferMostSpecificMatch(hits).map((s) => s.name);
}

describe("preferMostSpecificMatch", () => {
  const roster = ["Liam", "Liam Bradbury", "Sophie"];

  it("wählt den vollen Namen, wenn der Titel exakt passt", () => {
    expect(match("Liam Bradbury", roster)).toEqual(["Liam Bradbury"]);
  });

  it("wählt den vollen Namen auch mit Zusatz im Titel", () => {
    expect(match("Nachhilfe Liam Bradbury Mathe", roster)).toEqual(["Liam Bradbury"]);
  });

  it("lässt den kurzen Namen allein stehen", () => {
    expect(match("Liam", roster)).toEqual(["Liam"]);
  });

  it("bleibt mehrdeutig bei zwei unabhängigen Namen", () => {
    expect(match("Liam und Sophie", roster).sort()).toEqual(["Liam", "Sophie"]);
  });

  it("bleibt mehrdeutig bei zwei Schülern mit demselben Namen", () => {
    expect(preferMostSpecificMatch([{ name: "Liam" }, { name: "Liam" }])).toHaveLength(2);
  });

  it("lässt einzelne oder leere Treffer unverändert", () => {
    expect(preferMostSpecificMatch([])).toEqual([]);
    expect(preferMostSpecificMatch([{ name: "Liam" }])).toEqual([{ name: "Liam" }]);
  });
});
