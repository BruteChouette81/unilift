// Client wrappers over the apiSandbox Stripe Connect endpoints — how a DRIVER
// registers to get paid. Deliberately separate from services/walletService.ts,
// which is how a PASSENGER pays: a saved card is a pull-only credential and can
// never be a payout destination, so the two never share state.
//
// Connect status is server-authoritative. The client never writes
// stripeConnect* fields (firestore.rules denies it) — it asks the Cloud
// Function, which reads Stripe with the admin SDK and persists the result.
import { apiBaseUrl, apiFetch, devLog, devWarn } from "@/constants/runtime-config";

export type ConnectStatus = "none" | "pending" | "ready" | "restricted";

export type ConnectState = {
  status: ConnectStatus;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  bankLast4: string | null;
};

/** The safe half of a Stripe failure, classified server-side (classifyStripeError
 *  in both Cloud Functions codebases). Every field is a documented Stripe enum or
 *  an opaque `req_…` handle — never a key, an email or a name. `requestId` pastes
 *  straight into Stripe dashboard search. */
export type ConnectErrorDetail = {
  type?: string | null;
  code?: string | null;
  param?: string | null;
  requestId?: string | null;
  /** Which call failed: "account" or "link" for /connect/onboard. */
  step?: string | null;
};

type ConnectFailure = {
  ok: false;
  /** Stable app-level code: connect_not_enabled, stripe_auth, network, … */
  error: string;
  detail?: ConnectErrorDetail;
  /** Verbatim Stripe message. The server sends this only to an admin caller. */
  message?: string;
  status?: number;
};

type Result<T> = ({ ok: true } & T) | ConnectFailure;

/** What the driver can do right now, decided server-side so the button and the
 *  endpoint can never disagree about eligibility. */
export type PayoutSummary = {
  /** Payable at the next monthly run: the settled balance minus what this
   *  driver still owes in unsettled ride charges of their own. */
  availableCents: number;
  /** The full settled balance, before that offset is held back. */
  balanceCents: number;
  /** Unsettled ride charges held back from `balanceCents`. */
  outstandingChargeCents: number;
  /** This cycle's accrual — real money only after the next settlement. */
  pendingCents: number;
  /** What that accrual is worth after the driver's own charges: the figure that
   *  will actually land at settlement. */
  pendingNetCents: number;
  minPayoutCents: number;
  /** Stripe's Connect cost for this payout, deducted when it is queued. */
  payoutFeeCents: number;
  /** What actually reaches the bank: `availableCents` minus `payoutFeeCents`. */
  netPayoutCents: number;
  /** ISO date (YYYY-MM-DD) of the next automatic payout run. */
  nextPayoutDate: string;
  /** TEST-ONLY — delete with requestTestCashout below. Server decides this
   *  per-uid, so it is false for everyone but the one allowlisted account. */
  testCashoutEnabled?: boolean;
  /** Server's own view of whether this balance is payable. Drives the "not yet"
   *  copy, not a button — drivers no longer request payouts. */
  canCashout: boolean;
  reason:
    | "already_pending"
    | "payouts_not_enabled"
    | "below_minimum"
    /** Earned enough, but it is held back against their own unsettled charges. */
    | "offsetting_charges"
    /** A chargeback is open; payouts are frozen until it resolves. */
    | "dispute_open"
    | null;
  pendingRequest: { id: string; amountCents: number; status: string } | null;
};

async function postConnect<T>(
  path: string,
  idToken: string,
  body: Record<string, unknown> = {},
): Promise<Result<T>> {
  const url = `${apiBaseUrl}${path}`;
  try {
    const res = await apiFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    devLog("[CONNECT] POST", path, "→", res.status, raw.slice(0, 300));
    let data: Record<string, unknown> = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      devWarn("[CONNECT] response is not JSON:", path);
    }
    if (!res.ok) {
      // Carry the server's classification through rather than discarding it.
      // Without this the caller cannot tell "Connect is not enabled" from
      // "Stripe is down" from "your token expired" — all three collapsed into
      // one generic alert with nothing to report.
      return {
        ok: false,
        error: (data.error as string) ?? `http_${res.status}`,
        detail: data.detail as ConnectErrorDetail | undefined,
        message: data.message as string | undefined,
        status: res.status,
      };
    }
    return { ok: true, ...(data as T) };
  } catch (e) {
    devWarn("[CONNECT] network error:", path, e instanceof Error ? e.message : String(e));
    return { ok: false, error: "network" };
  }
}

