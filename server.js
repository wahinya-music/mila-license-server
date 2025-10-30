import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;

// --- JSON persistence setup ---
const DATA_FILE = path.resolve("./licenses.json");

// Load licenses from JSON file (if exists)
let licenses = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    licenses = JSON.parse(data);
    console.log(`📂 Loaded ${Object.keys(licenses).length} licenses from file.`);
  } catch (err) {
    console.error("❌ Error reading licenses.json:", err);
    licenses = {};
  }
}

// Helper function to save licenses to file
function saveLicenses() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(licenses, null, 2));
    console.log("💾 Licenses saved to file.");
  } catch (err) {
    console.error("❌ Failed to save licenses:", err);
  }
}

/**
 * ✅ Payhip Webhook Endpoint
 * Payhip will POST here whenever a license/product is sold.
 */
app.post("/payhip-webhook", async (req, res) => {
  try {
    console.log("📦 Received webhook from Payhip:", req.body);

    // Extract license info correctly from nested payload
    const item = req.body.items && req.body.items[0];
    if (!item) {
      console.log("❌ No item found in webhook payload");
      return res.status(400).json({ success: false });
    }

    const { license_key, product_id, product_name } = item;
    const buyer_email = req.body.email;

    if (!license_key || !product_id) {
      console.log("❌ Missing license_key or product_id in webhook payload");
      return res.status(400).json({ success: false });
    }

    // Store license info
    licenses[license_key] = {
      product_id,
      product_name,
      buyer_email,
      activated: false,
      createdAt: new Date().toISOString(),
    };

    saveLicenses();

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

  const license = licenses[licenseKey];

  if (!license) {
    console.log("❌ License not found");
    return res.json({
      success: false,
      message: "License not found. Please ensure you purchased the product.",
    });
  }

  // Optional: mark as activated
  license.activated = true;
  saveLicenses();

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
  res.send("✅ Mila License Server is up and running with persistent licenses!");
});

app.listen(PORT, () =>
  console.log(`🚀 Mila License Server running on port ${PORT}`)
);
