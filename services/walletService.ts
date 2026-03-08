import { apiBaseUrl } from "@/constants/runtime-config";

const walletFetch = async (
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
) => {
  const res = await fetch(`${apiBaseUrl}${path}`, {
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

export const addFunds = (token: string, amountCents: number) =>
  walletFetch("/wallet/add-funds", token, { amountCents });

export const confirmPayment = (token: string, paymentIntentId: string) =>
  walletFetch("/wallet/confirm", token, { paymentIntentId });

export const requestCashout = (token: string, amountCents: number) =>
  walletFetch("/wallet/cashout", token, { amountCents });

export const getTransactions = (token: string) =>
  walletFetch("/wallet/transactions", token);
