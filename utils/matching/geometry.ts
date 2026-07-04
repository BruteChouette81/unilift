export type LatLng = { lat: number; lng: number };
export type ProjectionResult = { point: LatLng; progress: number };
export type DetourResult = { detourKm: number; pickupProgress: number };

const EARTH_R = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

// Returns the closest point on segment [A,B] to P and t∈[0,1] along AB.
export function closestPointOnSegment(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): ProjectionResult {
  const dx = b.lat - a.lat;
  const dy = b.lng - a.lng;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { point: a, progress: 0 };
  const t = Math.max(
    0,
    Math.min(1, ((p.lat - a.lat) * dx + (p.lng - a.lng) * dy) / lenSq),
  );
  return {
    point: { lat: a.lat + t * dx, lng: a.lng + t * dy },
    progress: t,
  };
}

// Walks the decoded polyline and returns the global progress [0,1] of the
// point on the polyline closest to p, plus that closest point.
export function projectOntoPolyline(
  p: LatLng,
  poly: LatLng[],
): ProjectionResult {
  if (poly.length === 0) return { point: p, progress: 0 };
  if (poly.length === 1) return { point: poly[0], progress: 0 };

  // Pre-compute cumulative chord lengths to convert per-segment t to global progress.
  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = haversineKm(poly[i], poly[i + 1]);
    segLengths.push(d);
    totalLen += d;
  }
  if (totalLen === 0) return { point: poly[0], progress: 0 };

  let bestDist = Infinity;
  let bestPoint: LatLng = poly[0];
  let bestProgress = 0;
  let cumLen = 0;

  for (let i = 0; i < poly.length - 1; i++) {
    const { point, progress: t } = closestPointOnSegment(p, poly[i], poly[i + 1]);
    const d = haversineKm(p, point);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = point;
      bestProgress = (cumLen + t * segLengths[i]) / totalLen;
    }
    cumLen += segLengths[i];
  }

  return { point: bestPoint, progress: bestProgress };
}

// Computes the detour (km) the driver incurs to pick up the passenger.
// Returns null if the passenger's closest point on the route is past 95% progress
// (they're essentially at the destination already).
export function computeDetour(
  passengerOrigin: LatLng,
  driverOrigin: LatLng,
  poly: LatLng[],
): DetourResult | null {
  const { point: closestPt, progress } = projectOntoPolyline(passengerOrigin, poly);
  if (progress > 0.95) return null;

  // detour = dist(driver → passenger) + dist(passenger → closest-on-route) − dist(driver → closest-on-route)
  const detourKm = Math.max(
    0,
    haversineKm(driverOrigin, passengerOrigin) +
      haversineKm(passengerOrigin, closestPt) -
      haversineKm(driverOrigin, closestPt),
  );

  return { detourKm, pickupProgress: progress };
}
