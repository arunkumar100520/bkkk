import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import { uploadFileToDrive } from "../utils/googleDrive";

// -------------------------------------------------------
// Multer setup — store files in memory before sending to Drive
// Max file size: 500MB
// -------------------------------------------------------
const storage = multer.memoryStorage();

export const multerUpload = multer({
  storage,
  limits: { fileSize: 50000 * 1024 * 1024 }, // 500 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed") as any, false);
    }
  },
});

// -------------------------------------------------------
// POST /api/v1/upload-video-to-drive
// Admin only — uploads video to Google Drive and returns file ID
// -------------------------------------------------------
export const uploadVideoToDrive = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;

      if (!file) {
        return next(new ErrorHandler("No video file provided", 400));
      }

      const { driveFileId, fileName } = await uploadFileToDrive(
        file.buffer,
        file.originalname,
        file.mimetype
      );

      res.status(200).json({
        success: true,
        driveFileId,
        fileName,
        message: "Video uploaded to Google Drive successfully",
      });
    } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
    }
  }
);
