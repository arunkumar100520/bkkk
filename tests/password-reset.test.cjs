const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function load(relativePath, mocks = {}, env = {}) {
  const filename = path.join(__dirname, "..", relativePath);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, Buffer, Date, __dirname: path.dirname(filename), console: { error() {}, log() {} }, process: { env },
    require(name) {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (!name.startsWith(".")) return require(name);
      throw new Error(`Unmocked import: ${name}`);
    },
  }, { filename });
  return exports;
}

const ErrorHandler = load("utils/ErrorHandler.ts").default;
const helpers = load("utils/passwordReset.ts", { "./ErrorHandler": ErrorHandler }, { ACCESS_TOKEN: "isolated-test-secret" });
const asyncWrapper = { CatchAsyncError: (handler) => handler };
const get = (object, key) => key.split(".").reduce((value, part) => value?.[part], object);

function matches(user, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = get(user, key);
    if (expected && typeof expected === "object") {
      if ("$regex" in expected) return new RegExp(expected.$regex, expected.$options).test(actual);
      if ("$gt" in expected) return actual > expected.$gt;
      if ("$lt" in expected) return actual < expected.$lt;
      if ("$ne" in expected) return actual !== expected.$ne;
    }
    return actual === expected;
  });
}

function update(user, changes) {
  for (const [operator, entries] of Object.entries(changes)) {
    for (const [key, value] of Object.entries(entries)) {
      const parts = key.split(".");
      const field = parts.pop();
      const parent = parts.reduce((object, part) => object[part] ||= {}, user);
      if (operator === "$set") parent[field] = value;
      if (operator === "$unset") delete parent[field];
      if (operator === "$inc") parent[field] = (parent[field] || 0) + value;
    }
  }
}

function fixture({ exists = true, mailFails = false } = {}) {
  const user = exists ? { _id: "test-user", name: "Test User", email: "MixedCase@example.com", password: "original-hash", tokenVersion: 0 } : null;
  const emails = [];
  const counters = new Map();
  const cooldowns = new Set();
  const deleted = [];
  const redis = {
    async eval(_script, _count, key) {
      const count = (counters.get(key) || 0) + 1;
      counters.set(key, count);
      return count;
    },
    async set(key) { if (cooldowns.has(key)) return null; cooldowns.add(key); return "OK"; },
    async del(key) { deleted.push(key); },
    async get() { return user ? JSON.stringify(user) : null; },
  };
  const model = {
    async findOne(filter) { return user && matches(user, filter) ? user : null; },
    async exists(filter) { return user && matches(user, filter) ? { _id: user._id } : null; },
    async updateOne(filter, changes) {
      if (!user || !matches(user, filter)) return { modifiedCount: 0 };
      update(user, changes);
      return { modifiedCount: 1 };
    },
    async findOneAndUpdate(filter, changes) {
      if (!user || !matches(user, filter)) return null;
      update(user, changes);
      return user;
    },
    findById() { return { select: async () => user }; },
  };
  const handlers = load("controllers/passwordReset.controller.ts", {
    "../models/user.model": model,
    "../utils/redis": { redis },
    "../utils/sendMail": async (mail) => { if (mailFails) throw new Error("provider secret must stay private"); emails.push(mail); },
    "../utils/ErrorHandler": ErrorHandler,
    "../middleware/catchAsyncErrors": asyncWrapper,
    "../utils/passwordReset": helpers,
  });
  async function call(name, body, ip = "127.0.0.1") {
    const result = { status: 200, headers: {}, cookies: [] };
    const res = {
      setHeader(key, value) { result.headers[key] = value; },
      status(value) { result.status = value; return res; },
      json(value) { result.body = value; return res; },
      clearCookie(key) { result.cookies.push(key); },
    };
    await handlers[name]({ body, ip }, res, (error) => { result.status = Number(error.statusCode || 500); result.body = { success: false, message: error.message }; });
    return result;
  }
  async function request() { return call("forgotPassword", { email: " mixedcase@example.com " }); }
  async function verified() {
    const requested = await request();
    const requestId = requested.body.requestId;
    const verification = await call("verifyPasswordResetOtp", { requestId, otp: emails.at(-1).data.otp });
    return { requestId, resetToken: verification.body.resetToken };
  }
  return { user, emails, counters, cooldowns, deleted, redis, model, handlers, call, request, verified };
}

test("request sends an expiring code by email and stores only its keyed hash", async () => {
  const f = fixture();
  const result = await f.request();
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.match(result.body.requestId, /^[a-f0-9]{64}$/);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].email, f.user.email);
  assert.match(f.emails[0].data.otp, /^\d{6}$/);
  assert.equal(f.user.passwordReset.otpHash, helpers.hashOtp(result.body.requestId, f.emails[0].data.otp));
  assert.equal(f.user.passwordReset.requestIdHash, helpers.hashResetToken(result.body.requestId));
  assert.ok(f.user.passwordReset.expiresAt > new Date());
  assert.ok(!JSON.stringify(result.body).includes(f.emails[0].data.otp));
  assert.equal(f.user.password, "original-hash");
});

