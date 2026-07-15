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
  homeAddressCoords?: { latitude: number; longitude: number } | null;
  localisation: {
    latitude: number | null;
    longitude: number | null;
  };
  ridesCompleted: number;
  favorite: FavoriteRoute[];
  age?: number;
  birthDate?: string;
  school?: string;
  preferences?: string[];
  /** Identity certifications the user holds (stackable): subset of
   *  ["adult","student"]. Absent/empty = uncertified. Written only by the
   *  apiSandbox Cloud Function — never by the client. */
  certifications?: string[];
  walletBalance?: number;            // legacy wallet balance (in cents)
  pendingChargeCents?: number;       // passenger: accumulated unpaid ride charges (in cents)
  pendingEarningsCents?: number;     // driver: accumulated unpaid earnings (in cents)
  stripePaymentMethodId?: string;    // saved Stripe PM id (e.g. "pm_xxx")
  stripePaymentMethodLast4?: string; // last 4 digits for display
  stripePaymentMethodBrand?: string; // "visa", "mastercard", etc.
  stripeCustomerId?: string;
  language?: Language;
  expoPushToken?: string;
  /** Hype-event ids the user has marked as interested (powers the profile list). */
  interestedEvents?: string[];
  facebookId?: string;
  facebookName?: string;
  instagramId?: string;
  instagramHandle?: string;
  tiktokId?: string;
  tiktokHandle?: string;
  spotifyId?: string;
  spotifyName?: string;
  // ── Driver mode (recurring availability) ─────────────────────────────────
  /** Simple ON/OFF driver-mode flag. When enabled (or absent — absent is treated
   *  as ON for reach), the user is notified of every ride request. This is the
   *  authoritative on/off state for now; the recurring-window matching below is
   *  kept for a later reinstatement of the matching algo. */
  driverModeEnabled?: boolean;
  /** Recurring availability windows (day(s) + time window + destination). The
   *  authoritative Ride Mode (Flow A) configuration. */
  driverAvailability?: DriverAvailabilityWindow[];
  /** Derived index: union of every window's days, e.g. ["mon","wed","fri"].
   *  Maintained alongside `driverAvailability` so the backend can do a cheap
   *  `where("driverDays", "array-contains", today)` query before filtering on
   *  time window + destination in code. */
  driverDays?: string[];
  /** Driver's default detour budget (km) applied to their sessions + dispatch. */
  driverMaxDetourKm?: number;
  /** Driver's destination-match radius (km): a passenger whose dropoff is within
   *  this distance of the driver's destination is considered "heading the same
   *  way". Set in the Ride Mode / go-online form; used by dispatch matching. */
  driverDestinationRadiusKm?: number;
  /** Saved default driving destination for one-tap "go online" (Flow B). */
  driverDefaultDestination?: string | null;
  driverDefaultDestinationCoords?: { latitude: number; longitude: number } | null;
};

/** Weekday keys used by driver availability + dispatch matching. */
export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** A single recurring Ride Mode availability window. A driver can define
 *  several (e.g. "Mon/Wed/Fri 7:30–9:00 → Université Laval"). Stored in the
 *  user doc's `driverAvailability` array. While the current time falls inside
 *  an active window, the driver is eligible to receive passenger-request
 *  push notifications even without being actively "online". */
export type DriverAvailabilityWindow = {
  /** Stable client-generated id for list editing. */
  id: string;
  /** Weekday keys this window applies to. */
  days: WeekdayKey[];
  /** Window start, minutes from midnight (e.g. 450 = 07:30). */
  startMinutes: number;
  /** Window end, minutes from midnight (e.g. 540 = 09:00). */
  endMinutes: number;
  /** Where the driver is heading during this window. */
  destination: string;
  destinationCoords: LocationPoint;
};

/** A driver's live "online to drive" session (Firestore `driverSessions/{uid}`). */
export type DriverSession = {
  driverId: string;
  driverName?: string;
  driverAvatar?: string;
  origin: LocationPoint;
  destination: string;
  destinationCoords: LocationPoint;
  baseRouteKm?: number;
  routePolyline?: string;
  maxDetourKm: number;
  /** Destination-match radius (km) for this live session — a passenger dropoff
   *  within this distance of `destinationCoords` is "heading the same way". */
  destinationRadiusKm?: number;
  seatsAvailable: number;
  status: "online" | "offline";
  updatedAt?: string;
};

export type WalletTransaction = {
  id: string;
  type: "ride_charge" | "ride_earning" | "monthly_charge" | "monthly_payout";
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
  seatsRequested?: number;
  dropoff?: LocationPoint;
  dropoffLabel?: string;
};

export type RideStatus = "planned" | "started" | "completed" | "expired";

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
  startedAt?: string;
  status: RideStatus | string;
  boardedPassengers?: string[];
  /** Passengers matched via dispatch/accept who have not yet swiped to confirm
   *  the driver. The driver cannot start until this is empty. Passengers who
   *  join through the planned-ride flow are never added here. */
  pendingConfirmation?: string[];
  /** Passengers who swiped to confirm the driver (mutual match). */
  confirmedPassengers?: string[];
  /** When the pending confirmation auto-expires (server sweep). */
  confirmDeadlineAt?: string;
  /** Originating rideRequests doc id — lets reject/expire re-open the search. */
  requestId?: string;
  joinRequests?: Record<string, JoinRequest>;
  passengerSeats?: Record<string, number>;
  driverLocation?: LocationPoint;
  passengerPickups?: Record<string, LocationPoint>;
  passengerDropoffs?: Record<string, LocationPoint>;
  departureAt?: string;
  pendingRatings?: string[];
  ratingsSubmitted?: string[];
  droppedPassengers?: string[];
  confirmedDropoffPassengers?: string[];
  qrToken?: string;
  qrTokenExpiresAt?: string;
  paymentStatus?: "pending" | "processing" | "completed" | "failed";
  distanceKm?: number;
  maxPickupRadiusKm?: number;
  routePolyline?: string;
  maxDetourKm?: number;
  /** Driver's direct route length (origin → destination) computed at ride
   *  creation. Used by passenger matching to compute the route-length
   *  difference once the passenger pickup + dropoff are inserted as
   *  intermediate waypoints. */
  baseRouteKm?: number;
};

export type RideRequestStatus = "open" | "matched" | "cancelled" | "expired";

/** A passenger-created request for a future ride. Mirrors the driver's
 *  "planned" ride: the passenger queues their intended trip ahead of time so
 *  their displacement is planned. Stored in the `rideRequests` collection. */
export type RideRequest = {
  id: string;
  passengerId: string;
  passengerName?: string;
  passengerAvatar?: string;
  /** Pickup point — usually the passenger's current location at creation. */
  origin: LocationPoint;
  originLabel?: string;
  destination: string;
  destinationCoords: LocationPoint;
  /** Desired departure (ISO timestamp). */
  date: string;
  seatsRequested: number;
  status: RideRequestStatus | string;
  createdAt?: string;
  /** Set by the backend when a driver claims the request (first-wins). */
  matchedRideId?: string;
  matchedDriverId?: string;
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
