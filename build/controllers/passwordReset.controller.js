"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetPassword = exports.verifyPasswordResetOtp = exports.forgotPassword = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const user_model_1 = __importDefault(require("../models/user.model"));
const redis_1 = require("../utils/redis");
const sendMail_1 = __importDefault(require("../utils/sendMail"));
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const catchAsyncErrors_1 = require("../middleware/catchAsyncErrors");
const passwordReset_1 = require("../utils/passwordReset");
async function limit(scope, identity, maximum, seconds) {
    const count = await redis_1.redis.eval(passwordReset_1.RESET_RATE_LIMIT_SCRIPT, 1, `password-reset:limit:${scope}:${(0, passwordReset_1.hashResetToken)(identity)}`, seconds);
    if (Number(count) > maximum) {
        throw new ErrorHandler_1.default("Too many attempts. Please try again later", 429);
    }
}
function resetError(next, error) {
    if (error instanceof ErrorHandler_1.default)
        return next(error);
    // Never expose database errors, provider responses, tokens, or credentials.
    console.error("Password reset operation failed");
    return next(new ErrorHandler_1.default("Password reset is temporarily unavailable. Please try again later", 503));
}
exports.forgotPassword = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        const email = (0, passwordReset_1.parseResetEmail)(req.body?.email);
        await limit("request-ip", req.ip || "unknown", 20, 3600);
        await limit("request-email", email, 5, 3600);
        const cooldown = await redis_1.redis.set(`password-reset:cooldown:${(0, passwordReset_1.hashResetToken)(email)}`, "1", "EX", passwordReset_1.RESEND_AFTER_SECONDS, "NX");
        if (!cooldown)
            throw new ErrorHandler_1.default("Please wait 60 seconds before requesting another code", 429);
        const requestId = (0, passwordReset_1.randomResetToken)();
        const otp = (0, passwordReset_1.generateOtp)();
        const requestIdHash = (0, passwordReset_1.hashResetToken)(requestId);
        const otpHash = (0, passwordReset_1.hashOtp)(requestId, otp);
        // Existing accounts were not normalized on registration; support their casing.
        const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const user = await user_model_1.default.findOne({ email: { $regex: `^${escapedEmail}$`, $options: "i" } });
        if (user) {
            await user_model_1.default.updateOne({ _id: user._id }, { $set: { passwordReset: {
                        requestIdHash, otpHash, attempts: 0, stage: "otp",
                        expiresAt: new Date(Date.now() + passwordReset_1.OTP_TTL_SECONDS * 1000),
                    } } });
            try {
                await (0, sendMail_1.default)({
                    email: user.email,
                    subject: "Your QualtSpire password reset code",
                    template: "password-reset.ejs",
                    data: { name: user.name, otp, expiresInMinutes: passwordReset_1.OTP_TTL_SECONDS / 60 },
                });
            }
            catch {
                // Do not leave an undelivered code usable or overwrite a newer request.
                await user_model_1.default.updateOne({ _id: user._id, "passwordReset.requestIdHash": requestIdHash }, { $unset: { passwordReset: 1 } });
                throw new ErrorHandler_1.default("Unable to send the reset email. Please try again later", 503);
            }
        }
        // Identical response shape for registered and unregistered addresses.
        res.status(200).json({ success: true,
            message: "If an account exists for this email, a password reset code has been sent.",
            requestId, expiresIn: passwordReset_1.OTP_TTL_SECONDS, resendAfter: passwordReset_1.RESEND_AFTER_SECONDS,
        });
    }
    catch (error) {
        resetError(next, error);
    }
});
exports.verifyPasswordResetOtp = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        await limit("verify-ip", req.ip || "unknown", 60, 900);
        const { requestId, otp } = req.body || {};
        if (!(0, passwordReset_1.isResetToken)(requestId) || typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
            throw new ErrorHandler_1.default("Enter the six-digit code from your email", 400);
        }
        const requestIdHash = (0, passwordReset_1.hashResetToken)(requestId);
        const otpHash = (0, passwordReset_1.hashOtp)(requestId, otp);
        const resetToken = (0, passwordReset_1.randomResetToken)();
        const activeChallenge = {
            "passwordReset.requestIdHash": requestIdHash,
            "passwordReset.stage": "otp",
            "passwordReset.expiresAt": { $gt: new Date() },
            "passwordReset.attempts": { $lt: passwordReset_1.MAX_OTP_ATTEMPTS },
        };
        // One atomic transition prevents concurrent OTP reuse.
        const user = await user_model_1.default.findOneAndUpdate({ ...activeChallenge, "passwordReset.otpHash": otpHash }, {
            $set: {
                "passwordReset.stage": "verified",
                "passwordReset.resetTokenHash": (0, passwordReset_1.hashResetToken)(resetToken),
                "passwordReset.expiresAt": new Date(Date.now() + passwordReset_1.RESET_TTL_SECONDS * 1000),
            },
            $unset: { "passwordReset.otpHash": 1 },
        });
        if (!user) {
            await user_model_1.default.updateOne({ ...activeChallenge, "passwordReset.otpHash": { $ne: otpHash } }, {
                $inc: { "passwordReset.attempts": 1 },
            });
            throw new ErrorHandler_1.default("Code is invalid, expired, or has too many attempts. Request a new code if needed", 400);
        }
        res.status(200).json({ success: true, message: "Email verified. Create your new password.", resetToken, expiresIn: passwordReset_1.RESET_TTL_SECONDS });
    }
    catch (error) {
        resetError(next, error);
    }
});
exports.resetPassword = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        await limit("reset-ip", req.ip || "unknown", 30, 900);
        const { requestId, resetToken, newPassword, confirmPassword } = req.body || {};
        if (!(0, passwordReset_1.isResetToken)(requestId) || !(0, passwordReset_1.isResetToken)(resetToken)) {
            throw new ErrorHandler_1.default("Verify your email code before resetting your password", 400);
        }
        (0, passwordReset_1.validateNewPassword)(newPassword, confirmPassword);
        const filter = {
            "passwordReset.requestIdHash": (0, passwordReset_1.hashResetToken)(requestId),
            "passwordReset.resetTokenHash": (0, passwordReset_1.hashResetToken)(resetToken),
            "passwordReset.stage": "verified",
            "passwordReset.expiresAt": { $gt: new Date() },
        };
        // Avoid expensive hashing for invalid tokens. The atomic update below rechecks
        // authorization and expiry, so racing requests cannot consume a token twice.
        if (!await user_model_1.default.exists(filter))
            throw new ErrorHandler_1.default("Reset session expired or invalid. Request a new code", 400);
        const password = await bcryptjs_1.default.hash(newPassword, 10);
        const user = await user_model_1.default.findOneAndUpdate({ ...filter, "passwordReset.expiresAt": { $gt: new Date() } }, {
            $set: { password },
            $inc: { tokenVersion: 1 },
            $unset: { passwordReset: 1 },
        }, { new: true });
        if (!user)
            throw new ErrorHandler_1.default("Reset session expired or already used. Request a new code", 400);
        // Token versions are checked against MongoDB, so a cache failure cannot
        // make old sessions valid again after the password has changed.
        try {
            await redis_1.redis.del(String(user._id));
        }
        catch {
            console.error("Could not clear password reset session cache");
        }
        res.clearCookie("access_token", { httpOnly: true, secure: true, sameSite: "none", path: "/" });
        res.clearCookie("refresh_token", { httpOnly: true, secure: true, sameSite: "none", path: "/" });
        res.status(200).json({ success: true, message: "Password updated. Please log in with your new password." });
    }
    catch (error) {
        resetError(next, error);
    }
});
