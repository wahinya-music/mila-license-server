import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// --- Test route ---
app.get("/", (req, res) => {
  res.send("✅ Mila License Server is running");
});

// --- Example: License validation route ---
app.post("/validate-license", async (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) {
      return res.status(400).json({ success: false, message: "License key required" });
    }

    // Replace with your actual validation API if needed
    const response = await axios.post("https://api.example.com/validate", { licenseKey });

    if (response.data.valid) {
      return res.json({ success: true, message: "License is valid" });
    } else {
      return res.status(403).json({ success: false, message: "Invalid license" });
    }
  } catch (error) {
    console.error("Validation error:", error.message);
    res.status(500).json({ success: false, message: "Server error during validation" });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
