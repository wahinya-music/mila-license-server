// =============================================
// MILA AFRIKA LICENSE SERVER — Simplified Version
// Payhip → Render → Local JSON
// =============================================

import express from "express";
import fs from "fs";
import path from "path";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

// ================= Configuration =================
const LICENSES_FILE = path.resolve("./licenses.json");
const PAYHIP_WEBHOOK_SECRET = process.env.PAYHIP_WEBHOOK_SECRET || "mywebhook2025secret";
const PORT = parseInt(process.env.PORT || "10000", 10);

// ================= License Helpers =================
function loadLicenses() {
  if (!fs.existsSync(LICENSES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LICENSES_FILE, "utf8"));
  } catch (err) {
    console.warn("⚠️ Failed to parse licenses.json:", err.message);
    return [];
  }
}

function saveLicenses(licenses) {
  fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2), "utf8");
}

// ================= API Routes =================

// Health check
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "✅ Mila License Server is running",
  });
});

// License verification endpoint
app.post("/verify", (req, res) => {
  try {
    const { license_key } = req.body || {};
    if (!license_key) return res.status(400).json({ success: false, message: "Missing license_key" });

    const licenses = loadLicenses();
    const found = licenses.find((l) => l.license_key === license_key);

    if (found) {
      return res.json({ success: true, license: found });
    } else {
      return res.status(404).json({ success: false, message: "Invalid license key" });
    }
  } catch (err) {
    console.error("❌ /verify error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Payhip webhook handler
app.post("/webhook/payhip", (req, res) => {
  try {
    const providedSecret = req.query.secret;
    if (providedSecret !== PAYHIP_WEBHOOK_SECRET) {
      console.warn("❌ Invalid webhook secret:", providedSecret);
      return res.status(403).send("Forbidden");
    }

    res.status(200).send("OK"); // Acknowledge immediately

    const body = req.body;
    const license_key = body.license_key || body.licenseKey;
    const buyer_email = body.buyer_email || body.email;
    const product_name = body.product_name || body.product;

    if (!license_key || !product_name) {
      console.warn("⚠️ Missing license key or product name");
      return;
    }

    const licenses = loadLicenses();
    if (!licenses.some((l) => l.license_key === license_key)) {
      licenses.push({
        license_key,
        buyer_email,
        product_name,
        activated: false,
        issued_at: new Date().toISOString(),
      });
      saveLicenses(licenses);
      console.log(`✅ New license saved: ${license_key} for ${product_name}`);
    } else {
      console.log("⚠️ Duplicate license, skipping:", license_key);
    }
  } catch (err) {
    console.error("❌ /webhook/payhip error:", err);
  }
});

// ================= Startup =================
app.listen(PORT, () => {
  console.log(`🚀 Mila License Server running on port ${PORT}`);
});
