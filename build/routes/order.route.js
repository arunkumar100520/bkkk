"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const order_controller_1 = require("../controllers/order.controller");
const orderRouter = express_1.default.Router();
orderRouter.get("/get-orders", auth_1.isAutheticated, (0, auth_1.authorizeRoles)("admin"), order_controller_1.getAllOrders);
orderRouter.post("/payment", auth_1.isAutheticated, order_controller_1.newPayment);
orderRouter.post("/payment/verify", auth_1.isAutheticated, order_controller_1.verifyCashfreePayment);
orderRouter.post("/free-course-enrollment", auth_1.isAutheticated, order_controller_1.enrollFreeCourse);
exports.default = orderRouter;
