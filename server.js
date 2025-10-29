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

  try {
    const response = await fetch("https://payhip.com/api/v1/licenses/verify", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PAYHIP_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        product_id: "YOUR_PRODUCT_ID", // replace this with your actual Payhip product ID
        license: licenseKey
      })
    });

    const data = await response.json();
    console.log("Verification response:", data);

    if (data.success) {
      res.json({ status: "success", message: "License valid" });
    } else {
      res.json({ status: "error", message: "Invalid license" });
    }
  } catch (err) {
    console.error("Verification error:", err);
    res.json({ status: "error", message: "Server error verifying license" });
  }
});

// Test route
app.get("/", (req, res) => {
  res.send("Mila License Server is running ✅");
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

