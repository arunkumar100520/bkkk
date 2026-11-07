import { NextFunction, Request, Response } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import userModel from "../models/user.model";
import CourseModel, { ICourse } from "../models/course.model";
import { getAllOrdersService } from "../services/order.service";
import PaymentAttemptModel from "../models/paymentAttempt.Model";
import {
  createCashfreeOrder,
  getCashfreeOrder,
  verifyCashfreeWebhookSignature,
} from "../util/cashfree";
import { fulfillCashfreePayment } from "../services/payment.service";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import { redis } from "../utils/redis";

type CashfreePaymentRequest = {
  order_id: string;
  payment_session_id?: string;
  order_status?: string;
  order_amount: number;
  order_currency: string;
  cf_order_id?: string;
};

const PAYMENT_WINDOW_MINUTES = 30;
const PHONE_PATTERN = /^\+?[1-9]\d{9,14}$/;

const getFrontendOrigin = () => {
  const configuredOrigin = process.env.ORIGIN?.split(",")[0]?.trim();
  const origin = configuredOrigin || "http://localhost:3000";

  try {
    return new URL(origin).origin;
  } catch {
    throw new Error("The backend ORIGIN must be a valid frontend URL");
  }
};

const getPaymentAttempt = async (orderId: string, userId?: string) => {
  const attempt = await PaymentAttemptModel.findOne({ cashfreeOrderId: orderId });
  if (!attempt || (userId && attempt.userId.toString() !== userId.toString())) {
    throw new ErrorHandler("Payment order not found", 404);
  }
  return attempt;
};

const confirmCashfreeOrder = async (orderId: string, userId?: string) => {
  if (!orderId || orderId.length > 45 || !/^[A-Za-z0-9_-]+$/.test(orderId)) {
    throw new ErrorHandler("Invalid payment order", 400);
  }

  const attempt = await getPaymentAttempt(orderId, userId);
  const cashfreeOrder = (await getCashfreeOrder(orderId)) as CashfreePaymentRequest;

  if (
    cashfreeOrder.order_id !== orderId ||
    Number(cashfreeOrder.order_amount) !== Number(attempt.amount) ||
    cashfreeOrder.order_currency !== attempt.currency
  ) {
    throw new ErrorHandler("Payment details could not be verified", 400);
  }

  if (cashfreeOrder.order_status !== "PAID") {
    return {
      success: true,
      paymentStatus: cashfreeOrder.order_status || "PENDING",
      courseId: attempt.courseId.toString(),
    };
  }

  const fulfillment = await fulfillCashfreePayment(attempt, cashfreeOrder);
  return {
    success: true,
    paymentStatus: fulfillment.paymentStatus,
    courseId: attempt.courseId.toString(),
  };
};

// Create a Cashfree order. Price and product details always come from the database.
export const newPayment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courseId, customerPhone } = req.body as {
        courseId?: string;
        customerPhone?: string;
      };
      const userId = req.user?._id?.toString();

      if (!userId || !courseId || typeof courseId !== "string") {
        return next(new ErrorHandler("Course and customer details are required", 400));
      }
      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return next(new ErrorHandler("Invalid course", 400));
      }

      const normalizedPhone = typeof customerPhone === "string"
        ? customerPhone.replace(/[\s()-]/g, "")
        : "";
      if (!PHONE_PATTERN.test(normalizedPhone)) {
        return next(new ErrorHandler("Enter a valid phone number", 400));
      }

      const [user, course] = await Promise.all([
        userModel.findById(userId),
        CourseModel.findById(courseId) as Promise<ICourse | null>,
      ]);

      if (!user) return next(new ErrorHandler("User not found", 404));
      if (!course) return next(new ErrorHandler("Course not found", 404));

      const alreadyPurchased = user.courses.some((entry: any) => {
        const purchasedCourseId = entry?.courseId ?? entry?._id ?? entry;
        return purchasedCourseId?.toString() === course._id.toString();
      });
      if (alreadyPurchased) {
        return next(new ErrorHandler("You have already purchased this course", 400));
      }

      const amount = Number(Number(course.price).toFixed(2));
      if (!Number.isFinite(amount) || amount <= 0) {
        return next(new ErrorHandler("This course cannot be paid for online", 400));
      }

      const now = new Date();
      const returnUrl = new URL("/payment/cashfree/return", getFrontendOrigin());
      const paidAttempt = await PaymentAttemptModel.findOne({
        userId,
        courseId: course._id,
        status: "PAID",
        fulfillmentStatus: { $ne: "COMPLETE" },
      });
      if (paidAttempt) {
        return next(new ErrorHandler("Payment was received and course access is being activated", 409));
      }

      const activeAttempt = await PaymentAttemptModel.findOne({
        userId,
        courseId: course._id,
        status: "PENDING",
      });

      if (activeAttempt && activeAttempt.expiresAt <= now) {
        activeAttempt.status = "EXPIRED";
        await activeAttempt.save();
      } else if (activeAttempt?.paymentSessionId) {
        return res.status(200).json({
          success: true,
          orderId: activeAttempt.cashfreeOrderId,
          paymentSessionId: activeAttempt.paymentSessionId,
          mode: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
        });
      } else if (activeAttempt) {
        activeAttempt.status = "FAILED";
        await activeAttempt.save();
      }

      const cashfreeOrderId = `qs_${randomUUID().replace(/-/g, "")}`;
      const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60 * 1000);
      const attempt = await PaymentAttemptModel.create({
        cashfreeOrderId,
        userId: user._id,
        courseId: course._id,
        amount,
        currency: "INR",
        status: "PENDING",
        fulfillmentStatus: "PENDING",
        expiresAt,
      });

      returnUrl.searchParams.set("order_id", cashfreeOrderId);

      try {
        const cashfreeOrder = await createCashfreeOrder(
          {
            order_id: cashfreeOrderId,
            order_amount: amount,
            order_currency: "INR",
            order_expiry_time: expiresAt.toISOString(),
            customer_details: {
              customer_id: user._id.toString(),
              customer_name: user.name,
              customer_email: user.email,
              customer_phone: normalizedPhone,
            },
            order_meta: { return_url: returnUrl.toString() },
            order_note: `Course purchase: ${course.name}`.slice(0, 250),
          },
          randomUUID()
        );

        if (!cashfreeOrder.payment_session_id) {
          throw new Error("Cashfree did not return a payment session");
        }

        attempt.paymentSessionId = cashfreeOrder.payment_session_id;
        await attempt.save();

        res.status(201).json({
          success: true,
          orderId: cashfreeOrderId,
          paymentSessionId: cashfreeOrder.payment_session_id,
          mode: process.env.CASHFREE_ENV === "production" ? "production" : "sandbox",
        });
      } catch (error) {
        attempt.status = "FAILED";
        await attempt.save();
        throw error;
      }
    } catch (error: any) {
      if (error instanceof ErrorHandler) return next(error);
      return next(new ErrorHandler("Unable to start payment. Please try again.", 502));
    }
  }
);

