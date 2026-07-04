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
    default:
      return (
        (err as { message?: string } | null)?.message ??
        t("common.genericError")
      );
  }
}
