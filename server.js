import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;

// === Basic JSON file persistence ===
const LICENSES_FILE = "./licenses.json";
let licenses = {};

// Load licenses from file on startup
if (fs.existsSync(LICENSES_FILE)) {
  try {
    const raw = fs.readFileSync(LICENSES_FILE, "utf8");
    licenses = JSON.parse(raw);
    console.log(`📂 Loaded ${Object.keys(licenses).length} licenses from file.`);
  } catch (err) {
    console.error("⚠️ Failed to load licenses file:", err);
  }
}

// Save licenses to file
const saveLicenses = () => {
  fs.writeFileSync(LICENSES_FILE, JSON.stringify(licenses, null, 2));
  console.log("💾 Licenses saved to file.");
};

// === License Validation Endpoint ===
app.post("/validate-license", async (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey)
    return res.status(400).json({ success: false, message: "Missing licenseKey" });

  try {
    console.log("🔍 Sending request to Payhip API...");

    const response = await fetch("https://payhip.com/api/v2/licenses/verify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYHIP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product: PAYHIP_PRODUCT_KEY,
        license: licenseKey,
      }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("❌ Payhip returned non-JSON (HTML) response:", text);
      throw new Error("Payhip returned invalid JSON (check API URL or key)");
    }

    console.log("✅ Payhip response:", data);

    if (data.valid) {
      return res.json({
        success: true,
        message: "License validated successfully",
        payhipResponse: data,
      });
    } else {
      return res.json({
        success: false,
        message: "Invalid License",
        payhipResponse: data,
      });
    }
  } catch (err) {
    console.error("❌ Payhip connection failed:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during validation",
      error: err.message,
    });
  }
});

// === Payhip Webhook Endpoint (Fixed) ===
app.post("/payhip-webhook", express.urlencoded({ extended: true }), async (req, res) => {
  try {
    // Handle both JSON and URL-encoded payloads
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    console.log("📦 Received webhook from Payhip:", payload);

    const items = payload.items || [];
    const item = items.length > 0 ? items[0] : null;

    if (!item) {
      console.log("❌ No item found in webhook payload");
      return res.status(400).json({ success: false, message: "No items in payload" });
    }

    const license_key = item.license_key;
    const product_id = item.product_id;
    const product_name = item.product_name;
    const buyer_email = payload.email;

    if (!license_key || !product_id) {
      console.log("❌ Missing license_key or product_id in webhook payload:", item);
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Save license locally
    licenses[license_key] = {
      product_id,
      product_name,
      buyer_email,
      activated: false,
      createdAt: new Date().toISOString(),
    };

    saveLicenses();
    console.log(`✅ Stored new license: ${license_key}`);

    return res.json({ success: true });
  } catch (error) {
    console.error("❌ Error handling webhook:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});


// === Debug Endpoint (View All Licenses) ===
app.get("/licenses", (req, res) => {
  res.json({
    count: Object.keys(licenses).length,
    licenses,
  });
});

// === Start Server ===
app.listen(PORT, () =>
  console.log(`🚀 Mila License Server running on port ${PORT}`)
);
