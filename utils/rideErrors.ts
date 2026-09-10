type TranslateFn = (key: string) => string;

export function rideErrorMessage(err: unknown, t: TranslateFn): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case "NO_PAYMENT_METHOD":
      return t("railguards.noPaymentMethodBody");
    case "NOT_RIDE_DRIVER":
      return t("railguards.notRideDriver");
    case "ALREADY_STARTED":
      return t("railguards.rideAlreadyStarted");
    case "ALREADY_COMPLETED":
      return t("railguards.rideAlreadyCompleted");
    case "NO_ACCEPTED_PASSENGERS":
      return t("railguards.noAcceptedPassengers");
    case "428":
      return t("railguards.passengersNotConfirmed");
    // ── Billing gates ────────────────────────────────────────────────────────
    // A card exists but the account cannot take on another charge right now.
    case "no_payment_method":
      return t("railguards.noPaymentMethodBody");
    case "balance_too_high":
      return t("railguards.balanceTooHigh");
    case "settlement_failed":
      return t("railguards.settlementFailed");
    case "dispute_open":
      return t("railguards.disputeOpen");
    case "passenger_cannot_be_charged":
      return t("railguards.passengerCannotBeCharged");
    case "dispatch_throttled":
      return t("railguards.dispatchThrottled");
    // ── Passenger contact ────────────────────────────────────────────────────
    // The driver's window to reach a passenger closes at drop-off; these say so
    // rather than surfacing a bare status line.
    case "already_dropped":
      return t("railguards.contactWindowClosed");
    case "ride_not_active":
      return t("railguards.contactRideNotActive");
    case "not_passenger":
      return t("railguards.contactNotPassenger");
    default:
      return (
        (err as { message?: string } | null)?.message ??
        t("common.genericError")
      );
  }
}
