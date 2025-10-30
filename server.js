// === Dependency Check ===
const requiredPackages = ["express", "dotenv", "axios", "body-parser", "node-fetch"];
for (const pkg of requiredPackages) {
  try {
    require.resolve(pkg);
  } catch (err) {
    console.error(`❌ Missing dependency: "${pkg}". Please run: npm install ${pkg}`);
    process.exit(1);
  }
}
console.log("✅ All dependencies verified.\n");

import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || "mila_admin_secret";

const LICENSE_FILE = path.resolve("licenses.json");

// === Load or initialize local license store ===
let licenses = {};
if (fs.existsSync(LICENSE_FILE)) {
  licenses = JSON.parse(fs.readFileSync(LICENSE_FILE, "utf8"));
} else {
  licenses = { count: 0, licenses: {} };
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
}

// === Save helper ===
function saveLicenses() {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
  console.log("💾 Licenses saved locally");
}

// === Verify Payhip webhook signature ===
function verifyPayhipSignature(body, signature) {
  const secret = PAYHIP_API_KEY; // Payhip API key used as signing secret
  const payload = JSON.stringify(body);
  const hash = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return hash === signature;
}

// === Payhip Webhook ===
app.post("/webhook/payhip", async (req, res) => {
  const body = req.body;
  console.log("📦 Received webhook from Payhip:", body);

  const signature = body.signature;
  if (!signature || !verifyPayhipSignature(body, signature)) {
    console.warn("❌ Invalid signature — webhook ignored.");
    return res.status(403).json({ success: false, message: "Invalid signature" });
  }

  const item = body.items?.[0];
  if (!item || !item.license_key || !item.product_id) {
    console.error("❌ Missing license_key or product_id in webhook payload");
    return res.status(400).json({ success: false });
  }

  const licenseKey = item.license_key;
  licenses.licenses[licenseKey] = {
    product_id: item.product_id,
    product_name: item.product_name,
    buyer_email: body.email,
    activated: false,
    createdAt: new Date().toISOString(),
  };
  licenses.count = Object.keys(licenses.licenses).length;

  saveLicenses();

  console.log(`✅ License stored for ${licenseKey}`);
  res.json({ success: true });
});

// === License validation endpoint ===
app.post("/validate_license", async (req, res) => {
  const { Licensekey } = req.body;
  if (!Licensekey)
    return res.status(400).json({ success: false, message: "Missing licenseKey" });

  const lic = licenses.licenses[Licensekey];
  if (lic) {
    return res.json({
      success: true,
      message: "License validated successfully",
      license: lic,
    });
  }

  res.json({ success: false, message: "Invalid license" });
});

// === Admin routes (protected) ===
app.get("/admin/licenses", (req, res) => {
  if (req.query.key !== ADMIN_KEY)
    return res.status(403).json({ success: false, message: "Unauthorized" });
  res.json(licenses);
});

app.post("/admin/clear", (req, res) => {
  if (req.query.key !== ADMIN_KEY)
    return res.status(403).json({ success: false, message: "Unauthorized" });

  licenses = { count: 0, licenses: {} };
  saveLicenses();
  res.json({ success: true, message: "All licenses cleared" });
});

app.post("/admin/test-backup", (req, res) => {
  if (req.query.key !== ADMIN_KEY)
    return res.status(403).json({ success: false, message: "Unauthorized" });

  saveLicenses();
  res.json({ success: true, message: "Local backup saved" });
});

// === Start server ===
app.listen(PORT, () => console.log(`🚀 Mila License Server running cleanly on port ${PORT}`));
