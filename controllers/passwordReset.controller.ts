import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import userModel from "../models/user.model";
import { redis } from "../utils/redis";
import sendMail from "../utils/sendMail";
import ErrorHandler from "../utils/ErrorHandler";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import {
  OTP_TTL_SECONDS, RESET_TTL_SECONDS, MAX_OTP_ATTEMPTS, RESEND_AFTER_SECONDS,
  generateOtp, randomResetToken, hashResetToken, hashOtp, parseResetEmail,
  isResetToken, validateNewPassword, RESET_RATE_LIMIT_SCRIPT,
} from "../utils/passwordReset";

async function limit(scope: string, identity: string, maximum: number, seconds: number) {
  const count = await redis.eval(RESET_RATE_LIMIT_SCRIPT, 1,
    `password-reset:limit:${scope}:${hashResetToken(identity)}`, seconds);
  if (Number(count) > maximum) {
    throw new ErrorHandler("Too many attempts. Please try again later", 429);
  }
}

function resetError(next: NextFunction, error: unknown) {
  if (error instanceof ErrorHandler) return next(error);
  // Never expose database errors, provider responses, tokens, or credentials.
  console.error("Password reset operation failed");
  return next(new ErrorHandler("Password reset is temporarily unavailable. Please try again later", 503));
}

export const forgotPassword = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const email = parseResetEmail(req.body?.email);
    await limit("request-ip", req.ip || "unknown", 20, 3600);
    await limit("request-email", email, 5, 3600);
    const cooldown = await redis.set(`password-reset:cooldown:${hashResetToken(email)}`, "1", "EX", RESEND_AFTER_SECONDS, "NX");
    if (!cooldown) throw new ErrorHandler("Please wait 60 seconds before requesting another code", 429);

    const requestId = randomResetToken();
    const otp = generateOtp();
    const requestIdHash = hashResetToken(requestId);
    const otpHash = hashOtp(requestId, otp);
    // Existing accounts were not normalized on registration; support their casing.
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user = await userModel.findOne({ email: { $regex: `^${escapedEmail}$`, $options: "i" } });
    if (user) {
      await userModel.updateOne({ _id: user._id }, { $set: { passwordReset: {
        requestIdHash, otpHash, attempts: 0, stage: "otp",
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      } } });
      try {
        await sendMail({
          email: user.email,
          subject: "Your QualtSpire password reset code",
          template: "password-reset.ejs",
          data: { name: user.name, otp, expiresInMinutes: OTP_TTL_SECONDS / 60 },
        });
      } catch {
        // Do not leave an undelivered code usable or overwrite a newer request.
        await userModel.updateOne({ _id: user._id, "passwordReset.requestIdHash": requestIdHash }, { $unset: { passwordReset: 1 } });
        throw new ErrorHandler("Unable to send the reset email. Please try again later", 503);
      }
    }
    // Identical response shape for registered and unregistered addresses.
    res.status(200).json({ success: true,
      message: "If an account exists for this email, a password reset code has been sent.",
      requestId, expiresIn: OTP_TTL_SECONDS, resendAfter: RESEND_AFTER_SECONDS,
    });
  } catch (error) { resetError(next, error); }
});

export const verifyPasswordResetOtp = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    await limit("verify-ip", req.ip || "unknown", 60, 900);
    const { requestId, otp } = req.body || {};
    if (!isResetToken(requestId) || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      throw new ErrorHandler("Enter the six-digit code from your email", 400);
    }
    const requestIdHash = hashResetToken(requestId);
    const otpHash = hashOtp(requestId, otp);
    const resetToken = randomResetToken();
    const activeChallenge = {
      "passwordReset.requestIdHash": requestIdHash,
      "passwordReset.stage": "otp",
      "passwordReset.expiresAt": { $gt: new Date() },
      "passwordReset.attempts": { $lt: MAX_OTP_ATTEMPTS },
    };
    // One atomic transition prevents concurrent OTP reuse.
    const user = await userModel.findOneAndUpdate({ ...activeChallenge, "passwordReset.otpHash": otpHash }, {
      $set: {
        "passwordReset.stage": "verified",
        "passwordReset.resetTokenHash": hashResetToken(resetToken),
        "passwordReset.expiresAt": new Date(Date.now() + RESET_TTL_SECONDS * 1000),
      },
      $unset: { "passwordReset.otpHash": 1 },
    });
    if (!user) {
      await userModel.updateOne({ ...activeChallenge, "passwordReset.otpHash": { $ne: otpHash } }, {
        $inc: { "passwordReset.attempts": 1 },
      });
      throw new ErrorHandler("Code is invalid, expired, or has too many attempts. Request a new code if needed", 400);
    }
    res.status(200).json({ success: true, message: "Email verified. Create your new password.", resetToken, expiresIn: RESET_TTL_SECONDS });
  } catch (error) { resetError(next, error); }
});

export const resetPassword = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    await limit("reset-ip", req.ip || "unknown", 30, 900);
    const { requestId, resetToken, newPassword, confirmPassword } = req.body || {};
    if (!isResetToken(requestId) || !isResetToken(resetToken)) {
      throw new ErrorHandler("Verify your email code before resetting your password", 400);
    }
    validateNewPassword(newPassword, confirmPassword);
    const filter = {
      "passwordReset.requestIdHash": hashResetToken(requestId),
      "passwordReset.resetTokenHash": hashResetToken(resetToken),
      "passwordReset.stage": "verified",
      "passwordReset.expiresAt": { $gt: new Date() },
    };
    // Avoid expensive hashing for invalid tokens. The atomic update below rechecks
    // authorization and expiry, so racing requests cannot consume a token twice.
    if (!await userModel.exists(filter)) throw new ErrorHandler("Reset session expired or invalid. Request a new code", 400);
    const password = await bcrypt.hash(newPassword, 10);
    const user = await userModel.findOneAndUpdate({ ...filter, "passwordReset.expiresAt": { $gt: new Date() } }, {
      $set: { password },
      $inc: { tokenVersion: 1 },
      $unset: { passwordReset: 1 },
    }, { new: true });
    if (!user) throw new ErrorHandler("Reset session expired or already used. Request a new code", 400);

    // Token versions are checked against MongoDB, so a cache failure cannot
    // make old sessions valid again after the password has changed.
    try { await redis.del(String(user._id)); } catch { console.error("Could not clear password reset session cache"); }
    res.clearCookie("access_token", { httpOnly: true, secure: true, sameSite: "none", path: "/" });
    res.clearCookie("refresh_token", { httpOnly: true, secure: true, sameSite: "none", path: "/" });
    res.status(200).json({ success: true, message: "Password updated. Please log in with your new password." });
  } catch (error) { resetError(next, error); }
});
