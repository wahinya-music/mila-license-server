import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import crypto from "crypto";
import axios from "axios";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "YOUR_SECRET_ADMIN_KEY";
const GOOGLE_DRIVE_ENABLED = process.env.GOOGLE_DRIVE_ENABLED === "true";

app.use(bodyParser.json());

// ✅ Root endpoint
app.get("/", (req, res) => {
  res.send("✅ Mila License Server is running cleanly — no Google Drive active.");
});

// ✅ Webhook endpoint for Payhip
app.post("/webhook", async (req, res) => {
  try {
    const payload = JSON.stringify(req.body);
    const signature = req.headers["x-payhip-signature"];

    // Validate webhook signature
    const expectedSig = crypto
      .createHmac("sha256", PAYHIP_API_KEY)
      .update(payload)
      .digest("hex");

    if (signature !== expectedSig) {
      console.warn("❌ Invalid signature — webhook ignored.");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    console.log("📦 Received webhook from Payhip:", req.body);

    // Handle license logic
    const licenseData = req.body.items?.[0];
    if (licenseData) {
      console.log("🎟️ License Key:", licenseData.license_key);
      console.log("💾 Product ID:", licenseData.product_id);
    }

    // Skip Google Drive backup (disabled)
    if (!GOOGLE_DRIVE_ENABLED) {
      console.log("🟡 Google Drive backup skipped (disabled).");
    }

    res.json({ success: true, message: "Webhook processed cleanly" });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Admin test route (secured)
app.get("/admin/test", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ success: false, message: "Invalid admin key" });
  }
  res.json({ success: true, message: "Admin test route working!" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
