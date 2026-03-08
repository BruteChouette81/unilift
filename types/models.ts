import type { User } from "firebase/auth";

export type AuthStatus = "initializing" | "authenticated" | "unauthenticated";

export type AuthState = {
  user: User | null;
  loading: boolean;
  status: AuthStatus;
  authActionLoading: boolean;
};

export type LocationPoint = {
  latitude: number;
  longitude: number;
};

export type FavoriteRoute = {
  destination: string;
  destinationGeo: {
    lat: number;
    lon: number;
  };
};

export type UserProfile = {
  name?: string;
  email: string;
  xp: number;
  rating: number;
  avatar: string | null;
  homeAddress: string | null;
  localisation: {
    latitude: number | null;
    longitude: number | null;
  };
  ridesCompleted: number;
  favorite: FavoriteRoute[];
  age?: number;
  school?: string;
  preferences?: string[];
  walletBalance?: number;      // in cents
  stripeCustomerId?: string;
};

export type WalletTransaction = {
  id: string;
  type: "topup" | "cashout";
  amount: number;              // in cents
  status: "completed" | "pending" | "failed";
  description: string;
  createdAt: string;           // ISO string
  stripePaymentIntentId?: string;
};

export type RideStatus = "planned" | "started" | "arrived" | "completed";

export type Ride = {
  id: string;
  destination: string;
  destinationCoords: LocationPoint;
  date?: string;
  seatsAvailable: number;
  time?: string;
  driverId: string;
  passengers: string[];
  localisation: LocationPoint;
  started?: boolean;
  status: RideStatus | string;
};

export type ScoreBreakdown = {
  distance:   number;  // 0–1
  time:       number;  // 0–1
  direction:  number;  // 0–1
  preference: number;  // 0–1
  composite:  number;  // weighted sum
};

export type ScoredRide = Ride & {
  score: number;
  scoreBreakdown: ScoreBreakdown;
};

export type StartRidePayload = {
  originLat: number;
  originLng: number;
  destination: string;
};
