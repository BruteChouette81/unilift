// Client wrappers over the server's Google Maps proxy.
//
// The app used to call Directions, Geocoding, Place Autocomplete and Place
// Details directly, with an API key bundled into the JS. Google's Android/iOS
// application restrictions do not apply to those Web Service APIs — only IP
// restriction does, which a mobile client cannot satisfy — so that key was
// extractable from any install and billable by whoever extracted it.
//
// The key now lives only on the server (GOOGLE_MAPS_SERVER_KEY, IP-restricted).
// These wrappers hit authenticated `/maps/*` endpoints that pass Google's
// response through unchanged, so the parsers on the other side are untouched.
//
// The NATIVE map SDK still uses its own key from app.config.js — that one is
// restricted by bundle id / package name, which does work for the SDKs.
import { apiBaseUrl, apiFetch, devWarn } from "@/constants/runtime-config";
import { getAuth } from "firebase/auth";

async function mapsGet(
  path: string,
  params: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<any | null> {
  const token = await getAuth().currentUser?.getIdToken();
  if (!token) {
    devWarn("[maps] no auth token; skipping", path);
    return null;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  try {
    const res = await apiFetch(`${apiBaseUrl}${path}?${qs.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok) {
      devWarn(`[maps] ${path} HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return null;
    devWarn(`[maps] ${path} failed:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function mapsDirections(
  origin: string,
  destination: string,
  waypoints?: string,
  signal?: AbortSignal,
): Promise<any | null> {
  return mapsGet("/maps/directions", { origin, destination, waypoints }, signal);
}

export function mapsGeocode(address: string, signal?: AbortSignal): Promise<any | null> {
  return mapsGet("/maps/geocode", { address }, signal);
}

export function mapsPlaceAutocomplete(
  input: string,
  signal?: AbortSignal,
): Promise<any | null> {
  return mapsGet("/maps/place-autocomplete", { input, language: "fr" }, signal);
}

export function mapsPlaceDetails(
  placeId: string,
  signal?: AbortSignal,
): Promise<any | null> {
  return mapsGet("/maps/place-details", { placeId }, signal);
}
