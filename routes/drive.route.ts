import express from "express";
import { authorizeRoles, isAutheticated } from "../middleware/auth";
import { multerUpload, uploadVideoToDrive } from "../controllers/drive.controller";

const driveRouter = express.Router();

// POST /api/v1/upload-video-to-drive
// Only authenticated admins can upload videos
driveRouter.post(
  "/upload-video-to-drive",
  isAutheticated,
  authorizeRoles("admin"),
  multerUpload.single("video"), // "video" must match the FormData field name in the frontend
  uploadVideoToDrive
);

export default driveRouter;
