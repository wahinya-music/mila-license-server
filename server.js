import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// Root test route
app.get("/", (req, res) => {
  res.send("✅ Mila License Server is running!");
});

// Example license validation route
app.post("/verify-license", async (req, res) => {
  try {
    const { license_key } = req.body;

    if (!license_key) {
      return res.status(400).json({ error: "License key is required" });
    }

    const response = await axios.get(
      `https://payhip.com/api/v2/licenses/${license_key}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYHIP_API_KEY}`,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("License verification error:", error.message);
    res
      .status(500)
      .json({ error: "Failed to verify license", details: error.message });
  }
});

// ✅ Prevent double start & handle Render dynamic port
if (!module.parent) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
}

export default app;
