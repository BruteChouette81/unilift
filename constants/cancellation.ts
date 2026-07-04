export const CANCELLATION_FEES = {
  passengerCancelCents: 0,
  driverCancelCents: 0,
  graceWindowMinutes: 2,
} as const;

export function isWithinGraceWindow(
  referenceIso: string | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!referenceIso) return false;
  const ts = new Date(referenceIso).getTime();
  if (!Number.isFinite(ts)) return false;
  const grace = CANCELLATION_FEES.graceWindowMinutes * 60_000;
  const age = nowMs - ts;
  return age >= 0 && age < grace;
}
