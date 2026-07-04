import {
  haversineKm,
  closestPointOnSegment,
  projectOntoPolyline,
  computeDetour,
  LatLng,
} from "../geometry";

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    const p: LatLng = { lat: 45.5, lng: -73.6 };
    expect(haversineKm(p, p)).toBeCloseTo(0, 5);
  });

  it("returns ~234 km between Montreal and Quebec City", () => {
    const montreal: LatLng = { lat: 45.5017, lng: -73.5673 };
    const quebecCity: LatLng = { lat: 46.8139, lng: -71.2082 };
    const dist = haversineKm(montreal, quebecCity);
    expect(dist).toBeGreaterThan(229);
    expect(dist).toBeLessThan(239);
  });
});

describe("closestPointOnSegment", () => {
  it("returns midpoint and progress 0.5 when point is directly above midpoint", () => {
    const a: LatLng = { lat: 0, lng: 0 };
    const b: LatLng = { lat: 2, lng: 0 };
    const p: LatLng = { lat: 1, lng: 1 }; // directly above midpoint of AB
    const { point, progress } = closestPointOnSegment(p, a, b);
    expect(progress).toBeCloseTo(0.5, 5);
    expect(point.lat).toBeCloseTo(1, 5);
    expect(point.lng).toBeCloseTo(0, 5);
  });
});

describe("projectOntoPolyline", () => {
  it("returns near-zero progress when passenger is at start of route", () => {
    const poly: LatLng[] = [
      { lat: 45.5, lng: -73.6 },
      { lat: 45.6, lng: -73.5 },
      { lat: 45.7, lng: -73.4 },
    ];
    // Passenger very close to first point
    const p: LatLng = { lat: 45.501, lng: -73.601 };
    const { progress } = projectOntoPolyline(p, poly);
    expect(progress).toBeLessThan(0.1);
  });
});

describe("computeDetour", () => {
  it("returns positive detour when passenger is off-route", () => {
    const driverOrigin: LatLng = { lat: 45.5, lng: -73.6 };
    const poly: LatLng[] = [
      driverOrigin,
      { lat: 45.6, lng: -73.5 },
      { lat: 45.7, lng: -73.4 },
    ];
    // Passenger well off to the side
    const passengerOrigin: LatLng = { lat: 45.55, lng: -73.8 };
    const result = computeDetour(passengerOrigin, driverOrigin, poly);
    expect(result).not.toBeNull();
    expect(result!.detourKm).toBeGreaterThan(0);
  });

  it("returns null when passenger progress > 0.95", () => {
    const driverOrigin: LatLng = { lat: 45.5, lng: -73.6 };
    const end: LatLng = { lat: 45.7, lng: -73.4 };
    const poly: LatLng[] = [driverOrigin, end];
    // Passenger right at the destination (>95% along)
    const passengerOrigin: LatLng = { lat: 45.699, lng: -73.401 };
    const result = computeDetour(passengerOrigin, driverOrigin, poly);
    expect(result).toBeNull();
  });
});