async function getConnect<T>(path: string, idToken: string): Promise<Result<T>> {
  const url = `${apiBaseUrl}${path}`;
  try {
    const res = await apiFetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const raw = await res.text();
    devLog("[CONNECT] GET", path, "→", res.status, raw.slice(0, 300));
    let data: Record<string, unknown> = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      devWarn("[CONNECT] response is not JSON:", path);
    }
    if (!res.ok) {
      // Carry the server's classification through rather than discarding it.
      // Without this the caller cannot tell "Connect is not enabled" from
      // "Stripe is down" from "your token expired" — all three collapsed into
      // one generic alert with nothing to report.
      return {
        ok: false,
        error: (data.error as string) ?? `http_${res.status}`,
        detail: data.detail as ConnectErrorDetail | undefined,
        message: data.message as string | undefined,
        status: res.status,
      };
    }
    return { ok: true, ...(data as T) };
  } catch (e) {
    devWarn("[CONNECT] network error:", path, e instanceof Error ? e.message : String(e));
    return { ok: false, error: "network" };
  }
}

/**
 * Start (or resume) Stripe Express onboarding and return the hosted URL.
 *
 * `returnUrl` is the app deep link Stripe bounces back to. It is passed through
 * an https endpoint on the server because Stripe rejects custom schemes.
 *
 * The URL is single-use and expires minutes after it is minted, so it must be
 * fetched fresh on every tap — never cached, never stored.
 */
export function startConnectOnboarding(
  idToken: string,
  returnUrl: string,
): Promise<Result<{ url: string }>> {
  return postConnect<{ url: string }>("/connect/onboard", idToken, { returnUrl });
}

/**
 * Re-read the driver's Connect account from Stripe and persist the result.
 * Called after returning from onboarding: the account.updated webhook is the
 * primary path, but this makes the state land even if the webhook is delayed
 * or unconfigured.
 */
export function refreshConnectStatus(idToken: string): Promise<Result<ConnectState>> {
  return postConnect<ConnectState>("/connect/status", idToken);
}

/** One-time Express dashboard link — lets a driver change bank details or see
 *  their payout history after onboarding. */
export function openConnectDashboard(idToken: string): Promise<Result<{ url: string }>> {
  return postConnect<{ url: string }>("/connect/dashboard", idToken);
}

/** Current balance, and when the next automatic payout will send it. */
export function getPayoutSummary(idToken: string): Promise<Result<PayoutSummary>> {
  return getConnect<PayoutSummary>("/payouts/summary", idToken);
}

// ── TEST-ONLY — DELETE BEFORE LAUNCH ────────────────────────────────────────
/**
 * Queue a payout immediately, ignoring the $25 floor.
 *
 * Only works for the single uid in the server's TEST_CASHOUT_UID; everyone else
 * gets 403 `not_enabled`. Capped server-side at $5. The server debits the
 * balance inside the same transaction that creates the row, so a double tap
 * comes back `already_pending` rather than paying twice.
 */
export function requestTestCashout(
  idToken: string,
): Promise<Result<{ amountCents: number; payoutId: string }>> {
  return postConnect<{ amountCents: number; payoutId: string }>("/payouts/test-cashout", idToken);
}
// ── END TEST-ONLY ───────────────────────────────────────────────────────────

/**
 * Remove the driver's connected account, deleting their bank details at Stripe.
 *
 * Their settled balance is NOT affected — it lives in the UniLift wallet, not
 * in the Connect account, and keeps offsetting their own ride charges. They just
 * can't move it to a bank until they reconnect.
 *
 * Fails with `cashout_pending` if a transfer is already queued, and
 * `balance_not_zero` if Stripe is still holding money for them (a transfer that
 * landed but hasn't reached their bank yet).
 */
export function disconnectConnectAccount(
  idToken: string,
): Promise<Result<{ alreadyDisconnected?: boolean }>> {
  return postConnect<{ alreadyDisconnected?: boolean }>("/connect/disconnect", idToken);
}
