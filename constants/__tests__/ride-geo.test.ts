import { MAX_SUGGESTION_DISTANCE_KM } from "@/constants/ride-geo";
import { haversineKm } from "@/utils/matching/geometry";

/**
 * Guards the 400 km suggestion cap. `geoSuggestion` applies it with exactly this
 * pair — MAX_SUGGESTION_DISTANCE_KM and haversineKm — so pinning the constant
 * and the real distances it has to separate keeps a well-meaning tweak from
 * silently letting cross-country results back into the search box.
 */
const MONTREAL = { lat: 45.5019, lng: -73.5674 };
const PLACES = {
  laval:     { lat: 45.6066, lng: -73.7124 },
  quebec:    { lat: 46.8139, lng: -71.2080 },
  ottawa:    { lat: 45.4215, lng: -75.6972 },
  toronto:   { lat: 43.6532, lng: -79.3832 },
  vancouver: { lat: 49.2827, lng: -123.1207 },
  paris:     { lat: 48.8566, lng: 2.3522 },
};

describe("MAX_SUGGESTION_DISTANCE_KM", () => {
  it("is 400 km", () => {
    expect(MAX_SUGGESTION_DISTANCE_KM).toBe(400);
  });

  it.each([
    ["laval", PLACES.laval],
    ["quebec", PLACES.quebec],
    ["ottawa", PLACES.ottawa],
  ])("keeps %s, a plausible rideshare from Montreal", (_name, place) => {
    expect(haversineKm(MONTREAL, place)).toBeLessThanOrEqual(MAX_SUGGESTION_DISTANCE_KM);
  });

  it.each([
    ["toronto", PLACES.toronto],
    ["vancouver", PLACES.vancouver],
    ["paris", PLACES.paris],
  ])("drops %s, which is a flight and not a ride", (_name, place) => {
    expect(haversineKm(MONTREAL, place)).toBeGreaterThan(MAX_SUGGESTION_DISTANCE_KM);
  });

  it("puts the Montreal-Toronto corridor just outside the cap", () => {
    // ~500 km. The cap is deliberately set below this: the doc comment calls
    // Montreal->Toronto the boundary case, so if someone raises the constant
    // past it this assertion is where they find out.
    const km = haversineKm(MONTREAL, PLACES.toronto);
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(550);
  });
});