// Confirm a return from checkout by querying Cashfree server-to-server.
export const verifyCashfreePayment = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await confirmCashfreeOrder(
        String(req.body?.orderId || ""),
        req.user?._id?.toString()
      );
      res.status(result.paymentStatus === "PAID" ? 200 : 202).json(result);
    } catch (error: any) {
      if (error instanceof ErrorHandler) return next(error);
      return next(new ErrorHandler("Unable to verify payment right now", 502));
    }
  }
);

// Webhook body must be parsed as a Buffer before express.json handles requests.
export const cashfreeWebhook = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const signature = req.header("x-webhook-signature") || "";
      const timestamp = req.header("x-webhook-timestamp") || "";

      if (!verifyCashfreeWebhookSignature(rawBody, signature, timestamp)) {
        return res.status(401).json({ success: false, message: "Invalid webhook signature" });
      }

      const event = JSON.parse(rawBody.toString("utf8"));
      const orderId = event?.data?.order?.order_id;
      const paymentStatus = event?.data?.payment?.payment_status;

      if (event?.type === "PAYMENT_SUCCESS_WEBHOOK" && paymentStatus === "SUCCESS" && orderId) {
        await confirmCashfreeOrder(String(orderId));
      }

      res.status(200).json({ success: true });
    } catch (error: any) {
      if (error instanceof ErrorHandler && Number(error.statusCode) < 500) return next(error);
      return next(new ErrorHandler("Unable to process Cashfree webhook", 500));
    }
  }
);

// Free courses have a separate authenticated route; never accept browser-supplied payment data.
export const enrollFreeCourse = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { courseId } = req.body as { courseId?: string };
      if (!courseId) return next(new ErrorHandler("Course is required", 400));
      if (!mongoose.Types.ObjectId.isValid(courseId)) {
        return next(new ErrorHandler("Invalid course", 400));
      }

      const [user, course] = await Promise.all([
        userModel.findById(req.user?._id),
        CourseModel.findById(courseId),
      ]);
      if (!user) return next(new ErrorHandler("User not found", 404));
      if (!course) return next(new ErrorHandler("Course not found", 404));
      if (Number(course.price) !== 0) {
        return next(new ErrorHandler("This course requires payment", 400));
      }

      const alreadyPurchased = user.courses.some((entry: any) => {
        const purchasedCourseId = entry?.courseId ?? entry?._id ?? entry;
        return purchasedCourseId?.toString() === course._id.toString();
      });
      if (!alreadyPurchased) {
        user.courses.push({ courseId: course._id.toString() });
        await user.save();
        await CourseModel.updateOne({ _id: course._id }, { $inc: { purchased: 1 } });
        await redis.set(user._id.toString(), JSON.stringify(user), "EX", 604800);
      }

      res.status(200).json({ success: true, courseId: course._id.toString() });
    } catch (error: any) {
      return next(new ErrorHandler(error.message || "Unable to enroll in this course", 500));
    }
  }
);

// get All orders --- only for admin
export const getAllOrders = CatchAsyncError(
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      await getAllOrdersService(res);
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);
