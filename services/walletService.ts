import { apiFetch, apiBaseUrl } from "@/constants/runtime-config";

const walletFetch = async (
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
) => {
  const res = await apiFetch(`${apiBaseUrl}${path}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
