// context/AuthContext.tsx
import { auth } from "@/firebaseConfig";
import { onAuthStateChanged, type Auth, User, type UserCredential } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type AuthState, type AuthStatus } from "@/types/models";
import { isDev } from "@/constants/runtime-config";
import { goOffline } from "@/services/driverSessionService";
import {
  ensureSessionIsValid,
  signInWithApple as signInWithAppleService,
  signInWithEmail,
  signOutUser as signOutService,
  signUpWithEmail,
} from "@/services/authService";

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signInWithApple: () => Promise<UserCredential>;
  signUp: (
    name: string,
    email: string,
    password: string,
  ) => Promise<UserCredential>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const firebaseAuth: Auth = auth;
const INSTALL_MARKER_KEY = "unilift.install.marker.v1";
const createRequestInProgressError = () => {
  const error = new Error("An authentication request is already in progress.");
  (error as Error & { code: string }).code = "auth/request-in-progress";
  return error;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("initializing");
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [installCheckDone, setInstallCheckDone] = useState(false);
  const sessionCheckInFlightRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const ensureFreshInstallState = async () => {
      try {
        const marker = await AsyncStorage.getItem(INSTALL_MARKER_KEY);
        if (!marker) {
          if (firebaseAuth.currentUser) {
            await signOutService().catch(() => {});
            if (mounted) {
              setUser(null);
              setStatus("unauthenticated");
            }
          }
          await AsyncStorage.setItem(INSTALL_MARKER_KEY, "1");
        }
      } finally {
        if (mounted) {
          setInstallCheckDone(true);
        }
      }
    };

    void ensureFreshInstallState();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (firebaseUser) => {
      setUser(firebaseUser);
      setStatus(firebaseUser ? "authenticated" : "unauthenticated");
      setAuthActionLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", async (state) => {
      if (
        state !== "active" ||
        !firebaseAuth.currentUser ||
        authActionLoading ||
        sessionCheckInFlightRef.current
      ) {
        return;
      }

      sessionCheckInFlightRef.current = true;

      try {
        const validity = await ensureSessionIsValid();
        // Only force a sign-out when Firebase definitively rejects the session.
        // A transient failure ("unknown") — e.g. the network blip that happens
        // when returning from Google Maps — must NOT log the user out, since the
        // persisted session is still valid.
        if (validity !== "invalid") return;

        await signOutService();
        setUser(null);
        setStatus("unauthenticated");
      } finally {
        sessionCheckInFlightRef.current = false;
      }
    });

    return () => subscription.remove();
  }, [authActionLoading]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      loading: status === "initializing" || !installCheckDone,
      authActionLoading,
      signIn: async (email: string, password: string) => {
        if (authActionLoading) {
          throw createRequestInProgressError();
        }

        setAuthActionLoading(true);
        try {
          return await signInWithEmail(email, password);
        } finally {
          setAuthActionLoading(false);
        }
      },
      signInWithApple: async () => {
        if (authActionLoading) {
          throw createRequestInProgressError();
        }

        setAuthActionLoading(true);
        try {
          return await signInWithAppleService();
        } finally {
          setAuthActionLoading(false);
        }
      },
      signUp: async (name: string, email: string, password: string) => {
        if (authActionLoading) {
          throw createRequestInProgressError();
        }

        setAuthActionLoading(true);
        try {
          return await signUpWithEmail(name, email, password);
        } finally {
          setAuthActionLoading(false);
        }
      },
      signOutUser: async () => {
        if (authActionLoading) {
          throw createRequestInProgressError();
        }

        setAuthActionLoading(true);
        try {
          // End any live driver session first — it needs a valid ID token, and
          // nothing server-side expires sessions, so signing out while online
          // would otherwise leave the driver advertised forever. Dev-gated and
          // best-effort: it must never be able to block a sign-out.
          if (isDev) {
            try { await goOffline(); } catch { /* non-fatal */ }
          }
          await signOutService();
          // Keep navigation state deterministic even if auth listener is delayed.
          setUser(null);
          setStatus("unauthenticated");
        } finally {
          setAuthActionLoading(false);
        }
      },
    }),
    [authActionLoading, installCheckDone, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
