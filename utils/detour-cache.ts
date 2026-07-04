const CACHE_TTL_MS = 5 * 60 * 1000;

type Entry = { value: number; expiresAt: number };
const cache = new Map<string, Entry>();

function coordKey(lat: number, lng: number): string {
  // ~100m grid cells (3 decimal places ≈ 111m at the equator)
  return `${Math.round(lat * 1000)}_${Math.round(lng * 1000)}`;
}

// ─── Legacy single-pickup detour cache (kept for back-compat) ─────────────────

export function detourCacheGet(rideId: string, pickupLat: number, pickupLng: number): number | undefined {
  const key = `${rideId}_${coordKey(pickupLat, pickupLng)}`;
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.value;
}

export function detourCacheSet(rideId: string, pickupLat: number, pickupLng: number, detourKm: number): void {
  const key = `${rideId}_${coordKey(pickupLat, pickupLng)}`;
  cache.set(key, { value: detourKm, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Route-extension cache (pickup + dropoff) ─────────────────────────────────

function extensionKey(
  rideId: string,
  pickupLat: number, pickupLng: number,
  dropLat: number, dropLng: number,
): string {
  return `ext_${rideId}_${coordKey(pickupLat, pickupLng)}_${coordKey(dropLat, dropLng)}`;
}

export function routeExtensionCacheGet(
  rideId: string,
  pickupLat: number, pickupLng: number,
  dropLat: number, dropLng: number,
): number | undefined {
  const key = extensionKey(rideId, pickupLat, pickupLng, dropLat, dropLng);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return undefined; }
  return entry.value;
}

export function routeExtensionCacheSet(
  rideId: string,
  pickupLat: number, pickupLng: number,
  dropLat: number, dropLng: number,
  diffKm: number,
): void {
  const key = extensionKey(rideId, pickupLat, pickupLng, dropLat, dropLng);
  cache.set(key, { value: diffKm, expiresAt: Date.now() + CACHE_TTL_MS });
}
