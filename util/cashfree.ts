import crypto from "crypto";

export type CashfreeEnvironment = "sandbox" | "production";

export interface CashfreeOrderResponse {
  order_id: string;
  cf_order_id?: string;
  order_amount: number;
  order_currency: string;
  order_status?: string;
  payment_session_id?: string;
  [key: string]: unknown;
}

const API_VERSION = process.env.CASHFREE_API_VERSION || "2025-01-01";

export const getCashfreeEnvironment = (): CashfreeEnvironment => {
  const environment = process.env.CASHFREE_ENV || "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("CASHFREE_ENV must be either sandbox or production");
  }
  return environment;
};

const getApiBaseUrl = () => getCashfreeEnvironment() === "production"
  ? "https://api.cashfree.com/pg"
  : "https://sandbox.cashfree.com/pg";

const getCredentials = () => {
  const clientId = process.env.CASHFREE_CLIENT_ID;
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Cashfree credentials are not configured");
  }
  return { clientId, clientSecret };
};

const cashfreeRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const apiBaseUrl = getApiBaseUrl();
  const { clientId, clientSecret } = getCredentials();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      ...(init.headers || {}),
    },
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = typeof responseBody?.message === "string"
      ? responseBody.message
      : "Cashfree request failed";
    throw new Error(`${providerMessage} (HTTP ${response.status})`);
  }
  return responseBody as T;
};

export const createCashfreeOrder = (
  order: Record<string, unknown>,
  idempotencyKey: string
) => cashfreeRequest<CashfreeOrderResponse>("/orders", {
  method: "POST",
  headers: { "x-idempotency-key": idempotencyKey },
  body: JSON.stringify(order),
});

export const getCashfreeOrder = (orderId: string) =>
  cashfreeRequest<CashfreeOrderResponse>(`/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });

export const verifyCashfreeWebhookSignature = (
  rawBody: Buffer,
  signature: string,
  timestamp: string
) => {
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
  if (!clientSecret || !signature || !timestamp || rawBody.length === 0) return false;

  const expected = crypto
    .createHmac("sha256", clientSecret)
    .update(timestamp)
    .update(rawBody)
    .digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);
};
