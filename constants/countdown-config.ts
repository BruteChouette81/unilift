import { createContext, useContext } from "react";

/**
 * LOCAL FALLBACKS — used when the Firestore config doc cannot be reached.
 * The live values are controlled from Firebase Console → Firestore →
 * config/countdown → { enabled: bool, endDate: ISO string }.
 */
export const COUNTDOWN_ENABLED = true;
export const COUNTDOWN_END_DATE = "2026-04-26T00:00:00-04:00"; // America/Montreal

export const COUNTDOWN_END_MS = new Date(COUNTDOWN_END_DATE).getTime();

export function isCountdownActive(
  enabled: boolean = COUNTDOWN_ENABLED,
  endMs: number = COUNTDOWN_END_MS,
  nowMs: number = Date.now(),
): boolean {
  return enabled && nowMs < endMs;
}

// ── Remote config context ──────────────────────────────────────────────────

export type CountdownRemoteConfig = {
  enabled: boolean;
  endMs: number;
  endDate: string;
  loading: boolean;
};

export const defaultCountdownConfig: CountdownRemoteConfig = {
  enabled: COUNTDOWN_ENABLED,
  endMs: COUNTDOWN_END_MS,
  endDate: COUNTDOWN_END_DATE,
  loading: true,
};

export const CountdownConfigContext =
  createContext<CountdownRemoteConfig>(defaultCountdownConfig);

export function useCountdownRemoteConfig(): CountdownRemoteConfig {
  return useContext(CountdownConfigContext);
}
