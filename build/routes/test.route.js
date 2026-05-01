"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const test_controller_1 = require("../controllers/test.controller");
const auth_1 = require("../middleware/auth");
const testRouter = express_1.default.Router();
testRouter.post("/add-test/:courseId", auth_1.isAutheticated, (0, auth_1.authorizeRoles)("admin"), test_controller_1.createOrUpdateTest);
testRouter.get("/get-test/:courseId", auth_1.isAutheticated, test_controller_1.getTestForCourse);
testRouter.post("/submit-test/:courseId", auth_1.isAutheticated, test_controller_1.submitTest);
testRouter.get("/certificate/:uniqueId", auth_1.isAutheticated, test_controller_1.getCertificatePDF);
exports.default = testRouter;
