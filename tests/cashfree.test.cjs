const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const mongoose = require("mongoose");

function load(env, fetchImpl) {
  const filename = path.join(__dirname, "..", "util", "cashfree.ts");
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    Buffer,
    process: { env },
    fetch: fetchImpl,
    require,
  }, { filename });
  return exports;
}

function loadOrderController({ user, course, attempt, gatewayOrder, onCreateOrder, onGetOrder } = {}, env = {}) {
  const filename = path.join(__dirname, "..", "controllers", "order.controller.ts");
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2020,
    },
  });
  class TestErrorHandler extends Error {
    constructor(message, statusCode) { super(message); this.statusCode = statusCode; }
  }
  const attemptModel = {
    async findOne() { return attempt || null; },
    async create(data) { return { ...data, async save() {} }; },
  };
  const mocks = {
    "../middleware/catchAsyncErrors": { CatchAsyncError: (handler) => handler },
    "../utils/ErrorHandler": { __esModule: true, default: TestErrorHandler },
    "../models/user.model": { __esModule: true, default: { async findById() { return user || null; } } },
    "../models/course.model": { __esModule: true, default: { async findById() { return course || null; } } },
    "../services/order.service": { getAllOrdersService() {} },
    "../models/paymentAttempt.Model": { __esModule: true, default: attemptModel },
    "../util/cashfree": {
      async createCashfreeOrder(order, key) { if (onCreateOrder) onCreateOrder(order, key); return { payment_session_id: "session_test" }; },
      async getCashfreeOrder(orderId) { if (onGetOrder) onGetOrder(orderId); return gatewayOrder; },
      verifyCashfreeWebhookSignature() { return true; },
    },
    "../services/payment.service": { async fulfillCashfreePayment() { throw new Error("unexpected fulfillment"); } },
    "../utils/redis": { redis: { async set() {} } },
    mongoose,
    crypto,
  };
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    Buffer,
    URL,
    process: { env },
    __dirname: path.dirname(filename),
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unmocked import: ${name}`);
    },
  }, { filename });
  return { handlers: exports, TestErrorHandler };
}

async function callHandler(handler, req) {
  const result = { status: 200 };
  const res = {
    status(status) { result.status = status; return res; },
    json(body) { result.body = body; return res; },
  };
  await handler(req, res, (error) => { result.error = error; result.status = Number(error?.statusCode || 500); });
  return result;
}

test("creates orders with server credentials, the Cashfree API version and an idempotency key", async () => {
  let request;
  const api = load({
    CASHFREE_ENV: "sandbox",
    CASHFREE_CLIENT_ID: "test-client",
    CASHFREE_CLIENT_SECRET: "test-secret",
  }, async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ order_id: "qs_test", payment_session_id: "session_test" }) };
  });

  const response = await api.createCashfreeOrder(
    { order_id: "qs_test", order_amount: 499, order_currency: "INR" },
    "e20d5d55-1c13-4818-9b82-5a7f0e21915c"
  );

  assert.equal(request.url, "https://sandbox.cashfree.com/pg/orders");
  assert.equal(request.options.headers["x-client-id"], "test-client");
  assert.equal(request.options.headers["x-client-secret"], "test-secret");
  assert.equal(request.options.headers["x-api-version"], "2025-01-01");
  assert.equal(request.options.headers["x-idempotency-key"], "e20d5d55-1c13-4818-9b82-5a7f0e21915c");
  assert.deepEqual(JSON.parse(request.options.body), {
    order_id: "qs_test",
    order_amount: 499,
    order_currency: "INR",
  });
  assert.equal(response.payment_session_id, "session_test");
});

test("uses the production Cashfree endpoint and encodes order IDs when fetching status", async () => {
  let requestUrl;
  const api = load({
    CASHFREE_ENV: "production",
    CASHFREE_CLIENT_ID: "test-client",
    CASHFREE_CLIENT_SECRET: "test-secret",
    CASHFREE_API_VERSION: "2025-01-01",
  }, async (url) => {
    requestUrl = url;
    return { ok: true, json: async () => ({ order_status: "PAID" }) };
  });

  const response = await api.getCashfreeOrder("order/with space");
  assert.equal(requestUrl, "https://api.cashfree.com/pg/orders/order%2Fwith%20space");
  assert.equal(response.order_status, "PAID");
});

test("verifies Cashfree's timestamp plus raw-body webhook signature and rejects tampering", () => {
  const secret = "webhook-test-secret";
  const timestamp = "1720000000000";
  const rawBody = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK"}');
  const signature = crypto
    .createHmac("sha256", secret)
    .update(timestamp)
    .update(rawBody)
    .digest("base64");
  const api = load({ CASHFREE_CLIENT_SECRET: secret }, async () => {});

  assert.equal(api.verifyCashfreeWebhookSignature(rawBody, signature, timestamp), true);
  assert.equal(api.verifyCashfreeWebhookSignature(Buffer.from(`${rawBody} `), signature, timestamp), false);
  assert.equal(api.verifyCashfreeWebhookSignature(rawBody, "invalid", timestamp), false);
  assert.equal(api.verifyCashfreeWebhookSignature(rawBody, signature, ""), false);
});

test("requires credentials and rejects an unsupported Cashfree environment", async () => {
  const unconfigured = load({}, async () => {});
  await assert.rejects(
    () => unconfigured.getCashfreeOrder("order_test"),
    /Cashfree credentials are not configured/
  );

  const invalidEnvironment = load({ CASHFREE_ENV: "staging" }, async () => {});
  await assert.rejects(
    () => invalidEnvironment.getCashfreeOrder("order_test"),
    /CASHFREE_ENV must be either sandbox or production/
  );
});

test("creates a checkout session from the stored course price, ignoring any browser amount", async () => {
  const user = { _id: new mongoose.Types.ObjectId(), name: "Test Student", email: "student@example.com", courses: [] };
  const course = { _id: new mongoose.Types.ObjectId(), name: "Test Course", price: 125.5 };
  let submittedOrder;
  const { handlers } = loadOrderController({ user, course, onCreateOrder: (order) => { submittedOrder = order; } }, {
    ORIGIN: "https://qualtspire.example",
    CASHFREE_ENV: "sandbox",
  });

  const result = await callHandler(handlers.newPayment, {
    body: { courseId: course._id.toString(), customerPhone: "9876543210", amount: 1 },
    user,
  });

  assert.equal(result.status, 201);
  assert.equal(submittedOrder.order_amount, 125.5);
  assert.equal(submittedOrder.order_currency, "INR");
  assert.equal(submittedOrder.customer_details.customer_phone, "9876543210");
  assert.match(submittedOrder.order_meta.return_url, /^https:\/\/qualtspire\.example\/payment\/cashfree\/return\?/);
  assert.equal(result.body.paymentSessionId, "session_test");
  assert.equal(Object.hasOwn(result.body, "clientSecret"), false);
});

test("rejects a payment verification request from a different account before contacting Cashfree", async () => {
  const attemptOwnerId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  let gatewayLookups = 0;
  const { handlers } = loadOrderController({
    attempt: {
      userId: attemptOwnerId,
      amount: 100,
      currency: "INR",
      courseId: new mongoose.Types.ObjectId(),
      cashfreeOrderId: "qs_payment_test",
    },
    gatewayOrder: { order_id: "qs_payment_test", order_amount: 100, order_currency: "INR", order_status: "PAID" },
    onGetOrder: () => { gatewayLookups++; },
  });

  const result = await callHandler(handlers.verifyCashfreePayment, {
    body: { orderId: "qs_payment_test" },
    user: { _id: otherUserId },
  });

  assert.equal(result.status, 404);
  assert.match(result.error.message, /Payment order not found/);
  assert.equal(gatewayLookups, 0);
});
