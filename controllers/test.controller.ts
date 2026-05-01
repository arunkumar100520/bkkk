import { NextFunction, Request, Response } from "express";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import TestModel from "../models/test.model";
import CertificateModel from "../models/certificate.model";
import CourseModel from "../models/course.model";
import { v4 as uuidv4 } from "uuid";
import PDFDocument from "pdfkit";

// Upload or update test for a course (Admin)
export const createOrUpdateTest = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { courseId } = req.params;
    const { questions } = req.body;

    let test = await TestModel.findOne({ courseId });
    if (test) {
      test.questions = questions;
      await test.save();
    } else {
      test = await TestModel.create({ courseId, questions });
    }

    res.status(200).json({ success: true, test });
  }
);

// Get a test for a course
export const getTestForCourse = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { courseId } = req.params;
    const test = await TestModel.findOne({ courseId });

    if (!test) {
      return next(new ErrorHandler("Test not found for this course", 404));
    }

    res.status(200).json({ success: true, test });
  }
);

// Submit test answers and evaluate score
export const submitTest = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { courseId } = req.params;
    // answers format: { questionId: "answer", ... }
    const { answers, isCancelled } = req.body; 

    const test = await TestModel.findOne({ courseId });
    if (!test) return next(new ErrorHandler("Test not found", 404));

    if (isCancelled) {
      const certificate = await CertificateModel.create({
        userId: (req as any).user?._id,
        courseId,
        score: 0,
        passed: false,
        isCancelled: true,
        uniqueId: uuidv4(),
        companyName: "QualtSpire",
      });
      return res
        .status(200)
        .json({ success: true, passed: false, certificate });
    }

    let correctCount = 0;
    test.questions.forEach((q) => {
      // Find answer by stringified ObjectId matching
      const studentAnswer = answers[(q as any)._id.toString()];
      if (studentAnswer && studentAnswer === q.answer) {
        correctCount++;
      }
    });

    const score = (correctCount / test.questions.length) * 100;
    const passed = score >= 80;

    const certificate = await CertificateModel.create({
      userId: (req as any).user?._id,
      courseId,
      score,
      passed,
      isCancelled: false,
      uniqueId: uuidv4(),
      companyName: "QualtSpire",
    });

    res.status(200).json({ success: true, score, passed, certificate });
  }
);

// View or Download Certificate PDF
export const getCertificatePDF = CatchAsyncError(
  async (req: Request, res: Response, next: NextFunction) => {
    const { uniqueId } = req.params;
    const certificate: any = await CertificateModel.findOne({ uniqueId })
      .populate("userId", "name")
      .populate("courseId", "name");

    if (!certificate || !certificate.passed) {
      return next(new ErrorHandler("Certificate not found or not passed", 404));
    }

    const doc = new PDFDocument({ 
      layout: "landscape", 
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=certificate-${uniqueId}.pdf`
    );
    doc.pipe(res);

    // BACKGROUND
    // Base white background
    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#ffffff");
    
    // Left ribbon (Website Color - Dark Blue/Navy)
    doc.rect(0, 0, 40, doc.page.height).fill("#111C43");
    
    // Top right geometric accent
    doc.polygon([doc.page.width, 0], [doc.page.width - 150, 0], [doc.page.width, 150]).fill("#f8fafc");
    
    // Bottom right geometric accent
    doc.polygon([doc.page.width, doc.page.height], [doc.page.width - 250, doc.page.height], [doc.page.width, doc.page.height - 250]).fill("#f1f5f9");

    // HEADER
    doc.y = 60;
    // We add the Company name (QualtSpire) acting as the Issuer Logo Text
    doc.font("Helvetica-Bold").fontSize(28).fillColor("#111C43").text(certificate.companyName || "QualtSpire", 80, 60);

    // Certificate No Top Right
    doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(`Certificate no: ${uniqueId}`, 0, 60, { align: "right", width: doc.page.width - 60 });
    doc.text(`Reference: ${certificate.companyName} Online Platform`, { align: "right", width: doc.page.width - 60 });

    // BODY CONTENT
    // "CERTIFICATE OF COMPLETION"
    doc.font("Helvetica-Bold").fontSize(42).fillColor("#0f172a").text("CERTIFICATE OF COMPLETION", 0, 180, { align: "center" });

    // Subtitle
    doc.font("Helvetica").fontSize(16).fillColor("#475569").text("This is to certify that", 0, 240, { align: "center" });

    // Student Name
    doc.fontSize(45).fillColor("#111C43").text(certificate.userId.name || "Student Name", 0, 280, { align: "center" });
    
    // Separator Line
    doc.moveTo(doc.page.width / 2 - 250, 345).lineTo(doc.page.width / 2 + 250, 345).lineWidth(2).stroke("#e2e8f0");

    // Descriptive block
    doc.fontSize(16).fillColor("#475569").text("has successfully completed the comprehensive curriculum for", 0, 365, { align: "center" });

    // Course Name
    doc.fontSize(24).fillColor("#0f172a").text(certificate.courseId?.name || "Premium Course", 0, 400, { align: "center" });

    // FOOTERS
    // Left Footer: Date & Score
    const formattedDate = new Date(certificate.createdAt).toLocaleDateString();
    doc.fontSize(12).fillColor("#64748b").text("Date", 100, 490);
    doc.fontSize(16).fillColor("#0f172a").text(formattedDate, 100, 510);
    
    doc.fontSize(12).fillColor("#64748b").text("Score", 250, 490);
    doc.fontSize(16).fillColor("#0f172a").text(`${certificate.score}%`, 250, 510);

    // Right Footer: Signature
    const signatureX = doc.page.width - 250;
    doc.moveTo(signatureX, 525).lineTo(signatureX + 150, 525).lineWidth(1).stroke("#94a3b8");
    doc.font("Times-Italic").fontSize(22).fillColor("#111C43").text("President", signatureX, 495, { width: 150, align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#64748b").text(`Issued by ${certificate.companyName}`, signatureX, 535, { width: 150, align: "center" });

    doc.end();
  }
);
