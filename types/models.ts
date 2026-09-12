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
  // ── Payouts (Stripe Connect Express) ─────────────────────────────────────
  // How a DRIVER gets paid. Distinct from the stripePaymentMethod* fields
  // above, which are how a PASSENGER is charged — a saved card is a pull-only
  // credential and can never be a payout destination, which is why drivers
  // register a separate Connect account. Written only by the Cloud Function;
  // the client-write deny-lists in firestore.rules cover all six, so a client
  // cannot mark itself ready to be paid.
  /** Connect Express account id (e.g. "acct_xxx"). */
  stripeConnectAccountId?: string;
  /** "none" = never started · "pending" = onboarding started or Stripe still
   *  verifying · "ready" = payouts_enabled · "restricted" = Stripe disabled the
   *  account and it needs attention. Drives the four states of the wallet's
   *  Payouts card. */
  stripeConnectStatus?: "none" | "pending" | "ready" | "restricted";
  /** Mirrors Stripe's `payouts_enabled`. The payout sweeper gates on this
   *  specifically rather than on `stripeConnectStatus`, so a stale status
   *  string can never authorise a transfer. */
  stripeConnectPayoutsEnabled?: boolean;
  /** Stripe's `requirements.currently_due`, surfaced so the UI can tell the
   *  driver what is actually missing instead of "setup incomplete". */
  stripeConnectRequirementsDue?: string[];
  /** Last 4 of the driver's payout bank account, for display only. */
  stripeConnectBankLast4?: string;
  /** ISO timestamp of the last Connect state change. */
  stripeConnectUpdatedAt?: string;
  // ── Cashable balance ─────────────────────────────────────────────────────
  // `pendingEarningsCents` above is what a driver has EARNED this cycle; it is
  // not real money yet, because passengers are only charged for it at the next
  // monthly settlement. Settlement nets it against their own ride charges and
  // moves whatever is left here, at which point the funds genuinely exist in
  // the platform's Stripe balance and can be transferred out on request.
  /** Settled, collected earnings, queued for payout on the 5th.
   *
   *  Written by settlement and by nothing else. That is what guarantees a driver
   *  is never paid money no passenger was charged for — see the note above
   *  PAYOUT_DAY_OF_MONTH in functions/index.js. */
  availableEarningsCents?: number;
  /** LEGACY. Fed the dormancy sweep back when payouts were on-demand and a
   *  forgotten balance could sit here for months. Automatic monthly payouts made
   *  that unreachable; the field is still read off older user documents. */
  cashoutEligibleSince?: string;
  /** ISO timestamp of the driver's most recent payout. */
  lastCashoutAt?: string;
  language?: Language;
  expoPushToken?: string;
  /** Which environment registered the token ("dev" | "production"). Broadcasts
   *  only reach tokens matching the sending server's environment — a push token
   *  identifies a device, not an account, so without this a dev test can ring a
   *  phone running the production build. */
  expoPushTokenEnv?: string;
  /** ISO timestamp of the last token registration. In dev the servers also
   *  require this to be recent, so a device that has moved back to the store
   *  build stops being treated as a dev recipient. */
  expoPushTokenUpdatedAt?: string;
  /** E.164, e.g. "+15145550142". Shared with the driver of an active ride so
   *  they can reach the passenger at pickup, and with nobody else: it is
   *  deliberately absent from the public-profile projection
   *  (`publicProfileFrom` in functions/index.js), and a driver can only read it
   *  through POST /rides/passenger-contact, which refuses once the passenger has
   *  been dropped off. Optional — a passenger who declines still rides. */
  phone?: string;
  /** The permission that lets us keep `phone` at all: the user ticked the
   *  consent line on the phone card, which states that the number is stored and
   *  shared with the drivers and passengers of their rides. Withdrawing it
   *  deletes the number, so a stored number always has this true — legacy
   *  numbers, saved through the share sheet's own disclosure, are read as
   *  consented (see `normalizeUserData`). */
  phoneConsent?: boolean;
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
  /** `monthly_payout` is retained only for rows written by the earliest
   *  auto-payout design; every payout since — including the monthly ones the
   *  enqueue job writes today — uses `cashout`. */
  type:
    | "ride_charge"
    | "ride_earning"
    | "monthly_charge"
    | "monthly_payout"
    | "cashout"
    /** Settlement moved this cycle's net earnings into the cashable balance. */
    | "earnings_available"
    /** Money given back to a passenger, by /billing/refund or from Stripe. */
    | "refund"
    /** A refund whose driver share had already been paid out — recorded as a
     *  debt rather than driving their balance negative. */
    | "clawback"
    /** A chargeback opened against a settled charge. */
    | "dispute"
    /** Stripe's Connect cost for one monthly payout, deducted from that payout.
     *  Itemised rather than netted silently into the `cashout` row: the driver
     *  is credited the full fare per ride, so the only honest way to recover the
     *  payout cost is to show it leaving. */
    | "payout_fee";
  amount: number;              // in cents
  /** "awaiting_setup" is monthly_payout only: the money is owed and queued, but
   *  the driver has not finished their Stripe payout setup yet. The sweeper
   *  promotes it to "completed" on its own once they do — no manual step. */
  status:
    | "completed"
    | "pending"
    | "failed"
    | "awaiting_setup"
    /** clawback: owed back to UniLift, not yet recovered. */
    | "outstanding"
    /** dispute: the chargeback is still being decided. */
    | "open"
    /** A queued payout cancelled before it was ever sent. */
    | "cancelled";
  description: string;
  createdAt: string;           // ISO string
  stripePaymentIntentId?: string;
  rideId?: string;
  distanceKm?: number;
  /** monthly_charge only: the fare subtotal before Stripe's processing fee. */
  subtotalCents?: number;
  /** monthly_charge only: the Stripe fee the passenger covered. `amount` is the
   *  total actually charged, i.e. subtotalCents + processingFeeCents. */
  processingFeeCents?: number;
  /** ride_charge only: the fare, excluding any payout reserve. */
  fareCents?: number;
  /** ride_charge only: reserve retained for future Connect payout fees (0 today). */
  payoutReserveCents?: number;
  /** monthly_payout only: the Stripe Transfer that paid this row. */
  stripeTransferId?: string;
  /** monthly_payout only: id of the `payouts/{id}` queue doc this mirrors.
   *  The queue doc is the authoritative record; this row is the user-visible
   *  copy the wallet renders. */
  payoutId?: string;
  /** monthly_charge / monthly_payout: the settlement this belongs to, "YYYY-MM". */
  settlementMonth?: string;
};

