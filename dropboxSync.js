// =============================================
// dropboxSync.js — Handles syncing licenses folder with Dropbox
// =============================================
import fs from "fs";
import path from "path";
import { Dropbox } from "dropbox";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// Load environment variables
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_FOLDER_PATH = process.env.DROPBOX_FOLDER_PATH || "/mila_licenses_backup";
const LOCAL_LICENSES_DIR = path.resolve("./licenses");

if (!DROPBOX_ACCESS_TOKEN) {
  console.error("❌ Missing DROPBOX_ACCESS_TOKEN in environment variables.");
  process.exit(1);
}

// Initialize Dropbox client
const dbx = new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN, fetch });

// =============================================
// Upload all local license JSON files → Dropbox
// =============================================
export async function uploadLicenses() {
  try {
    if (!fs.existsSync(LOCAL_LICENSES_DIR)) {
      console.warn("⚠️ No local licenses folder found — skipping Dropbox upload.");
      return;
    }

    const files = fs.readdirSync(LOCAL_LICENSES_DIR).filter(f => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(LOCAL_LICENSES_DIR, file);
      const contents = fs.readFileSync(filePath);

      await dbx.filesUpload({
        path: `${DROPBOX_FOLDER_PATH}/${file}`,
        contents,
        mode: { ".tag": "overwrite" },
      });

      console.log(`✅ Uploaded ${file} to Dropbox folder ${DROPBOX_FOLDER_PATH}`);
    }
  } catch (err) {
    console.error("❌ Dropbox upload failed:", err.message);
  }
}

// =============================================
// Download all license JSON files ← Dropbox
// =============================================
export async function downloadLicenses() {
  try {
    // Ensure local folder exists
    if (!fs.existsSync(LOCAL_LICENSES_DIR)) fs.mkdirSync(LOCAL_LICENSES_DIR, { recursive: true });

    // List all files in the Dropbox folder
    const res = await dbx.filesListFolder({ path: DROPBOX_FOLDER_PATH });
    const entries = res.result.entries.filter(f => f[".tag"] === "file" && f.name.endsWith(".json"));

    for (const file of entries) {
      const download = await dbx.filesDownload({ path: file.path_lower });
      const data = download.result.fileBinary;

      const localPath = path.join(LOCAL_LICENSES_DIR, file.name);
      fs.writeFileSync(localPath, data, "binary");

      console.log(`✅ Downloaded ${file.name} from Dropbox.`);
    }

    if (entries.length === 0) {
      console.log("⚠️ No license files found in Dropbox folder yet — starting fresh.");
    }
  } catch (err) {
    if (err.status === 409) {
      console.log("⚠️ Dropbox folder not found yet — will be created on next upload.");
    } else {
      console.error("❌ Dropbox download failed:", err.message);
    }
  }
}
