/**
 * Guards the school list against the two things that actually went wrong.
 *
 * The list previously lived inside `SignupScreen` and had accumulated seven
 * exact duplicates, which the picker rendered twice because it keys by index.
 * Nothing catches that by eye at ~60 entries, so it is asserted here.
 */
import { SCHOOLS, filterSchools, normalizeSchoolQuery } from "@/constants/schools";

describe("SCHOOLS", () => {
  it("has no duplicate entries", () => {
    const seen = new Map<string, number>();
    for (const school of SCHOOLS) {
      seen.set(school, (seen.get(school) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    expect(dupes).toEqual([]);
  });

  it("has no entries that differ only by apostrophe or accent", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const school of SCHOOLS) {
      const key = normalizeSchoolQuery(school);
      const prior = seen.get(key);
      if (prior && prior !== school) collisions.push(`${prior} / ${school}`);
      seen.set(key, school);
    }
    expect(collisions).toEqual([]);
  });

  it("is non-empty and free of blank or untrimmed entries", () => {
    expect(SCHOOLS.length).toBeGreaterThan(0);
    for (const school of SCHOOLS) {
      expect(school).toBe(school.trim());
      expect(school.length).toBeGreaterThan(0);
    }
  });
});

describe("filterSchools", () => {
  it("returns everything for a blank query", () => {
    expect(filterSchools("")).toEqual(SCHOOLS);
    expect(filterSchools("   ")).toEqual(SCHOOLS);
  });

  it("matches without accents", () => {
    expect(filterSchools("saint-jerome")).toContain("Cégep de Saint-Jérôme");
    expect(filterSchools("quebec a montreal")).toContain(
      "Université du Québec à Montréal",
    );
  });

  it("matches a curly apostrophe typed as a straight one", () => {
    // The entry holds U+2019; a phone keyboard usually sends U+0027.
    expect(filterSchools("l'outaouais")).toContain("Cégep de l’Outaouais");
  });

  it("is case-insensitive", () => {
    expect(filterSchools("MCGILL")).toContain("McGill University");
  });

  it("returns nothing for a query that matches no school", () => {
    expect(filterSchools("hogwarts")).toEqual([]);
  });
});
