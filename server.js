import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(bodyParser.json());

const PAYHIP_API_KEY = process.env.PAYHIP_API_KEY;
const PAYHIP_PRODUCT_KEY = process.env.PAYHIP_PRODUCT_KEY;

// Validate license endpoint
app.post("/validate-license", async (req, res) => {
  const { licenseKey } = req.body;

  try {
    const response = await axios.post(
      "https://api.payhip.com/v2/licenses/verify",
      {
        product: PAYHIP_PRODUCT_KEY,
        license: licenseKey,
      },
      {
        headers: {
          Authorization: `Bearer ${PAYHIP_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.valid) {
      return res.json({
        valid: true,
        message: "License validated successfully",
      });
    } else {
      return res.json({
        valid: false,
        message: "Invalid license",
      });
    }
  } catch (error) {
    console.error("Validation error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error during validation",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mila License Server is running on port ${PORT}`));