test("unknown accounts receive the same response shape without an email", async () => {
  const known = await fixture().request();
  const f = fixture({ exists: false });
  const unknown = await f.request();
  assert.equal(unknown.status, known.status);
  assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(known.body).sort());
  assert.equal(unknown.body.message, known.body.message);
  assert.equal(f.emails.length, 0);
});

test("invalid email and object injection are rejected", async () => {
  for (const email of [null, "bad-email", { $ne: null }]) {
    assert.equal((await fixture().call("forgotPassword", { email })).status, 400);
  }
});

test("cooldown and per-email hourly limits prevent email flooding", async () => {
  const f = fixture();
  assert.equal((await f.request()).status, 200);
  assert.equal((await f.request()).status, 429);
  for (let i = 0; i < 3; i++) { f.cooldowns.clear(); assert.equal((await f.request()).status, 200); }
  f.cooldowns.clear();
  assert.equal((await f.request()).status, 429);
  assert.equal(f.emails.length, 4);
});

test("resending replaces the old request and invalidates its OTP", async () => {
  const f = fixture();
  const old = await f.request();
  const oldOtp = f.emails[0].data.otp;
  f.cooldowns.clear();
  const current = await f.request();
  assert.equal((await f.call("verifyPasswordResetOtp", { requestId: old.body.requestId, otp: oldOtp })).status, 400);
  assert.equal((await f.call("verifyPasswordResetOtp", { requestId: current.body.requestId, otp: f.emails[1].data.otp })).status, 200);
});

test("five wrong OTPs lock the challenge even if the next OTP is correct", async () => {
  const f = fixture();
  const { body } = await f.request();
  const otp = f.emails[0].data.otp;
  const wrong = otp === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.equal((await f.call("verifyPasswordResetOtp", { requestId: body.requestId, otp: wrong })).status, 400);
  assert.equal(f.user.passwordReset.attempts, 5);
  assert.equal((await f.call("verifyPasswordResetOtp", { requestId: body.requestId, otp })).status, 400);
});

test("expired OTPs cannot authorize a password reset", async () => {
  const f = fixture();
  const { body } = await f.request();
  f.user.passwordReset.expiresAt = new Date(Date.now() - 1);
  assert.equal((await f.call("verifyPasswordResetOtp", { requestId: body.requestId, otp: f.emails[0].data.otp })).status, 400);
});

test("concurrent OTP verification succeeds exactly once", async () => {
  const f = fixture();
  const { body } = await f.request();
  const input = { requestId: body.requestId, otp: f.emails[0].data.otp };
  const results = await Promise.all([f.call("verifyPasswordResetOtp", input), f.call("verifyPasswordResetOtp", input)]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 400]);
  const success = results.find(value => value.status === 200);
  assert.equal(f.user.passwordReset.resetTokenHash, helpers.hashResetToken(success.body.resetToken));
  assert.equal(f.user.passwordReset.otpHash, undefined);
});

test("password reset requires verification, valid token, and unexpired authorization", async () => {
  const f = fixture();
  const { body } = await f.request();
  const input = { requestId: body.requestId, resetToken: "0".repeat(64), newPassword: "New password 123!", confirmPassword: "New password 123!" };
  assert.equal((await f.call("resetPassword", input)).status, 400);
  const verification = await f.call("verifyPasswordResetOtp", { requestId: body.requestId, otp: f.emails[0].data.otp });
  assert.equal((await f.call("resetPassword", input)).status, 400);
  f.user.passwordReset.expiresAt = new Date(Date.now() - 1);
  assert.equal((await f.call("resetPassword", { ...input, resetToken: verification.body.resetToken })).status, 400);
  assert.equal(f.user.password, "original-hash");
});

test("weak, oversized and mismatched passwords do not consume a valid reset token", async () => {
  const f = fixture();
  const tokens = await f.verified();
  for (const [newPassword, confirmPassword] of [["short", "short"], ["a".repeat(73), "a".repeat(73)], ["😀".repeat(20), "😀".repeat(20)], ["New password!", "different"]]) {
    assert.equal((await f.call("resetPassword", { ...tokens, newPassword, confirmPassword })).status, 400);
    assert.equal(f.user.passwordReset.stage, "verified");
  }
});

test("reset atomically hashes the password, consumes the token and revokes sessions", async () => {
  const f = fixture();
  const tokens = await f.verified();
  const input = { ...tokens, newPassword: "New password 123!", confirmPassword: "New password 123!" };
  const results = await Promise.all([f.call("resetPassword", input), f.call("resetPassword", input)]);
  assert.deepEqual(results.map(value => value.status).sort(), [200, 400]);
  assert.ok(await bcrypt.compare(input.newPassword, f.user.password));
  assert.notEqual(f.user.password, input.newPassword);
  assert.equal(f.user.passwordReset, undefined);
  assert.equal(f.user.tokenVersion, 1);
  assert.deepEqual(f.deleted, [f.user._id]);
  assert.deepEqual(results.find(value => value.status === 200).cookies, ["access_token", "refresh_token"]);
  assert.equal((await f.call("resetPassword", input)).status, 400);
});

