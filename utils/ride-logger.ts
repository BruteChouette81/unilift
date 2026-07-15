/**
 * Structured, dev-only ride logger.
 *
 * Extends the existing `devLog`/`devWarn` convention (see
 * `constants/runtime-config.ts`) into a small leveled/tagged logger with an
 * in-memory ring buffer so the on-device Dev Ride Panel can live-tail logs
 * without a USB Metro console.
 *
 * Everything here is a **no-op in production** (gated on `isDev`), so there is
 * zero cost in preview/prod builds. Console output stays greppable: it is
 * prefixed `[RIDE:{tag}]` alongside the existing `[RIDE-DEBUG]` lines.
 */
import { isDev } from "@/constants/runtime-config";

export type RideLogLevel = "info" | "warn" | "error";

/** Short category so the viewer can filter by concern. */
export type RideLogTag =
  | "passenger"
  | "driver"
  | "dispatch"
  | "payment"
  | "qr"
  | "dev";

export interface RideLogEntry {
  id: number;
  ts: number;
  level: RideLogLevel;
  tag: RideLogTag;
  msg: string;
  data?: unknown;
}

const MAX_ENTRIES = 300;

const buffer: RideLogEntry[] = [];
let nextId = 1;

type Listener = (entries: RideLogEntry[]) => void;
const listeners = new Set<Listener>();

function emit(): void {
  // Hand out a shallow copy so subscribers can't mutate our buffer.
  const snapshot = buffer.slice();
  for (const cb of listeners) {
    try {
      cb(snapshot);
    } catch {
      // A broken subscriber must never break logging.
    }
  }
}

function push(level: RideLogLevel, tag: RideLogTag, msg: string, data?: unknown): void {
  if (!isDev) return;

  const entry: RideLogEntry = { id: nextId++, ts: Date.now(), level, tag, msg, data };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);

  const prefix = `[RIDE:${tag}]`;
  const line = data !== undefined ? [prefix, msg, data] : [prefix, msg];
  if (level === "error") console.error(...line);
  else if (level === "warn") console.warn(...line);
  else console.log(...line);

  emit();
}

export const rideLog = {
  info: (tag: RideLogTag, msg: string, data?: unknown): void => push("info", tag, msg, data),
  warn: (tag: RideLogTag, msg: string, data?: unknown): void => push("warn", tag, msg, data),
  error: (tag: RideLogTag, msg: string, data?: unknown): void => push("error", tag, msg, data),
  /** Log a state-machine transition, e.g. `transition("passenger", "pending", "accepted")`. */
  transition: (
    entity: string,
    from: string | null | undefined,
    to: string,
    data?: unknown,
  ): void => push("info", "dev", `${entity}: ${from ?? "?"} → ${to}`, data),
};

/** Current buffered entries (oldest first). */
export function getRideLogBuffer(): RideLogEntry[] {
  return buffer.slice();
}

/** Subscribe to buffer changes; returns an unsubscribe function. Fires immediately. */
export function subscribeRideLog(cb: Listener): () => void {
  listeners.add(cb);
  cb(buffer.slice());
  return () => {
    listeners.delete(cb);
  };
}

export function clearRideLog(): void {
  buffer.length = 0;
  emit();
}

/** Render the buffer as plain text for copy-to-clipboard. */
export function formatRideLog(entries: RideLogEntry[] = buffer): string {
  return entries
    .map((e) => {
      const time = new Date(e.ts).toISOString().slice(11, 23);
      const data = e.data !== undefined ? ` ${safeStringify(e.data)}` : "";
      return `${time} [${e.level.toUpperCase()}][${e.tag}] ${e.msg}${data}`;
    })
    .join("\n");
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
