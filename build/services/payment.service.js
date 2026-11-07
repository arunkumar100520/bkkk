"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fulfillCashfreePayment = void 0;
const course_model_1 = __importDefault(require("../models/course.model"));
const notification_Model_1 = __importDefault(require("../models/notification.Model"));
const order_Model_1 = __importDefault(require("../models/order.Model"));
const paymentAttempt_Model_1 = __importDefault(require("../models/paymentAttempt.Model"));
const user_model_1 = __importDefault(require("../models/user.model"));
const sendMail_1 = __importDefault(require("../utils/sendMail"));
const redis_1 = require("../utils/redis");
const hasCourse = (courses, courseId) => courses.some((entry) => {
    const purchasedCourseId = entry?.courseId ?? entry?._id ?? entry;
    return purchasedCourseId?.toString() === courseId;
});
const fulfillCashfreePayment = async (attempt, cashfreeOrder) => {
    let paidAttempt = attempt;
    if (paidAttempt.status !== "PAID") {
        const updated = await paymentAttempt_Model_1.default.findOneAndUpdate({ _id: paidAttempt._id, status: "PENDING" }, {
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
        }, { new: true });
        if (updated) {
            paidAttempt = updated;
        }
        else {
            const current = await paymentAttempt_Model_1.default.findById(paidAttempt._id);
            if (!current || current.status !== "PAID") {
                throw new Error("Payment state changed before it could be completed");
            }
            paidAttempt = current;
        }
    }
    if (paidAttempt.fulfillmentStatus === "COMPLETE") {
        return { paymentStatus: "PAID" };
    }
    const now = new Date();
    const staleClaimBefore = new Date(now.getTime() - 5 * 60 * 1000);
    const claimedAttempt = await paymentAttempt_Model_1.default.findOneAndUpdate({
        _id: paidAttempt._id,
        status: "PAID",
        $or: [
            { fulfillmentStatus: "PENDING" },
            { fulfillmentStatus: "PROCESSING", fulfillmentStartedAt: { $lt: staleClaimBefore } },
        ],
    }, { $set: { fulfillmentStatus: "PROCESSING", fulfillmentStartedAt: now } }, { new: true });
    if (!claimedAttempt) {
        const current = await paymentAttempt_Model_1.default.findById(paidAttempt._id);
        return {
            paymentStatus: current?.fulfillmentStatus === "COMPLETE" ? "PAID" : "PROCESSING",
        };
    }
    try {
        const courseId = claimedAttempt.courseId.toString();
        const [course, user] = await Promise.all([
            course_model_1.default.findById(courseId),
            user_model_1.default.findById(claimedAttempt.userId),
        ]);
        if (!course || !user)
            throw new Error("Course or account is no longer available");
        const paymentInfo = {
            provider: "cashfree",
            cashfree_order_id: cashfreeOrder.order_id,
            cf_order_id: cashfreeOrder.cf_order_id,
            payment_status: "PAID",
            amount: cashfreeOrder.order_amount,
            currency: cashfreeOrder.order_currency,
        };
        await order_Model_1.default.updateOne({ cashfreeOrderId: cashfreeOrder.order_id }, {
            $setOnInsert: {
                cashfreeOrderId: cashfreeOrder.order_id,
                courseId: course._id,
                userId: user._id,
                payment_info: paymentInfo,
            },
        }, { upsert: true });
        const alreadyEnrolled = hasCourse(user.courses, courseId);
        if (!alreadyEnrolled) {
            user.courses.push({ courseId });
            await user.save();
            await course_model_1.default.updateOne({ _id: course._id }, { $inc: { purchased: 1 } });
        }
        await redis_1.redis.set(user._id.toString(), JSON.stringify(user), "EX", 604800);
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
            await (0, sendMail_1.default)({
                email: user.email,
                subject: "Order Confirmation",
                template: "order-confirmation.ejs",
                data: mailData,
            });
        }
        catch (error) {
            console.error("Cashfree purchase email could not be sent", error);
        }
        try {
            await notification_Model_1.default.create({
                user: user._id,
                title: "New Order",
                message: `You have a new order from ${course.name}`,
            });
        }
        catch (error) {
            console.error("Cashfree purchase notification could not be created", error);
        }
        await paymentAttempt_Model_1.default.updateOne({ _id: claimedAttempt._id, fulfillmentStatus: "PROCESSING" }, { $set: { fulfillmentStatus: "COMPLETE" } });
        return { paymentStatus: "PAID" };
    }
    catch (error) {
        await paymentAttempt_Model_1.default.updateOne({ _id: claimedAttempt._id, fulfillmentStatus: "PROCESSING" }, { $set: { fulfillmentStatus: "PENDING" }, $unset: { fulfillmentStartedAt: 1 } });
        throw error;
    }
};
exports.fulfillCashfreePayment = fulfillCashfreePayment;
