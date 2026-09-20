"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const drive_controller_1 = require("../controllers/drive.controller");
const driveRouter = express_1.default.Router();
// POST /api/v1/upload-video-to-drive
// Only authenticated admins can upload videos
driveRouter.post("/upload-video-to-drive", auth_1.isAutheticated, (0, auth_1.authorizeRoles)("admin"), drive_controller_1.multerUpload.single("video"), // "video" must match the FormData field name in the frontend
drive_controller_1.uploadVideoToDrive);
exports.default = driveRouter;
