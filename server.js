import express from "express";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 10000;

// === Global Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // <— important for Payhip webhooks

// === License persistence ===
const LICENSE_FILE = path.resolve("./licenses.json");
let licenses = {};

function loadLicenses() {
  try {
    if (fs.existsSync(LICENSE_FILE)) {
      const data = fs.readFileSync(LICENSE_FILE, "utf-8");
      licenses = JSON.parse(data);
      console.log("✅ Licenses loaded:", Object.keys(licenses).length);
    }
  } catch (err) {
    console.error("❌ Failed to load licenses:", err);
  }
}

function saveLicenses() {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
}

// === Root route ===
app.get("/", (req, res) => {
  res.send("✅ Mila License Server is running.");
});

// === License validation route ===
app.post("/validate-license", async (req, res) => {
  try {
    const { licenseKey } = req.body;
    if (!licenseKey)
      return res.status(400).json({ success: false, message: "Missing license key" });

    const license = licenses[licenseKey];
    if (!license)
      return res.status(404).json({ success: false, message: "License not found" });

    if (license.activated)
      return res.json({ success: false, message: "License already activated" });

    license.activated = true;
    license.activatedAt = new Date().toISOString();
    saveLicenses();

    res.json({ success: true, message: "License validated successfully" });
  } catch (err) {
    console.error("❌ Validation error:", err);
    res.status(500).json({ success: false, message: "Server error during validation" });
  }
});

// === Payhip Webhook (Fixed Parsing + Logging) ===
app.post("/payhip-webhook", (req, res) => {
  try {
    console.log("📦 Raw webhook body:", req.body);

    // Handle both JSON and URL-encoded formats
    const payload =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    console.log("📦 Parsed webhook:", JSON.stringify(payload, null, 2));

    const item = payload?.items?.[0];
    if (!item) {
      console.log("❌ No items in webhook payload.");
      return res.status(400).json({ success: false, message: "No items in payload" });
    }

    const license_key = item.license_key;
    const product_id = item.product_id;
    const product_name = item.product_name;
    const buyer_email = payload.email;

    if (!license_key || !product_id) {
      console.log("❌ Missing license_key or product_id. Item data:", item);
      return res.status(400).json({ success: false, message: "Missing fields" });
    }

    // Save license
    licenses[license_key] = {
      product_id,
      product_name,
      buyer_email,
      activated: false,
      createdAt: new Date().toISOString(),
    };
    saveLicenses();

    console.log(`✅ Stored license: ${license_key}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// === Debug endpoint ===
app.get("/licenses", (req, res) => {
  res.json({ count: Object.keys(licenses).length, licenses });
});

// === Start server ===
app.listen(PORT, () => {
  loadLicenses();
  console.log(`🚀 Mila License Server is running on port ${PORT}`);
});
