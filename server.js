import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ✅ License verification endpoint
app.post("/verify", async (req, res) => {
  const { license, product } = req.body;

  if (!license) {
    return res.status(400).json({ status: "error", message: "No license key provided" });
  }

  try {
    // 🔑 Step 1: Check license with Payhip API
    const payhipRes = await fetch("https://payhip.com/api/v2/licenses/verify", {
      method: "POST",
      headers: {
        "Authorization": "Bearer YOUR_PAYHIP_API_KEY", // 👈 replace this later
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ license_key: license })
    });

    const data = await payhipRes.json();

    // 🔍 Step 2: Respond to HISE
    if (data.valid) {
      return res.json({
        status: "ok",
        message: "License valid",
        product: product || data.product_name
      });
    } else {
      return res.json({
        status: "error",
        message: data.message || "License invalid"
      });
    }

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ status: "error", message: "Server failed to contact Payhip" });
  }
});

// ✅ Start the server
app.listen(3000, () => console.log("License server running on port 3000"));
