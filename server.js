import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";

const app = express();
app.use(bodyParser.json());

// Read Payhip API key from environment
const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;

// License verification endpoint
app.post("/verify", async (req, res) => {
  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res.json({ status: "error", message: "No license key provided" });
  }

  try {
    // Call Payhip API
    const response = await fetch("https://payhip.com/api/v2/licenses/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PAYHIP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ license_key: licenseKey }),
    });

    const data = await response.json();

    if (data.valid) {
      res.json({ status: "success", message: "License is valid" });
    } else {
      res.json({ status: "error", message: "Invalid or expired license" });
    }

  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ status: "error", message: "Server error verifying license" });
  }
});

// Test route
app.get("/", (req, res) => {
  res.send("Mila License Server is running ✅");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
