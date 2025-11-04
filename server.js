// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

// === Load environment variables ===
const {
  PORT = 10000,
  PAYHIP_PRODUCT_SECRET,
  PAYHIP_WEBHOOK_SECRET,
  PAYHIP_PRODUCT_KEY,
  MILA_SHARED_SECRET,
  ADMIN_KEY,
} = process.env;

// === Verify env vars ===
if (!PAYHIP_PRODUCT_SECRET || !MILA_SHARED_SECRET) {
  console.error("❌ Missing required environment variables. Check .env file.");
  process.exit(1);
}

// === Rate Limiter ===
const limiter = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 10, // limit each IP to 10 requests per 30s
});
app.use(limiter);

// === Root route ===
app.get("/", (req, res) => {
  res.json({
    status: "✅ Mila License Server running",
    message: "Use POST /verify-license to verify license keys via Payhip.",
  });
});

// === License Verification Route ===
// === License Verification Route ===
app.post("/verify-license", async (req, res) => {
  const clientSecret = req.headers["x-shared-secret"];
  if (clientSecret !== process.env.MILA_SHARED_SECRET) {
    return res.status(403).json({ error: "Unauthorized request" });
  }

  const { licenseKey } = req.body;
  if (!licenseKey) {
    return res.status(400).json({ error: "Missing license key" });
  }

  try {
    // === Correct header capitalization ===
    const url = `https://payhip.com/api/v2/license/verify?license_key=${licenseKey}`;
    const payhipResp = await fetch(url, {
      method: "GET",
      headers: {
        "Product-Secret-Key": process.env.PAYHIP_PRODUCT_SECRET,
        "Accept": "application/json",
      },
    });

    const payhipData = await payhipResp.json();

    console.log("📦 Payhip response:", payhipData);

    if (!payhipData?.data || !payhipData.data.enabled) {
      return res.status(400).json({ valid: false, error: "Invalid or disabled license" });
    }

    // === Create activation JSON ===
    const activationData = {
      product: process.env.PAYHIP_PRODUCT_KEY || "Unknown",
      verified_at: new Date().toISOString(),
      source: "payhip",
      license_key: payhipData.data.license_key,
      buyer_email: payhipData.data.buyer_email,
      uses: payhipData.data.uses,
      date: payhipData.data.date,
    };

    // === Send downloadable JSON file ===
    const fileName = "tamaduni_player_activation.json";
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.status(200).send(JSON.stringify(activationData, null, 2));
  } catch (err) {
    console.error("❌ Error during verification:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// === Webhook endpoint (optional future use) ===
app.post("/webhook/payhip", (req, res) => {
  const { secret } = req.query;
  if (secret !== PAYHIP_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized webhook" });
  }

  console.log("📩 Webhook event received:", req.body);
  res.status(200).json({ received: true });
});

// === Admin endpoint (optional) ===
app.get("/admin/check", (req, res) => {
  const key = req.query.key;
  if (key !== ADMIN_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  res.json({ status: "Admin access granted", time: new Date().toISOString() });
});

// === Start Server ===
app.listen(PORT, () => {
  console.log(`🚀 Mila License Server running on port ${PORT}`);
});
