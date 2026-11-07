import express from "express";
import { authorizeRoles, isAutheticated } from "../middleware/auth";
import {
  getAllOrders,
  enrollFreeCourse,
  newPayment,
  verifyCashfreePayment,
} from "../controllers/order.controller";
const orderRouter = express.Router();

orderRouter.get(
  "/get-orders",
  isAutheticated,
  authorizeRoles("admin"),
  getAllOrders
);

orderRouter.post("/payment", isAutheticated, newPayment);
orderRouter.post("/payment/verify", isAutheticated, verifyCashfreePayment);
orderRouter.post("/free-course-enrollment", isAutheticated, enrollFreeCourse);

export default orderRouter;
