require("dotenv").config();
import express, { NextFunction, Request, Response } from "express";
export const app = express();
// Set to 1 on Render when exactly one trusted proxy sits in front of Express.
// Keep disabled for servers exposed directly to the internet.
const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(proxyHops) && proxyHops > 0) app.set("trust proxy", proxyHops);
import cors from "cors";
import cookieParser from "cookie-parser";
import { ErrorMiddleware } from "./middleware/error";
import userRouter from "./routes/user.route";
import courseRouter from "./routes/course.route";
import orderRouter from "./routes/order.route";
import notificationRouter from "./routes/notification.route";
import analyticsRouter from "./routes/analytics.route";
import layoutRouter from "./routes/layout.route";
import testRouter from "./routes/test.route";
import driveRouter from "./routes/drive.route";
import { cashfreeWebhook } from "./controllers/order.controller";
import { rateLimit } from 'express-rate-limit'

// cookie parser
app.use(cookieParser());

// cors => cross origin resource sharing
// origin: process.env.ORIGIN,
app.use(
    cors({
        origin: (origin, callback) => {
            const configuredOrigins = (process.env.ORIGIN || "")
                .split(",")
                .map((value) => {
                    try { return new URL(value.trim()).origin; } catch { return ""; }
                })
                .filter(Boolean);
            const allowedOrigins = [
                'https://qualtspire.vercel.app',
                'https://qualtspire-blond.vercel.app',
                'http://localhost:3000',
                ...configuredOrigins,
            ];
            if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error("Origin is not allowed by CORS"));
        },
        credentials: true,
    })
);
// app.use(cors({ origin: process.env.ORIGIN, credentials: true, }))

// Cashfree signs the exact request bytes, so this route must use a raw body parser.
app.post(
    "/api/v1/payment/cashfree/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    cashfreeWebhook
);

// body parser
app.use(express.json({ limit: "50mb" }));

// api requests limit
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
})

app.use(limiter);

// routes
app.use(
    "/api/v1",
    userRouter,
    orderRouter,
    courseRouter,
    notificationRouter,
    analyticsRouter,
    layoutRouter,
    testRouter,
    driveRouter
);

// testing api
app.get("/test", (req: Request, res: Response, next: NextFunction) => {
    res.status(200).json({
        succcess: true,
        message: "API is working",
    });
});

// unknown route
app.all("*", (req: Request, res: Response, next: NextFunction) => {
    const err = new Error(`Route ${req.originalUrl} not found`) as any;
    err.statusCode = 404;
    next(err);
});

// middleware calls
app.use(ErrorMiddleware);
