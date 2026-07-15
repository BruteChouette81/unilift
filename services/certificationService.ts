// Client wrappers over the apiSandbox certification endpoints. Certifications are
// server-authoritative: the client never writes the `certifications` field
// directly — it asks the Cloud Function to grant a tier, and the function
// (admin SDK) verifies + writes it. All calls are dev/sandbox-only.
import { apiBaseUrl, apiFetch, devLog, devWarn, isDev } from "@/constants/runtime-config";

export type CertResult =
  | { ok: true }
  | { ok: false; error: string };

const notInDev: CertResult = { ok: false, error: "unavailable" };

async function postCert(
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
): Promise<CertResult> {
  if (!isDev) return notInDev;
  try {
    const res = await apiFetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error ?? `http_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Adult certification — start a Stripe Identity verification session and return
 *  its hosted URL. The badge is granted server-side by the Stripe webhook once
 *  the check passes (never here). `returnUrl` is the app deep link Stripe
 *  redirects to on completion. */
export type AdultSessionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function createAdultVerificationSession(
  idToken: string,
  returnUrl: string,
): Promise<AdultSessionResult> {
  if (!isDev) return { ok: false, error: "unavailable" };
  const url = `${apiBaseUrl}/cert/adult/session`;
  devLog("[CERT-DEBUG] createAdultVerificationSession: POST", url, "returnUrl=", returnUrl);
  try {
    const res = await apiFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ returnUrl }),
    });
    const raw = await res.text();
    devLog("[CERT-DEBUG] createAdultVerificationSession: HTTP", res.status, "body=", raw.slice(0, 500));
    let data: { url?: string; error?: string } = {};
    try {
      data = raw ? (JSON.parse(raw) as { url?: string; error?: string }) : {};
    } catch {
      devWarn("[CERT-DEBUG] createAdultVerificationSession: body is not JSON");
    }
    if (!res.ok || !data.url) {
      const error = data.error ?? `http_${res.status}`;
      devWarn("[CERT-DEBUG] createAdultVerificationSession: returning error", error);
      return { ok: false, error };
    }
    return { ok: true, url: data.url };
  } catch (e) {
    devWarn(
      "[CERT-DEBUG] createAdultVerificationSession: network/fetch threw",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    );
    return { ok: false, error: "network" };
  }
}

/** Adult certification — client-driven reconcile. Called after returning from the
 *  Stripe flow: the server reads the verification result straight from Stripe and
 *  grants on a verified 18+ outcome, so the badge lands even if the webhook is
 *  delayed/unconfigured. `status` mirrors the Stripe session status; `granted`
 *  is true once the tier is written. */
export type AdultReconcileResult =
  | { ok: true; status: string; granted: boolean }
  | { ok: false; error: string };

export async function reconcileAdultVerification(
  idToken: string,
): Promise<AdultReconcileResult> {
  if (!isDev) return { ok: false, error: "unavailable" };
  const url = `${apiBaseUrl}/cert/adult/reconcile`;
  try {
    const res = await apiFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({}),
    });
    const raw = await res.text();
    devLog("[CERT-DEBUG] reconcileAdultVerification: HTTP", res.status, "body=", raw.slice(0, 500));
    let data: { status?: string; granted?: boolean; error?: string } = {};
    try {
      data = raw ? (JSON.parse(raw) as typeof data) : {};
    } catch {
      devWarn("[CERT-DEBUG] reconcileAdultVerification: body is not JSON");
    }
    if (!res.ok) return { ok: false, error: data.error ?? `http_${res.status}` };
    return { ok: true, status: data.status ?? "unknown", granted: data.granted === true };
  } catch (e) {
    devWarn(
      "[CERT-DEBUG] reconcileAdultVerification: network/fetch threw",
      e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    );
    return { ok: false, error: "network" };
  }
}

/** Student certification — request a confirmation link be sent to a school
 *  email. The badge is granted only once the user opens that link. */
export function requestStudentVerification(
  idToken: string,
  schoolEmail: string,
): Promise<CertResult> {
  return postCert("/cert/student/request", idToken, { schoolEmail });
}
