const express = require("express");
const app = express();
app.use(express.json());

app.post("/verify", (req, res) => {
  const { license, product } = req.body;

  if (!license) {
    return res.json({ status: "error", message: "No license provided" });
  }

  // Example logic:
  if (license === "12345-ABCDE") {
    return res.json({ status: "success", message: "License valid" });
  }

  res.json({ status: "error", message: "Invalid license" });
});

app.get("/", (req, res) => res.send("Mila Afrika License API running..."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
