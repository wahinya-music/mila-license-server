import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "YOUR_SECRET_ADMIN_KEY";
const PAYHIP_WEBHOOK_SECRET = process.env.PAYHIP_WEBHOOK_SECRET || "mywebhook2025secret";

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
  res.send("✅ Mila License Server is running cleanly — no Google Drive active.");
});

// === Admin: Get all licenses ===
app.get("/admin/licenses", async (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized admin key" });
  }

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
    const secret = req.query.secret;
    if (secret !== PAYHIP_WEBHOOK_SECRET) {
      console.log("❌ Invalid webhook secret");
      return res.status(403).json({ success: false, message: "Invalid webhook secret" });
    }

    const payload = req.body;
    console.log("📦 Payhip webhook received:", JSON.stringify(payload, null, 2));

    const item = payload?.items?.[0];
    const payhipLicenseKey = item?.license_key || null;
    const productName = item?.product_name || "unknown";

    if (!payhipLicenseKey) {
      console.log("⚠️ No license key found in Payhip payload.");
      return res.status(400).json({ success: false, message: "Missing license key" });
    }

    const licenses = await loadLicenses();
    const newLicense = {
      id: Date.now().toString(),
      buyer_email: payload?.email || "unknown",
      product_name: productName,
      license_key: payhipLicenseKey,
      created_at: new Date().toISOString(),
    };

    licenses.push(newLicense);
    await saveLicenses(licenses);

    console.log(`✅ Saved Payhip license ${payhipLicenseKey} for ${newLicense.buyer_email}`);
    return res.json({ success: true, license: newLicense });

  } catch (error) {
    console.error("❌ Webhook error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// === Verify: Check if license is valid and return JSON ===
app.post("/verify", async (req, res) => {
  try {
    const { license_key } = req.body;
    if (!license_key) {
      return res.status(400).json({ success: false, message: "License key is required" });
    }

    const licenses = await loadLicenses();
    const license = licenses.find(l => l.license_key === license_key);

    if (!license) {
      console.log("❌ Invalid license key:", license_key);
      return res.status(404).json({ success: false, message: "Invalid license key" });
    }

    console.log(`✅ Valid license verified for ${license.buyer_email}`);

    // === Create tamaduni_player_activation.json ===
    const filePath = path.join(process.cwd(), "tamaduni_player_activation.json");
    fs.writeFileSync(filePath, JSON.stringify(license, null, 2));

    // === Send file as downloadable attachment ===
    res.download(filePath, "tamaduni_player_activation.json", (err) => {
      if (err) {
        console.error("❌ Error sending license file:", err);
      } else {
        console.log(`📄 License file sent successfully: ${filePath}`);
        // You can uncomment the next line to auto-delete after sending:
        // fs.unlinkSync(filePath);
      }
    });

  } catch (error) {
    console.error("❌ Verify route error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// === Start server ===
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("✅ /verify route active — ready to handle license validation");
});
