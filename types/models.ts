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

export type StartRidePayload = {
  originLat: number;
  originLng: number;
  destination: string;
};