test("mail delivery failures invalidate the code and hide provider details", async () => {
  const f = fixture({ mailFails: true });
  const result = await f.request();
  assert.equal(result.status, 503);
  assert.equal(f.user.passwordReset, undefined);
  assert.doesNotMatch(JSON.stringify(result), /provider secret/);
});

test("OTP hashes are bound to the request and no auth secret means fail closed", () => {
  assert.notEqual(helpers.hashOtp("request-one", "123456"), helpers.hashOtp("request-two", "123456"));
  const unconfigured = load("utils/passwordReset.ts", { "./ErrorHandler": ErrorHandler });
  assert.throws(() => unconfigured.hashOtp("request", "123456"), /temporarily unavailable/);
});

test("access-token middleware rejects forged and pre-reset tokens even if cached", async () => {
  const f = fixture();
  f.user.tokenVersion = 1;
  const { isAutheticated } = load("middleware/auth.ts", {
    "./catchAsyncErrors": asyncWrapper,
    "../utils/ErrorHandler": ErrorHandler,
    "../utils/redis": { redis: f.redis },
    "../models/user.model": f.model,
    "../controllers/user.controller": { updateAccessToken() { assert.fail("Unexpected refresh"); } },
  }, { ACCESS_TOKEN: "test-access-secret" });
  const token = (version, secret = "test-access-secret") => jwt.sign({ id: f.user._id, tokenVersion: version }, secret, { expiresIn: "5m" });
  let failure;
  await isAutheticated({ cookies: { access_token: token(0) } }, {}, error => { failure = error; });
  assert.equal(failure.statusCode, 401);
  await assert.rejects(() => isAutheticated({ cookies: { access_token: token(1, "wrong-key") } }, {}, () => {}), /invalid signature/);
  let allowed = false;
  await isAutheticated({ cookies: { access_token: token(1) } }, {}, error => { assert.equal(error, undefined); allowed = true; });
  assert.equal(allowed, true);
});

test("refresh rejects pre-reset tokens and preserves the version for current sessions", async () => {
  const f = fixture();
  f.user.tokenVersion = 1;
  const { updateAccessToken } = load("controllers/user.controller.ts", {
    dotenv: { config() {} },
    "../models/user.model": f.model,
    "../utils/ErrorHandler": ErrorHandler,
    "../middleware/catchAsyncErrors": asyncWrapper,
    "../utils/sendMail": async () => {},
    "../utils/jwt": { accessTokenOptions: {}, refreshTokenOptions: {}, sendToken() {} },
    "../utils/redis": { redis: f.redis },
    "../services/user.service": {},
    cloudinary: { v2: {} },
  }, { ACCESS_TOKEN: "test-access-secret", REFRESH_TOKEN: "test-refresh-secret" });
  const token = version => jwt.sign({ id: f.user._id, tokenVersion: version }, "test-refresh-secret", { expiresIn: "3d" });
  const cookies = {};
  const res = { cookie(key, value) { cookies[key] = value; } };
  let failure;
  await updateAccessToken({ cookies: { refresh_token: token(0) } }, res, error => { failure = error; });
  assert.equal(failure.statusCode, 401);
  assert.equal(Object.keys(cookies).length, 0);
  await updateAccessToken({ cookies: { refresh_token: token(1) } }, res, error => { assert.equal(error, undefined); });
  assert.equal(jwt.verify(cookies.access_token, "test-access-secret").tokenVersion, 1);
  assert.equal(jwt.verify(cookies.refresh_token, "test-refresh-secret").tokenVersion, 1);
});

test("configured email sender is normalized and the OTP template renders safely", async () => {
  let sent;
  const ejs = require("ejs");
  const template = fs.readFileSync(path.join(__dirname, "../mails/password-reset.ejs"), "utf8");
  const sendMail = load("utils/sendMail.ts", {
    dotenv: { config() {} },
    resend: { Resend: class { emails = { send: async mail => { sent = mail; return { data: { id: "test-mail" } }; } }; } },
    ejs: { renderFile: async (_filename, data) => ejs.render(template, data) },
  }, { RESEND_API_KEY: "test-key", RESEND_FROM_EMAIL: '\"QualtSpire <support@example.com>\"' }).default;
  await sendMail({ email: "test@example.com", subject: "Reset code", template: "password-reset.ejs", data: { name: "<script>alert(1)</script>", otp: "012345", expiresInMinutes: 10 } });
  assert.equal(sent.from, "QualtSpire <support@example.com>");
  assert.match(sent.html, /012345/);
  assert.match(sent.html, /10 minutes/);
  assert.doesNotMatch(sent.html, /<script>/);
});
