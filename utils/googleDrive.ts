import { google } from "googleapis";
import { Readable } from "stream";
import dns from "dns";
import https from "https";

// -------------------------------------------------------
// Fix: Force IPv4 DNS on Windows (avoids wsarecv IPv6 timeout)
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
// Initialise Google Drive client with OAuth2 refresh token
// (Files upload into the admin's own Google Drive account)
// -------------------------------------------------------
const getDriveClient = () => {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google OAuth2 credentials are missing. " +
      "Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and " +
      "GOOGLE_OAUTH_REFRESH_TOKEN in your environment variables."
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.drive({ version: "v3", auth: oauth2Client });
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

  if (!folderId) {
    throw new Error(
      "GOOGLE_DRIVE_FOLDER_ID is not set in environment variables."
    );
  }

  // Extract ID if a full Google Drive URL was pasted instead of just the ID
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
    supportsAllDrives: true,
  });

  const fileId = uploadResponse.data.id;
  const uploadedName = uploadResponse.data.name;

  if (!fileId) {
    throw new Error("Google Drive upload failed: no file ID returned");
  }

  // Make the file publicly readable so the embed player can stream it
  await drive.permissions.create({
    fileId,
    supportsAllDrives: true,
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
