const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
fs.cpSync(path.join(root, "mails"), path.join(root, "build", "mails"), { recursive: true });
