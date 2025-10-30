import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Load environment variables
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;

// Simple in-memory license storage (for demo)
const licenses = new Map();

/**
 * ✅ Payhip Webhook Endpoint
 * Payhip will POST here whenever a product is sold or a license is issued.
 */
app.post("/payhip-webhook", async (req, res) => {
  try {
    console.log("📦 Received webhook from Payhip:", req.body);

    // Extract license info from webhook payload
    const { license_key, product_id, buyer_email } = req.body;

    if (!license_key || !product_id) {
      console.log("❌ Missing license_key or product_id in webhook payload");
      return res.status(400).json({ success: false });
    }

    // Store license in memory (in production, store in a real database)
    licenses.set(license_key, {
      product_id,
      buyer_email,
      activated: false,
    });

    console.log(`✅ Stored new license: ${license_key}`);
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Error handling webhook:", error);
    res.status(500).json({ success: false });
  }
});

/**
 * 🔑 Validate License Endpoint
 * Your desktop app calls this to verify a license.
 */
app.post("/validate-license", async (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) {
    return res.status(400).json({
      success: false,
      message: "Missing licenseKey",
    });
  }

  console.log("🔍 Validating license:", licenseKey);

  // Check if we’ve seen this license from a webhook
  const license = licenses.get(licenseKey);

  if (!license) {
    console.log("❌ License not found");
    return res.json({
      success: false,
      message: "License not found. Make sure you’ve purchased the product.",
    });
  }

  // Optional: mark as activated
  license.activated = true;
  licenses.set(licenseKey, license);

  console.log("✅ License validated successfully");
  res.json({
    success: true,
    message: "License validated successfully",
    license,
  });
});

/**
 * 🩺 Health check endpoint
 */
app.get("/", (req, res) => {
  res.send("✅ Mila License Server is up and running!");
});

app.listen(PORT, () =>
  console.log(`🚀 Mila License Server running on port ${PORT}`)
);
