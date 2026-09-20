"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadVideoToDrive = exports.multerUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const catchAsyncErrors_1 = require("../middleware/catchAsyncErrors");
const ErrorHandler_1 = __importDefault(require("../utils/ErrorHandler"));
const googleDrive_1 = require("../utils/googleDrive");
// -------------------------------------------------------
// Multer setup — store files in memory before sending to Drive
// Max file size: 500MB
// -------------------------------------------------------
const storage = multer_1.default.memoryStorage();
exports.multerUpload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 50000 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("video/")) {
            cb(null, true);
        }
        else {
            cb(new Error("Only video files are allowed"), false);
        }
    },
});
// -------------------------------------------------------
// POST /api/v1/upload-video-to-drive
// Admin only — uploads video to Google Drive and returns file ID
// -------------------------------------------------------
exports.uploadVideoToDrive = (0, catchAsyncErrors_1.CatchAsyncError)(async (req, res, next) => {
    try {
        const file = req.file;
        if (!file) {
            return next(new ErrorHandler_1.default("No video file provided", 400));
        }
        const { driveFileId, fileName } = await (0, googleDrive_1.uploadFileToDrive)(file.buffer, file.originalname, file.mimetype);
        res.status(200).json({
            success: true,
            driveFileId,
            fileName,
            message: "Video uploaded to Google Drive successfully",
        });
    }
    catch (error) {
        return next(new ErrorHandler_1.default(error.message, 500));
    }
});
