import CourseModel from "../models/course.model";
import NotificationModel from "../models/notification.Model";
import OrderModel from "../models/order.Model";
import PaymentAttemptModel, { IPaymentAttempt } from "../models/paymentAttempt.Model";
import userModel from "../models/user.model";
import sendMail from "../utils/sendMail";
import { redis } from "../utils/redis";

type VerifiedCashfreeOrder = {
  order_id: string;
  cf_order_id?: string;
  order_amount: number;
  order_currency: string;
};

const hasCourse = (courses: any[], courseId: string) => courses.some((entry: any) => {
  const purchasedCourseId = entry?.courseId ?? entry?._id ?? entry;
  return purchasedCourseId?.toString() === courseId;
});

export const fulfillCashfreePayment = async (
  attempt: IPaymentAttempt,
  cashfreeOrder: VerifiedCashfreeOrder
) => {
  let paidAttempt = attempt;
  if (paidAttempt.status !== "PAID") {
    const updated = await PaymentAttemptModel.findOneAndUpdate(
      { _id: paidAttempt._id, status: "PENDING" },
      {
        $set: {
          status: "PAID",
          paymentInfo: {
            provider: "cashfree",
            cashfree_order_id: cashfreeOrder.order_id,
            cf_order_id: cashfreeOrder.cf_order_id,
            payment_status: "PAID",
            amount: cashfreeOrder.order_amount,
            currency: cashfreeOrder.order_currency,
          },
        },
      },
      { new: true }
    );

    if (updated) {
      paidAttempt = updated;
    } else {
      const current = await PaymentAttemptModel.findById(paidAttempt._id);
      if (!current || current.status !== "PAID") {
        throw new Error("Payment state changed before it could be completed");
      }
      paidAttempt = current;
    }
  }

  if (paidAttempt.fulfillmentStatus === "COMPLETE") {
    return { paymentStatus: "PAID" as const };
  }

  const now = new Date();
  const staleClaimBefore = new Date(now.getTime() - 5 * 60 * 1000);
  const claimedAttempt = await PaymentAttemptModel.findOneAndUpdate(
    {
      _id: paidAttempt._id,
      status: "PAID",
      $or: [
        { fulfillmentStatus: "PENDING" },
        { fulfillmentStatus: "PROCESSING", fulfillmentStartedAt: { $lt: staleClaimBefore } },
      ],
    },
    { $set: { fulfillmentStatus: "PROCESSING", fulfillmentStartedAt: now } },
    { new: true }
  );

  if (!claimedAttempt) {
    const current = await PaymentAttemptModel.findById(paidAttempt._id);
    return {
      paymentStatus: current?.fulfillmentStatus === "COMPLETE" ? "PAID" as const : "PROCESSING" as const,
    };
  }

  try {
    const courseId = claimedAttempt.courseId.toString();
    const [course, user] = await Promise.all([
      CourseModel.findById(courseId),
      userModel.findById(claimedAttempt.userId),
    ]);
    if (!course || !user) throw new Error("Course or account is no longer available");

    const paymentInfo = {
      provider: "cashfree",
      cashfree_order_id: cashfreeOrder.order_id,
      cf_order_id: cashfreeOrder.cf_order_id,
      payment_status: "PAID",
      amount: cashfreeOrder.order_amount,
      currency: cashfreeOrder.order_currency,
    };

    await OrderModel.updateOne(
      { cashfreeOrderId: cashfreeOrder.order_id },
      {
        $setOnInsert: {
          cashfreeOrderId: cashfreeOrder.order_id,
          courseId: course._id,
          userId: user._id,
          payment_info: paymentInfo,
        },
      },
      { upsert: true }
    );

    const alreadyEnrolled = hasCourse(user.courses, courseId);
    if (!alreadyEnrolled) {
      user.courses.push({ courseId });
      await user.save();
      await CourseModel.updateOne({ _id: course._id }, { $inc: { purchased: 1 } });
    }

    await redis.set(user._id.toString(), JSON.stringify(user), "EX", 604800);

    try {
      const mailData = {
        order: {
          _id: course._id.toString().slice(0, 6),
          name: course.name,
          price: course.price,
          date: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        },
      };
      await sendMail({
        email: user.email,
        subject: "Order Confirmation",
        template: "order-confirmation.ejs",
        data: mailData,
      });
    } catch (error) {
      console.error("Cashfree purchase email could not be sent", error);
    }

    try {
      await NotificationModel.create({
        user: user._id,
        title: "New Order",
        message: `You have a new order from ${course.name}`,
      });
    } catch (error) {
      console.error("Cashfree purchase notification could not be created", error);
    }

    await PaymentAttemptModel.updateOne(
      { _id: claimedAttempt._id, fulfillmentStatus: "PROCESSING" },
      { $set: { fulfillmentStatus: "COMPLETE" } }
    );

    return { paymentStatus: "PAID" as const };
  } catch (error) {
    await PaymentAttemptModel.updateOne(
      { _id: claimedAttempt._id, fulfillmentStatus: "PROCESSING" },
      { $set: { fulfillmentStatus: "PENDING" }, $unset: { fulfillmentStartedAt: 1 } }
    );
    throw error;
  }
};
