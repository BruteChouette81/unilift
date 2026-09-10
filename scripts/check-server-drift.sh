#!/usr/bin/env bash
# Guards against the LIVE (functions/) and SANDBOX (functions-sandbox/) servers
# drifting apart in ways that are known to cause outages.
#
# The two codebases are deliberate near-duplicates (see docs/dev-server.md §12),
# so this does NOT demand they be identical. It checks the two things that have
# actually broken before:
#
#   1. The shared route table — a route added to one server and not the other
#      means a client hitting the wrong environment gets a 404.
#   2. The mirrored constants — money and safety values that must be changed in
#      lockstep across both servers (and, for some, the client too).
#
# Sandbox-only routes (/cert/*, /dev/*, /stripe/identity-webhook) are expected
# and are filtered out rather than reported.
#
# Usage:  npm run check:server-drift
# Exit:   0 = no drift, 1 = drift found

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

LIVE="functions/index.js"
SANDBOX="functions-sandbox/index.js"
status=0

for f in "$LIVE" "$SANDBOX"; do
  if [ ! -f "$f" ]; then
    echo "check:server-drift — missing $f" >&2
    exit 1
  fi
done

# Routes that are intentionally sandbox-only (awaiting cutover to LIVE).
# The Stripe Connect driver-payout rail (/connect/*, /payouts/*,
# /billing/run-payouts, /stripe/connect-webhook) has now been ported to LIVE, so
# it is deliberately NOT listed here any more — it must match on both servers.
# Certification and the dev harness remain sandbox-only.
SANDBOX_ONLY='^/(cert|dev)/|^/stripe/identity-webhook$'

routes_of() {
  grep -oE '^app\.(get|post|put|patch|delete)\("[^"]+"' "$1" \
    | sed -E 's/^app\.([a-z]+)\("/\1 /; s/"$//' \
    | sort -u
}

echo "── route table ──────────────────────────────────────────────"
live_routes=$(routes_of "$LIVE")
sandbox_routes=$(routes_of "$SANDBOX" | awk -v pat="$SANDBOX_ONLY" '{ p=$2; if (p !~ pat) print }')

if route_diff=$(diff <(echo "$live_routes") <(echo "$sandbox_routes")); then
  echo "  ok — $(echo "$live_routes" | wc -l | tr -d ' ') shared routes match"
else
  echo "  DRIFT — shared routes differ (< only in LIVE, > only in SANDBOX):"
  echo "$route_diff" | sed 's/^/    /'
  status=1
fi

echo ""
echo "── mirrored constants ───────────────────────────────────────"
# name:file pairs. The client column is optional (empty = server-only).
check_const() {
  local name="$1" client="${2:-}"
  local lv sv cv
  lv=$(grep -oE "${name} = [^;]+" "$LIVE"    | head -1 | sed -E "s/${name} = //")
  sv=$(grep -oE "${name} = [^;]+" "$SANDBOX" | head -1 | sed -E "s/${name} = //")

  if [ -z "$lv" ] || [ -z "$sv" ]; then
    echo "  WARN  ${name} — not found in both servers (live='${lv}' sandbox='${sv}')"
    status=1
    return
  fi

  if [ "$lv" != "$sv" ]; then
    echo "  DRIFT ${name} — live='${lv}' sandbox='${sv}'"
    status=1
    return
  fi

  if [ -n "$client" ] && [ -f "$client" ]; then
    cv=$(grep -oE "${name} = [^;]+" "$client" | head -1 | sed -E "s/${name} = //")
    if [ -n "$cv" ] && [ "$cv" != "$lv" ]; then
      echo "  DRIFT ${name} — servers='${lv}' but ${client}='${cv}'"
      status=1
      return
    fi
  fi

  echo "  ok    ${name} = ${lv}"
}

