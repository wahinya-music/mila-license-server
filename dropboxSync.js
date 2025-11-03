// =============================================
// dropboxSync.js — Handles syncing single licenses.json file with Dropbox
// =============================================
import fs from "fs";
import path from "path";
import { Dropbox } from "dropbox";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// === Environment variables ===
const DROPBOX_ACCESS_TOKEN = process.env.DROPBOX_ACCESS_TOKEN;
const DROPBOX_FILE_PATH = process.env.DROPBOX_FILE_PATH || "/licenses.json";
const LOCAL_FILE_PATH = path.resolve("./licenses.json");

if (!DROPBOX_ACCESS_TOKEN) {
  console.error("❌ Missing DROPBOX_ACCESS_TOKEN in environment variables.");
  process.exit(1);
}

// === Initialize Dropbox client ===
const dbx = new Dropbox({ accessToken: DROPBOX_ACCESS_TOKEN, fetch });

// =============================================
// Upload local licenses.json → Dropbox
// =============================================
export async function uploadLicensesToDropbox() {
  try {
    if (!fs.existsSync(LOCAL_FILE_PATH)) {
      console.warn("⚠️ No local licenses.json found — skipping upload.");
      return;
    }

    const contents = fs.readFileSync(LOCAL_FILE_PATH);
    await dbx.filesUpload({
      path: DROPBOX_FILE_PATH,
      contents,
      mode: { ".tag": "overwrite" },
    });

    console.log(`✅ licenses.json uploaded to Dropbox at ${DROPBOX_FILE_PATH}`);
  } catch (err) {
    console.error("❌ Dropbox upload failed:", err.message);
  }
}

// =============================================
// Download licenses.json ← Dropbox
// =============================================
export async function downloadLicensesFromDropbox() {
  try {
    const res = await dbx.filesDownload({ path: DROPBOX_FILE_PATH });
    const data = res.result.fileBinary;
    fs.writeFileSync(LOCAL_FILE_PATH, data, "binary");
    console.log("✅ licenses.json downloaded from Dropbox.");
  } catch (err) {
    if (err.status === 409) {
      console.log("⚠️ No licenses.json found in Dropbox yet — starting fresh.");
    } else {
      console.error("❌ Dropbox download failed:", err.message);
    }
  }
}
