import type { User } from "firebase/auth";
import type { Language } from "@/constants/translations";

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
  language?: Language;
  expoPushToken?: string;
};

export type WalletTransaction = {
  id: string;
  type: "topup" | "cashout" | "ride_charge" | "ride_earning";
  amount: number;              // in cents
  status: "completed" | "pending" | "failed";
  description: string;
  createdAt: string;           // ISO string
  stripePaymentIntentId?: string;
  rideId?: string;
  distanceKm?: number;
};

export type QrBoardingToken = {
  rideId: string;
  driverUid: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type JoinRequestStatus = "pending" | "accepted" | "rejected";

export type JoinRequest = {
  passengerId: string;
  location: LocationPoint;
  status: JoinRequestStatus;
  requestedAt: string;
};

export type RideStatus = "planned" | "started" | "completed";

export type Ride = {
  id: string;
  destination: string;
  destinationCoords: LocationPoint;
  date?: string;
  seatsAvailable: number;
  time?: string;
  driverId: string;
  driverName?: string;
  driverAvatar?: string;
  passengers: string[];
  localisation: LocationPoint;
  started?: boolean;
  status: RideStatus | string;
  boardedPassengers?: string[];
  joinRequests?: Record<string, JoinRequest>;
  driverLocation?: LocationPoint;
  pendingRatings?: string[];
  ratingsSubmitted?: string[];
  qrToken?: string;
  qrTokenExpiresAt?: string;
  paymentStatus?: "pending" | "processing" | "completed" | "failed";
  distanceKm?: number;
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
  destinationLat: number;
  destinationLng: number;
};