/** One row of the server-only `payouts` queue — money owed to a driver after a
 *  monthly settlement, drained by the payout sweeper. Never read by the client
 *  (firestore.rules denies it); typed here so the server contract has one
 *  written-down shape. */
export type PayoutQueueRow = {
  uid: string;
  amountCents: number;
  /** "monthly" = queued by the monthly payout run, which is the only writer
   *  today. "cashout" (the driver asked) and "dormant" (the old dormancy sweep)
   *  are historical rows from before payouts became automatic. */
  kind: "monthly" | "cashout" | "dormant";
  requestedAt: string;         // ISO
  settlementMonth: string;     // "YYYY-MM"
  /** "pending" = ready to send · "awaiting_setup" = blocked on the driver
   *  finishing payout setup · "completed" = sent · "failed" = gave up after
   *  MAX_PAYOUT_ATTEMPTS, needs a human. */
  status: "pending" | "awaiting_setup" | "completed" | "failed";
  attempts: number;
  /** Path of the user-visible mirror row, updated in the same transaction. */
  txPath: string;
  createdAt: string;           // ISO
  stripeTransferId?: string;
  lastError?: string;
  /** "YYYY-MM" of the last onboarding nudge, so a driver is pushed at most
   *  once per settlement rather than every day the sweeper runs. */
  nudgedMonth?: string;
  paidAt?: string;             // ISO
};

type JoinRequestStatus = "pending" | "accepted" | "rejected";

export type JoinRequest = {
  passengerId: string;
  location: LocationPoint;
  status: JoinRequestStatus;
  requestedAt: string;
  seatsRequested?: number;
  dropoff?: LocationPoint;
  dropoffLabel?: string;
};

type RideStatus = "planned" | "started" | "completed" | "expired";

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

type RideRequestStatus = "open" | "matched" | "cancelled" | "expired";

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

type ScoreBreakdown = {
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
