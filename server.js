import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { google } from "googleapis";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "YOUR_SECRET_ADMIN_KEY";
const PAYHIP_WEBHOOK_SECRET = process.env.PAYHIP_WEBHOOK_SECRET || "mywebhook2025secret";

// === Google Drive Setup ===
let driveActive = false;
let drive;

try {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    drive = google.drive({ version: "v3", auth });
    driveActive = true;
    console.log("✅ Google Drive connected.");
  } else {
    console.log("⚠️ GOOGLE_SERVICE_ACCOUNT_JSON not found in .env");
  }
} catch (err) {
  console.error("❌ Google Drive setup failed:", err);
}

// === Helper: Load licenses ===
async function loadLicenses() {
  const localPath = path.join(process.cwd(), "licenses.json");
  if (fs.existsSync(localPath)) {
    const data = fs.readFileSync(localPath, "utf-8");
    return JSON.parse(data || "[]");
  }
  return [];
}

// === Helper: Save licenses ===
async function saveLicenses(licenses) {
  const localPath = path.join(process.cwd(), "licenses.json");
  fs.writeFileSync(localPath, JSON.stringify(licenses, null, 2));
}

// === Root route ===
app.get("/", (req, res) => {
  res.send(
    `✅ Mila License Server is running cleanly — ${
      driveActive ? "Google Drive active" : "no Google Drive active"
    }.`
  );
});

// === GET all licenses (admin only) ===
app.get("/admin/licenses", async (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY)
    return res.status(403).json({ error: "Unauthorized admin key" });

  try {
    const licenses = await loadLicenses();
    res.json(licenses);
  } catch (error) {
    console.error("❌ Error loading licenses:", error);
    res.status(500).json({ error: "Failed to load licenses" });
  }
});

// === Webhook: Payhip purchase ===
app.post("/webhook/payhip", async (req, res) => {
  try {
    // Verify webhook secret
    const secret = req.query.secret;
    if (secret !== PAYHIP_WEBHOOK_SECRET) {
      console.log("❌ Invalid webhook secret");
      return res.status(403).json({ success: false, message: "Invalid webhook secret" });
    }

    // Extract payload
    const payload = req.body;
    console.log("📦 Payhip webhook received:", JSON.stringify(payload, null, 2));

    // Extract product + license key from Payhip
    const item = payload?.items?.[0];
    const newLicense = {
      id: Date.now().toString(),
      buyer_email: payload?.email || "unknown",
      product_name: item?.product_name || "unknown",
      license_key: item?.license_key || "N/A",
      created_at: new Date().toISOString(),
    };

    // Save to licenses.json
    const licenses = await loadLicenses();
    licenses.push(newLicense);
    await saveLicenses(licenses);

    console.log(`🎉 License saved for ${newLicense.buyer_email} (${newLicense.product_name})`);
    return res.json({ success: true, license: newLicense });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
