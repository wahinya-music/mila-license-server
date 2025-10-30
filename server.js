import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
const app = express();

const PORT = process.env.PORT || 10000;
const ADMIN_KEY = process.env.ADMIN_KEY || "MILA_ADMIN_2025"; // 🔐 change this in Render

// Middleware for form data (Payhip webhook)
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// File where licenses are stored
const LICENSE_FILE = "./licenses.json";

// Helper: Load licenses safely
function loadLicenses() {
  try {
    return JSON.parse(fs.readFileSync(LICENSE_FILE, "utf8"));
  } catch {
    return { count: 0, licenses: {} };
  }
}

// Helper: Save licenses safely (with backup)
function saveLicenses(data) {
  try {
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(LICENSE_FILE, json);
    fs.writeFileSync(`${LICENSE_FILE}.bak`, json); // ☁️ auto-backup
  } catch (err) {
    console.error("❌ Failed to save licenses:", err);
  }
}

// Helper: Verify Payhip webhook signature
function verifyPayhipSignature(req) {
  const payload = Object.keys(req.body)
    .map((key) => `${key}=${req.body[key]}`)
    .join("&");

  const hmac = crypto
    .createHmac("sha256", process.env.PAYHIP_API_KEY)
    .update(payload)
    .digest("hex");

  return hmac === req.body.signature;
}

// 🔔 Webhook from Payhip
app.post("/webhook", (req, res) => {
  console.log("📦 Received webhook from Payhip:", req.body);

  // Verify webhook authenticity
  if (!verifyPayhipSignature(req)) {
    console.warn("🚨 Invalid Payhip signature — rejected!");
    return res.status(403).json({ success: false, message: "Invalid signature" });
  }

  const payload = req.body;
  const items = payload.items || [];

  if (items.length === 0 || !items[0].license_key || !items[0].product_id) {
    console.error("❌ Missing license_key or product_id in webhook payload");
    return res.status(400).json({ success: false, message: "Invalid payload" });
  }

  const licenseKey = items[0].license_key;
  const productId = items[0].product_id;
  const productName = items[0].product_name;
  const buyerEmail = payload.email;

  const data = loadLicenses();
  data.licenses[licenseKey] = {
    product_id: productId,
    product_name: productName,
    buyer_email: buyerEmail,
    activated: false,
    createdAt: new Date().toISOString(),
  };
  data.count = Object.keys(data.licenses).length;

  saveLicenses(data);
  console.log(`✅ Stored new license: ${licenseKey}`);
  res.json({ success: true, message: "License saved" });
});

// 🧾 License validation route
app.post("/validate-license", (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) return res.status(400).json({ success: false, message: "Missing licenseKey" });

  const data = loadLicenses();
  const license = data.licenses[licenseKey];

  if (!license)
    return res.status(404).json({ success: false, message: "License not found" });

  if (license.activated)
    return res.status(403).json({ success: false, message: "License already activated" });

  license.activated = true;
  license.activatedAt = new Date().toISOString();
  saveLicenses(data);

  res.json({ success: true, message: "License validated successfully" });
});

// 🧰 Admin Routes (require ADMIN_KEY)
app.use("/admin", (req, res, next) => {
  const key = req.query.key || req.headers["x-admin-key"];
  if (key !== ADMIN_KEY) return res.status(403).json({ error: "Unauthorized" });
  next();
});

// List all licenses
app.get("/admin/licenses", (req, res) => {
  res.json(loadLicenses());
});

// Clear all licenses (use carefully)
app.delete("/admin/clear", (req, res) => {
  saveLicenses({ count: 0, licenses: {} });
  res.json({ success: true, message: "All licenses cleared" });
});

// Debug test route
app.get("/admin/ping", (req, res) => {
  res.json({ success: true, message: "Admin access verified" });
});

app.listen(PORT, () => {
  console.log(`🚀 Mila License Server is running securely on port ${PORT}`);
});
