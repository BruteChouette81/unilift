import { apiFetch, apiBaseUrl, facebookAppId } from "@/constants/runtime-config";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";

WebBrowser.maybeCompleteAuthSession();

// Facebook Graph API OAuth – implicit flow (response_type=token)
// The redirect URI must be registered in your Facebook Developer Portal:
//   Settings > Basic > App Domains  +  Facebook Login > Valid OAuth Redirect URIs
//   Add: https://auth.expo.io/@<your-expo-username>/unilift
const FACEBOOK_DISCOVERY = {
  authorizationEndpoint: "https://www.facebook.com/v18.0/dialog/oauth",
};

export type FacebookLinkResult =
  | { ok: true; facebookId: string; facebookName: string }
  | { ok: false; error: "cancelled" | "already_linked" | "invalid_token" | "unknown" };

export function useFacebookAuth(user: User | null) {
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: "unilift" });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: facebookAppId,
      scopes: ["public_profile"],
      responseType: AuthSession.ResponseType.Token,
      redirectUri,
      extraParams: {
        // Display mobile-optimised dialog
        display: "popup",
      },
    },
    FACEBOOK_DISCOVERY,
  );

  // Callback resolved after promptAsync resolves
  type ResolveCallback = (result: FacebookLinkResult) => void;
  const [pendingResolve, setPendingResolve] = useState<ResolveCallback | null>(null);

  useEffect(() => {
    if (!response || !pendingResolve) return;

    const resolve = pendingResolve;
    setPendingResolve(null);

    const handleResponse = async () => {
      if (response.type !== "success") {
        setLinking(false);
        resolve({ ok: false, error: "cancelled" });
        return;
      }

      const accessToken = response.params?.access_token;
      if (!accessToken || !user) {
        setLinking(false);
        resolve({ ok: false, error: "invalid_token" });
        return;
      }

      try {
        const idToken = await user.getIdToken();
        const res = await apiFetch(`${apiBaseUrl}/social/link-facebook`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ accessToken }),
        });

        const data = await res.json();

        if (res.status === 409) {
          resolve({ ok: false, error: "already_linked" });
          return;
        }
        if (!res.ok) {
          resolve({ ok: false, error: "invalid_token" });
          return;
        }

        resolve({ ok: true, facebookId: data.facebookId, facebookName: data.facebookName });
      } catch {
        resolve({ ok: false, error: "unknown" });
      } finally {
        setLinking(false);
      }
    };

    void handleResponse();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const connectFacebook = (): Promise<FacebookLinkResult> => {
    if (!request) {
      return Promise.resolve({ ok: false, error: "unknown" });
    }
    setLinking(true);
    return new Promise<FacebookLinkResult>((resolve) => {
      setPendingResolve(() => resolve);
      void promptAsync();
    });
  };

  const disconnectFacebook = async (): Promise<boolean> => {
    if (!user) return false;
    setUnlinking(true);
    try {
      const idToken = await user.getIdToken();
      const res = await apiFetch(`${apiBaseUrl}/social/unlink-facebook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setUnlinking(false);
    }
  };

  return {
    connectFacebook,
    disconnectFacebook,
    linking,
    unlinking,
    /** Redirect URI – useful to display to devs for Facebook App configuration */
    redirectUri,
  };
}
