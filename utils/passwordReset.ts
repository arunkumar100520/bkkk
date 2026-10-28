import { createHash, createHmac, randomBytes, randomInt } from "crypto";
import ErrorHandler from "./ErrorHandler";

export const OTP_TTL_SECONDS = 10 * 60;
export const RESET_TTL_SECONDS = 10 * 60;
export const MAX_OTP_ATTEMPTS = 5;
export const RESEND_AFTER_SECONDS = 60;

export const randomResetToken = () => randomBytes(32).toString("hex");
export const generateOtp = () => randomInt(0, 1000000).toString().padStart(6, "0");
export const hashResetToken = (value: string) => createHash("sha256").update(value).digest("hex");
export const hashOtp = (requestId: string, otp: string) => {
  const secret = process.env.PASSWORD_RESET_SECRET || process.env.ACCESS_TOKEN;
  if (!secret) throw new ErrorHandler("Password reset is temporarily unavailable", 503);
  return createHmac("sha256", secret).update(`password-reset:${requestId}:${otp}`).digest("hex");
};

export function parseResetEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    throw new ErrorHandler("Please enter a valid email address", 400);
  }
  return value.trim().toLowerCase();
}

export function isResetToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function validateNewPassword(password: unknown, confirmation: unknown): asserts password is string {
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    throw new ErrorHandler("Use a password with at least 8 characters and no more than 72 UTF-8 bytes", 400);
  }
  if (password !== confirmation) throw new ErrorHandler("Passwords do not match", 400);
}

// INCR + EXPIRE must be atomic, including across multiple API instances.
export const RESET_RATE_LIMIT_SCRIPT = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;
