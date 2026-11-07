"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCashfreeWebhookSignature = exports.getCashfreeOrder = exports.createCashfreeOrder = exports.getCashfreeEnvironment = void 0;
const crypto_1 = __importDefault(require("crypto"));
const API_VERSION = process.env.CASHFREE_API_VERSION || "2025-01-01";
const getCashfreeEnvironment = () => {
    const environment = process.env.CASHFREE_ENV || "sandbox";
    if (environment !== "sandbox" && environment !== "production") {
        throw new Error("CASHFREE_ENV must be either sandbox or production");
    }
    return environment;
};
exports.getCashfreeEnvironment = getCashfreeEnvironment;
const getApiBaseUrl = () => (0, exports.getCashfreeEnvironment)() === "production"
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
const cashfreeRequest = async (path, init = {}) => {
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
    return responseBody;
};
const createCashfreeOrder = (order, idempotencyKey) => cashfreeRequest("/orders", {
    method: "POST",
    headers: { "x-idempotency-key": idempotencyKey },
    body: JSON.stringify(order),
});
exports.createCashfreeOrder = createCashfreeOrder;
const getCashfreeOrder = (orderId) => cashfreeRequest(`/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
});
exports.getCashfreeOrder = getCashfreeOrder;
const verifyCashfreeWebhookSignature = (rawBody, signature, timestamp) => {
    const clientSecret = process.env.CASHFREE_CLIENT_SECRET;
    if (!clientSecret || !signature || !timestamp || rawBody.length === 0)
        return false;
    const expected = crypto_1.default
        .createHmac("sha256", clientSecret)
        .update(timestamp)
        .update(rawBody)
        .digest("base64");
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    return expectedBuffer.length === actualBuffer.length &&
        crypto_1.default.timingSafeEqual(expectedBuffer, actualBuffer);
};
exports.verifyCashfreeWebhookSignature = verifyCashfreeWebhookSignature;
