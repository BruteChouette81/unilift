import { apiFetch, apiBaseUrl, socialClientIds } from "@/constants/runtime-config";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { User } from "firebase/auth";
import { useEffect, useState } from "react";

WebBrowser.maybeCompleteAuthSession();

// ─────────────────────────────────────────────────────────────────────────────
// Generic OAuth *authorization-code* connector for Instagram, TikTok and
// Spotify. The client only obtains the short-lived `code` (+ PKCE verifier for
// TikTok); the secret-bearing exchange happens server-side at
// POST {apiBaseUrl}/social/link/{provider}. Facebook keeps its own hook
// (use-facebook-auth.ts) because it uses the implicit token flow.
// ─────────────────────────────────────────────────────────────────────────────

export type SocialProvider = "instagram" | "tiktok" | "spotify";

export type SocialLinkResult =
  | { ok: true; id: string; handle: string }
  | { ok: false; error: "cancelled" | "already_linked" | "failed" };

type ProviderSpec = {
  scopes: string[];
  usePKCE: boolean;
  authorizationEndpoint: string;
  /** TikTok's authorize endpoint expects `client_key` rather than `client_id`. */
  clientIdParamName?: string;
};

const PROVIDERS: Record<SocialProvider, ProviderSpec> = {
  instagram: {
    scopes: ["instagram_business_basic"],
    usePKCE: false,
    authorizationEndpoint: "https://www.instagram.com/oauth/authorize",
  },
  tiktok: {
    scopes: ["user.info.basic"],
    usePKCE: true,
    authorizationEndpoint: "https://www.tiktok.com/v2/auth/authorize/",
    clientIdParamName: "client_key",
  },
  spotify: {
    scopes: ["user-read-private", "user-read-email"],
    usePKCE: false,
    authorizationEndpoint: "https://accounts.spotify.com/authorize",
  },
};

export function useSocialConnect(provider: SocialProvider, user: User | null) {
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const clientId = socialClientIds[provider];
  const spec = PROVIDERS[provider];

  // A per-provider path keeps the redirect deterministic and avoids collisions
  // with the Facebook flow's redirect.
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "unilift",
    path: `oauth/${provider}`,
  });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId,
      scopes: spec.scopes,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: spec.usePKCE,
      redirectUri,
      // TikTok reads `client_key`; AuthSession always sends `client_id` too,
      // which TikTok ignores.
      extraParams: spec.clientIdParamName
        ? { [spec.clientIdParamName]: clientId }
        : undefined,
    },
    { authorizationEndpoint: spec.authorizationEndpoint },
  );

  type ResolveCallback = (result: SocialLinkResult) => void;
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

      const code = response.params?.code;
      if (!code || !user) {
        setLinking(false);
        resolve({ ok: false, error: "failed" });
        return;
      }

      try {
        const idToken = await user.getIdToken();
        const res = await apiFetch(`${apiBaseUrl}/social/link/${provider}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            code,
            codeVerifier: request?.codeVerifier,
            redirectUri,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (res.status === 409) {
          resolve({ ok: false, error: "already_linked" });
          return;
        }
        if (!res.ok) {
          resolve({ ok: false, error: "failed" });
          return;
        }
        resolve({ ok: true, id: data.id, handle: data.handle });
      } catch {
        resolve({ ok: false, error: "failed" });
      } finally {
        setLinking(false);
      }
    };

    void handleResponse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  const connect = (): Promise<SocialLinkResult> => {
    if (!request || !clientId) {
      return Promise.resolve({ ok: false, error: "failed" });
    }
    setLinking(true);
    return new Promise<SocialLinkResult>((resolve) => {
      setPendingResolve(() => resolve);
      void promptAsync();
    });
  };

  const disconnect = async (): Promise<boolean> => {
    if (!user) return false;
    setUnlinking(true);
    try {
      const idToken = await user.getIdToken();
      const res = await apiFetch(`${apiBaseUrl}/social/unlink/${provider}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      setUnlinking(false);
    }
  };

  return {
    connect,
    disconnect,
    linking,
    unlinking,
    redirectUri,
    /** False when this provider has no configured client id (button disabled). */
    configured: !!clientId,
  };
}
