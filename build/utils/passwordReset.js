"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESET_RATE_LIMIT_SCRIPT = exports.validateNewPassword = exports.isResetToken = exports.parseResetEmail = exports.hashOtp = exports.hashResetToken = exports.generateOtp = exports.randomResetToken = exports.RESEND_AFTER_SECONDS = exports.MAX_OTP_ATTEMPTS = exports.RESET_TTL_SECONDS = exports.OTP_TTL_SECONDS = void 0;
const crypto_1 = require("crypto");
const ErrorHandler_1 = __importDefault(require("./ErrorHandler"));
exports.OTP_TTL_SECONDS = 10 * 60;
exports.RESET_TTL_SECONDS = 10 * 60;
exports.MAX_OTP_ATTEMPTS = 5;
exports.RESEND_AFTER_SECONDS = 60;
const randomResetToken = () => (0, crypto_1.randomBytes)(32).toString("hex");
exports.randomResetToken = randomResetToken;
const generateOtp = () => (0, crypto_1.randomInt)(0, 1000000).toString().padStart(6, "0");
exports.generateOtp = generateOtp;
const hashResetToken = (value) => (0, crypto_1.createHash)("sha256").update(value).digest("hex");
exports.hashResetToken = hashResetToken;
const hashOtp = (requestId, otp) => {
    const secret = process.env.PASSWORD_RESET_SECRET || process.env.ACCESS_TOKEN;
    if (!secret)
        throw new ErrorHandler_1.default("Password reset is temporarily unavailable", 503);
    return (0, crypto_1.createHmac)("sha256", secret).update(`password-reset:${requestId}:${otp}`).digest("hex");
};
exports.hashOtp = hashOtp;
function parseResetEmail(value) {
    if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
        throw new ErrorHandler_1.default("Please enter a valid email address", 400);
    }
    return value.trim().toLowerCase();
}
exports.parseResetEmail = parseResetEmail;
function isResetToken(value) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
exports.isResetToken = isResetToken;
function validateNewPassword(password, confirmation) {
    if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
        throw new ErrorHandler_1.default("Use a password with at least 8 characters and no more than 72 UTF-8 bytes", 400);
    }
    if (password !== confirmation)
        throw new ErrorHandler_1.default("Passwords do not match", 400);
}
exports.validateNewPassword = validateNewPassword;
// INCR + EXPIRE must be atomic, including across multiple API instances.
exports.RESET_RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;
