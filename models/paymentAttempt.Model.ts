import mongoose, { Document, Model, Schema } from "mongoose";

export type PaymentAttemptStatus = "PENDING" | "PAID" | "FAILED" | "EXPIRED";
export type PaymentFulfillmentStatus = "PENDING" | "PROCESSING" | "COMPLETE";

export interface IPaymentAttempt extends Document {
  cashfreeOrderId: string;
  paymentSessionId?: string;
  userId: mongoose.Types.ObjectId;
  courseId: mongoose.Types.ObjectId;
  amount: number;
  currency: string;
  status: PaymentAttemptStatus;
  fulfillmentStatus: PaymentFulfillmentStatus;
  fulfillmentStartedAt?: Date;
  expiresAt: Date;
  paymentInfo?: Record<string, unknown>;
}

const paymentAttemptSchema = new Schema<IPaymentAttempt>({
  cashfreeOrderId: { type: String, required: true, unique: true },
  paymentSessionId: { type: String },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
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
  paymentInfo: { type: Schema.Types.Mixed },
}, { timestamps: true });

paymentAttemptSchema.index(
  { userId: 1, courseId: 1 },
  { unique: true, partialFilterExpression: { status: "PENDING" } }
);

const PaymentAttemptModel: Model<IPaymentAttempt> = mongoose.model(
  "PaymentAttempt",
  paymentAttemptSchema
);

export default PaymentAttemptModel;
