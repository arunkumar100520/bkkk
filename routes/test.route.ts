import express from "express";
import {
  createOrUpdateTest,
  getCertificatePDF,
  getTestForCourse,
  submitTest,
} from "../controllers/test.controller";
import { authorizeRoles, isAutheticated } from "../middleware/auth";

const testRouter = express.Router();

testRouter.post(
  "/add-test/:courseId",
  isAutheticated,
  authorizeRoles("admin"),
  createOrUpdateTest
);

testRouter.get(
  "/get-test/:courseId",
  isAutheticated,
  getTestForCourse
);

testRouter.post(
  "/submit-test/:courseId",
  isAutheticated,
  submitTest
);

testRouter.get(
  "/certificate/:uniqueId",
  isAutheticated,
  getCertificatePDF
);

export default testRouter;
