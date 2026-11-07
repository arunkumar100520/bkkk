"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const paymentAttemptSchema = new mongoose_1.Schema({
    cashfreeOrderId: { type: String, required: true, unique: true },
    paymentSessionId: { type: String },
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: mongoose_1.Schema.Types.ObjectId, ref: "Course", required: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: "INR" },
    status: {
        type: String,
        enum: ["PENDING", "PAID", "FAILED", "EXPIRED"],
        required: true,
        default: "PENDING",
    },
    fulfillmentStatus: {
        type: String,
        enum: ["PENDING", "PROCESSING", "COMPLETE"],
        required: true,
        default: "PENDING",
    },
    fulfillmentStartedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    paymentInfo: { type: mongoose_1.Schema.Types.Mixed },
}, { timestamps: true });
paymentAttemptSchema.index({ userId: 1, courseId: 1 }, { unique: true, partialFilterExpression: { status: "PENDING" } });
const PaymentAttemptModel = mongoose_1.default.model("PaymentAttempt", paymentAttemptSchema);
exports.default = PaymentAttemptModel;
