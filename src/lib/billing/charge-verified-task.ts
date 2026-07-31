import "server-only";

import {
  checkPinchPaymentNonce,
  createPinchRealtimePayment,
  type CreateRealtimePaymentInput,
  PinchApiError,
  type PinchPayment,
} from "@/lib/pinch/client";

type PersistedPaymentStatus =
  | "approved"
  | "failed"
  | "pending"
  | "reserved"
  | "settled"
  | "submitting"
  | "unknown";

export const resolvePaymentOutcomeOrder = (
  current: PersistedPaymentStatus,
  incoming: PersistedPaymentStatus,
): PersistedPaymentStatus =>
  ["approved", "failed", "pending", "settled"].includes(current)
    ? current
    : incoming;

export const classifyPinchPaymentStatus = (
  payment: PinchPayment,
): "approved" | "failed" | "pending" | "unknown" => {
  const normalizedStatus = payment.status.toLowerCase();

  if (normalizedStatus === "approved" || normalizedStatus === "pending") {
    return normalizedStatus;
  }

  if (
    payment.dishonour ||
    ["declined", "dishonoured", "failed", "rejected"].includes(
      normalizedStatus,
    )
  ) {
    return "failed";
  }

  return "unknown";
};

export const isDefinitivePinchRejection = (error: unknown): boolean =>
  error instanceof PinchApiError && [400, 422].includes(error.status);

export const submitOrRecoverPinchPayment = async ({
  createPayment = createPinchRealtimePayment,
  existingStatus,
  input,
  lookupNonce = checkPinchPaymentNonce,
}: {
  createPayment?: (
    input: CreateRealtimePaymentInput,
  ) => Promise<PinchPayment>;
  existingStatus: string | null;
  input: CreateRealtimePaymentInput;
  lookupNonce?: typeof checkPinchPaymentNonce;
}): Promise<PinchPayment> => {
  if (
    existingStatus &&
    ["reserved", "submitting", "unknown", "approved", "pending"].includes(
      existingStatus,
    )
  ) {
    const nonceResult = await lookupNonce(input.nonce);

    if (nonceResult.isNonceReplay && nonceResult.data) {
      return nonceResult.data;
    }
  }

  try {
    return await createPayment(input);
  } catch (error) {
    try {
      const nonceResult = await lookupNonce(input.nonce);

      if (nonceResult.isNonceReplay && nonceResult.data) {
        return nonceResult.data;
      }
    } catch {
      // The original create error is more useful and preserves ambiguity.
    }

    throw error;
  }
};
