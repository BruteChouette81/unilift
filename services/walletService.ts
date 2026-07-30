import { apiFetch, apiBaseUrl } from "@/constants/runtime-config";

// `fetch` has no built-in timeout: a stalled connection hangs forever, which
// strands callers that gate a spinner on the promise settling. Long enough to
// survive a Cloud Function cold start, short enough to surface a real error.
const REQUEST_TIMEOUT_MS = 20_000;

const walletFetch = async (
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await apiFetch(`${apiBaseUrl}${path}`, {
      method: body !== undefined ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Request timed out: ${path}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(await res.text());
  return res.json();
};

export const setupWallet = (token: string) =>
  walletFetch("/wallet/setup", token, {});

export const setupPaymentMethod = (token: string) =>
  walletFetch("/wallet/setup-payment-method", token, {});

export const confirmPaymentMethod = (token: string, setupIntentId: string) =>
  walletFetch("/wallet/confirm-payment-method", token, { setupIntentId });

export const removePaymentMethod = (token: string) =>
  walletFetch("/wallet/remove-payment-method", token, {});

export const getTransactions = (token: string) =>
  walletFetch("/wallet/transactions", token);

export const verifyCanJoin = (token: string) =>
  walletFetch("/rides/can-join", token, {});
