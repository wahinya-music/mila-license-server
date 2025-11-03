import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();
const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const ADMIN_KEY = process.env.ADMIN_KEY;
const PAYHIP_WEBHOOK_SECRET = process.env.PAYHIP_WEBHOOK_SECRET;

// === Path for local license file ===
const LICENSES_FILE = "./licenses.json";

// === Load or initialize licenses.json ===
function loadLicenses() {
  if (!fs.existsSync(LICENSES_FILE)) {
    fs.writeFileSync(LICENSES_FILE, JSON.stringify([], null, 2));
  }
  return JSON.parse(fs.readFileSync(LICENSES_FILE));
}

function saveLicenses(data) {
  fs.writeFileSync(LICENSES_FILE, JSON.stringify(data, null, 2));
}

// === Helper: Generate unique license key ===
function generateLicenseKey() {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

// === Payhip Webhook Endpoint ===
app.post("/webhook/payhip", (req, res) => {
  const secret = req.query.secret;
  if (secret !== PAYHIP_WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Invalid webhook secret" });
  }

  const { email, product, order_id } = req.body;

  if (!email || !order_id) {
    return res.status(400).json({ error: "Missing order data" });
  }

  let licenses = loadLicenses();
  let existing = licenses.find((l) => l.email === email);
  if (existing) {
    return res.status(200).json({ message: "License already issued", license: existing });
  }

  const newLicense = {
    email,
    product,
    order_id,
    license_key: generateLicenseKey(),
    issued_at: new Date().toISOString(),
  };

  licenses.push(newLicense);
  saveLicenses(licenses);

  console.log(`✅ License issued for ${email}: ${newLicense.license_key}`);
  res.status(200).json({ success: true, license: newLicense });
});

// === Admin Route: View all licenses ===
app.get("/admin/licenses", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const licenses = loadLicenses();
  res.json(licenses);
});

app.listen(PORT, () => {
  console.log(`🚀 Mila License Server running on port ${PORT}`);
});
