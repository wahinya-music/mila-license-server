// server.js
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// --- Temporary in-memory "database" of valid keys ---
const validLicenses = {
  "12345-ABCDE": { product: "Tamaduni Player", user: "Demo User" },
  "67890-ZYXWV": { product: "Tamaduni Player", user: "Another User" }
};

// --- License verification endpoint ---
app.post("/verify", (req, res) => {
  const { license, product } = req.body || {};

  console.log("License request received:", license, product);

  if (!license || !product) {
    return res.json({ status: "error", message: "Missing license or product." });
  }

  const licenseData = validLicenses[license];

  if (!licenseData) {
    return res.json({ status: "error", message: "Invalid license key." });
  }

  if (licenseData.product !== product) {
    return res.json({ status: "error", message: "Product mismatch." });
  }

  return res.json({
    status: "ok",
    message: "License activated successfully.",
    product: licenseData.product,
    user: licenseData.user
  });
});

// Root route
app.get("/", (req, res) => {
  res.send("Mila License Server is running ✅");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
