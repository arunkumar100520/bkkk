"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const resend_1 = require("resend");
const ejs_1 = __importDefault(require("ejs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
const sendMail = async (options) => {
    try {
        const { email, subject, template, data } = options;
        // 1️⃣ Load and render your EJS email template
        const templatePath = path_1.default.join(__dirname, '../mails', template);
        const html = await ejs_1.default.renderFile(templatePath, data);
        // 2️⃣ Define your sender (must match verified domain or Resend onboarding email)
        // You can use "Your Brand Name <onboarding@resend.dev>" until you verify your own domain.
        const fromAddress = 'QualtSpire <onboarding@iplbuzzofficial.in>';
        // 3️⃣ Send email using Resend API
        const { data: sentData, error } = await resend.emails.send({
            from: fromAddress,
            to: email,
            subject,
            html,
        });
        // 4️⃣ Log for debugging
        if (error) {
            console.error('❌ Email send failed:', error);
            throw new Error(`Email send failed: ${error.message}`);
        }
        console.log('✅ Email sent successfully:', sentData);
    }
    catch (err) {
        console.error('💥 sendMail error:', err.message);
        throw err;
    }
};
exports.default = sendMail;
