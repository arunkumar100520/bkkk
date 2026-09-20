import { google } from "googleapis";
import { Readable } from "stream";
import dns from "dns";
import https from "https";

// -------------------------------------------------------
// Fix: Force IPv4 DNS on Windows (avoids wsarecv IPv6 timeout)
// When IPv6 is enabled but Google's IPv6 routes fail, Node
// will try the IPv4 address instead.
// -------------------------------------------------------
dns.setDefaultResultOrder("ipv4first");

// Custom HTTPS agent — IPv4 only, 5-minute timeout for large uploads
const httpsAgent = new https.Agent({
  keepAlive: true,
  timeout: 5 * 60 * 1000, // 5 minutes
  family: 4,              // force IPv4 sockets
});

// Apply agent globally to all googleapis HTTP requests
google.options({ agent: httpsAgent } as any);

// -------------------------------------------------------
// Initialise Google Drive client with Service Account JWT
// -------------------------------------------------------
const getDriveClient = () => {
  const privateKey = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || "").replace(
    /\\n/g,
    "\n"
  );

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_DRIVE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
};

// -------------------------------------------------------
// Upload a file buffer to Google Drive
// -------------------------------------------------------
export interface UploadResult {
  driveFileId: string;
  fileName: string;
}

export const uploadFileToDrive = async (
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<UploadResult> => {
  let folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!process.env.GOOGLE_DRIVE_CLIENT_EMAIL || !process.env.GOOGLE_DRIVE_PRIVATE_KEY) {
    throw new Error(
      "Google Drive service account credentials are not set in environment variables. " +
      "Set GOOGLE_DRIVE_CLIENT_EMAIL and GOOGLE_DRIVE_PRIVATE_KEY in your .env file."
    );
  }

  if (!folderId) {
    throw new Error(
      "GOOGLE_DRIVE_FOLDER_ID is not set in environment variables."
    );
  }

  // Extract ID if a full URL was provided
  if (folderId.includes("drive.google.com")) {
    const match = folderId.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      folderId = match[1];
    }
  }

  const drive = getDriveClient();

  // Convert buffer to a readable stream for the Drive API
  const readable = Readable.from(buffer);

  // Upload the file into the configured folder
  const uploadResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: "id, name",
  });

  const fileId = uploadResponse.data.id;
  const uploadedName = uploadResponse.data.name;

  if (!fileId) {
    throw new Error("Google Drive upload failed: no file ID returned");
  }

  // Make the file publicly readable so the embed player can stream it
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: "reader",
      type: "anyone",
    },
  });

  return {
    driveFileId: fileId,
    fileName: uploadedName || fileName,
  };
};
