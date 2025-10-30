import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;

app.post("/validate-license", async (req, res) => {
  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res.status(400).json({ success: false, message: "Missing licenseKey" });
  }

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

    const data = await response.json();
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

app.listen(PORT, () => console.log(`🚀 Mila License Server running on port ${PORT}`));