# Object-literal fields (e.g. inside DEFAULT_PRICING) are written `name: value,`
# rather than `NAME = value`, so they need their own matcher. The client column
# is optional and points at constants/pricing.ts, which mirrors the same block.
check_field() {
  local name="$1" client="${2:-}"
  local lv sv cv
  lv=$(grep -oE "^ *${name}: *[^,]+," "$LIVE"    | head -1 | sed -E "s/^ *${name}: *//; s/,$//")
  sv=$(grep -oE "^ *${name}: *[^,]+," "$SANDBOX" | head -1 | sed -E "s/^ *${name}: *//; s/,$//")

  if [ -z "$lv" ] || [ -z "$sv" ]; then
    echo "  WARN  ${name} — not found in both servers (live='${lv}' sandbox='${sv}')"
    status=1
    return
  fi
  if [ "$lv" != "$sv" ]; then
    echo "  DRIFT ${name} — live='${lv}' sandbox='${sv}'"
    status=1
    return
  fi
  if [ -n "$client" ] && [ -f "$client" ]; then
    cv=$(grep -oE "^ *${name}: *[^,]+," "$client" | head -1 | sed -E "s/^ *${name}: *//; s/,$//")
    if [ -n "$cv" ] && [ "$cv" != "$lv" ]; then
      echo "  DRIFT ${name} — servers='${lv}' but ${client}='${cv}'"
      status=1
      return
    fi
  fi
  echo "  ok    ${name} = ${lv}"
}

check_const "DROPOFF_CONFIRM_RADIUS_KM" "constants/ride-geo.ts"
check_const "RIDE_LIVE_WINDOW_MS"       "utils/ride-lifecycle.ts"
check_const "CONFIRM_WINDOW_MS"
check_const "USE_LEGACY_MATCHING"
check_const "DEV_TOKEN_MAX_AGE_DAYS"
check_const "DEFAULT_MAX_RECIPIENTS"
# Money math — these decide what a passenger is charged and what a driver
# earns, so a silent divergence between the two servers is expensive.
check_field "passengerRateCentsPerKm" "constants/pricing.ts"
check_field "stripePercentBps"     "constants/pricing.ts"
check_field "stripeFixedCents"     "constants/pricing.ts"
check_field "payoutReserveBps"     "constants/pricing.ts"
# What one monthly payout costs the driver. Deducted from real money leaving the
# platform, so a divergence here pays two different amounts for the same work.
check_field "payoutFeeFlatCents"   "constants/pricing.ts"
check_field "payoutFeeBps"         "constants/pricing.ts"
check_field "minSettlementCents"   "constants/pricing.ts"
# What Stripe will actually collect. Account deletion gates on it, so a server
# with a higher value writes off debts its twin still collects.
check_field "minChargeableCents"   "constants/pricing.ts"
check_field "minPayoutCents"       "constants/pricing.ts"
# Safety rails added by the pre-launch audit. Each one bounds an abuse that was
# live at some point, so a value that drifts between the servers means one of them
# is still exposed.
# Payout cadence. Drivers are paid on this day of the month, after the 1st's
# charges have cleared; a server paying on a different day than its twin means
# one of them is transferring money that has not landed yet.
check_const "PAYOUT_DAY_OF_MONTH"
check_const "FARE_TOLERANCE"
check_const "MAX_FARE_CENTS"
check_const "MAX_VEHICLE_SEATS"
check_const "DISPATCH_COOLDOWN_MS"
check_const "MAX_DISPATCHES_PER_REQUEST"
check_const "DROPOFF_TELEMETRY_TOLERANCE_KM"
check_const "SWEEP_BATCH"
check_const "MAPS_RATE_LIMIT"
check_const "RATE_LIMIT_MAX"
check_const "SETTLEMENT_BATCH"
check_const "AWAITING_SETUP_TTL_MS"
check_const "MAX_PAYOUT_ATTEMPTS"
# The account-creation cap. A drift here means one server lets a device mint
# more accounts than the other, and the client copy is what the signup screen
# promises the user before they hit it.
check_const "MAX_ACCOUNTS_PER_DEVICE" "constants/security.ts"
check_const "DEVICE_CHECK_MAX"
# The credit ceiling decides who may keep riding on unpaid balance, so the two
# servers disagreeing about it means one of them is extending credit the other
# would refuse.
check_field "maxOutstandingChargeCents" "constants/pricing.ts"

echo ""
if [ "$status" -eq 0 ]; then
  echo "check:server-drift — PASS"
else
  echo "check:server-drift — FAIL (see above)" >&2
fi
exit "$status"
