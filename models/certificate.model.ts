import mongoose, { Document, Model, Schema } from "mongoose";

export interface ICertificate extends Document {
  userId: mongoose.Schema.Types.ObjectId;
  courseId: mongoose.Schema.Types.ObjectId;
  score: number;
  passed: boolean; // True if score >= 80%
  isCancelled: boolean; // True if the student switched tabs or failed proctoring
  uniqueId: string; // Unique String ID for the certificate
  companyName: string;
}

const certificateSchema = new Schema<ICertificate>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    score: {
      type: Number,
      required: true,
    },
    passed: {
      type: Boolean,
      required: true,
      default: false,
    },
    isCancelled: {
      type: Boolean,
      default: false,
    },
    uniqueId: {
      type: String,
      required: true,
      unique: true,
    },
    companyName: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

const CertificateModel: Model<ICertificate> = mongoose.model("Certificate", certificateSchema);

export default CertificateModel;
