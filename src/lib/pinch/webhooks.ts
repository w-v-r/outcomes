import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type UnknownRecord = Record<string, unknown>;

export type PinchWebhookPayment = {
  id: string;
  status: string | null;
};

export type PinchWebhookEvent = {
  eventDate: string | null;
  id: string;
  payments: PinchWebhookPayment[];
  type: string;
};

const getRecord = (value: unknown): UnknownRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
};

const getCaseVariant = (record: UnknownRecord, key: string) =>
  record[key] ?? record[`${key[0]?.toUpperCase()}${key.slice(1)}`];

const getString = (record: UnknownRecord, key: string) => {
  const value = getCaseVariant(record, key);

  return typeof value === "string" ? value : null;
};

const getPayment = (value: unknown): PinchWebhookPayment | null => {
  const payment = getRecord(value);

  if (!payment) {
    return null;
  }

  const id = getString(payment, "id");

  if (!id) {
    return null;
  }

  return {
    id,
    status: getString(payment, "status"),
  };
};

export const verifyPinchWebhookSignature = (
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
) => {
  if (!signatureHeader) {
    return false;
  }

  const signatureParts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, ...valueParts] = part.trim().split("=");

      return [key, valueParts.join("=")];
    }),
  );
  const timestamp = Number(signatureParts.t);
  const suppliedSignature = signatureParts.v2;

  if (
    !Number.isFinite(timestamp) ||
    !suppliedSignature ||
    !/^[a-f0-9]{64}$/i.test(suppliedSignature)
  ) {
    return false;
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);

  if (
    Math.abs(currentTimestamp - timestamp) > SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  const suppliedSignatureBuffer = Buffer.from(suppliedSignature, "hex");

  return (
    expectedSignature.length === suppliedSignatureBuffer.length &&
    timingSafeEqual(expectedSignature, suppliedSignatureBuffer)
  );
};

export const parsePinchWebhookEvent = (
  rawBody: string,
): PinchWebhookEvent | null => {
  const body = getRecord(JSON.parse(rawBody));

  if (!body) {
    return null;
  }

  const id = getString(body, "id");
  const type = getString(body, "type");

  if (!id || !type) {
    return null;
  }

  const data = getRecord(getCaseVariant(body, "data")) ?? {};
  const singlePayment = getPayment(getCaseVariant(data, "payment"));
  const paymentListValue = getCaseVariant(data, "payments");
  const paymentList = Array.isArray(paymentListValue)
    ? paymentListValue
        .map((payment) => getPayment(payment))
        .filter((payment): payment is PinchWebhookPayment => payment !== null)
    : [];

  return {
    eventDate: getString(body, "eventDate"),
    id,
    payments: singlePayment ? [singlePayment, ...paymentList] : paymentList,
    type,
  };
};
