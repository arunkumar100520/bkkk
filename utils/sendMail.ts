import { Resend } from 'resend';
import ejs from 'ejs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

interface EmailOptions {
  email: string;
  subject: string;
  template: string;
  data: { [key: string]: any };
}

const resend = new Resend(process.env.RESEND_API_KEY);

const sendMail = async (options: EmailOptions): Promise<void> => {
  try {
    const { email, subject, template, data } = options;

    // 1️⃣ Load and render your EJS email template
    const templatePath = path.join(__dirname, '../mails', template);
    const html = await ejs.renderFile(templatePath, data);

    // 2️⃣ Define your sender (must match verified domain or Resend onboarding email)
    // You can use "Your Brand Name <onboarding@resend.dev>" until you verify your own domain.
    const fromAddress = (process.env.RESEND_FROM_EMAIL || 'QualtSpire <onboarding@iplbuzzofficial.in>')
      .trim().replace(/^["']+|["']+$/g, '');

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
  } catch (err: any) {
    console.error('💥 sendMail error:', err.message);
    throw err;
  }
};

export default sendMail;
