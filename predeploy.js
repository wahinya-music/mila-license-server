// =============================================
// predeploy.js — Mila License Server SSH + Env Precheck (Render-safe)
// =============================================
import fs from "fs";
import os from "os";
import { execSync } from "child_process";

console.log("🧩 Running Render predeploy check...");

// ---------------------------------------------
// 1️⃣ Verify required environment variables
// ---------------------------------------------
const required = [
  "PAYHIP_API_KEY",
  "PAYHIP_PRODUCT_KEY",
  "PAYHIP_WEBHOOK_SECRET",
  "ENCRYPTION_KEY",
  "GITHUB_REPO",
  "GIT_SSH_KEY",
  "PORT"
];

const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error("❌ Missing required environment variables:", missing.join(", "));
  process.exit(1);
}
console.log("✅ Environment variables verified.");

// ---------------------------------------------
// 2️⃣ Ensure server.js exists
// ---------------------------------------------
if (!fs.existsSync("./server.js")) {
  console.error("❌ Missing server.js file — aborting deployment.");
  process.exit(1);
}
console.log("✅ server.js found.");

// ---------------------------------------------
// 3️⃣ Write SSH key to a Render-safe directory
// ---------------------------------------------
const sshDir = `${os.homedir()}/.ssh`;
const sshKey = process.env.GIT_SSH_KEY?.trim();

try {
  if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });

  const keyPath = `${sshDir}/id_ed25519`;
  fs.writeFileSync(keyPath, sshKey + "\n", { mode: 0o600 });

  fs.writeFileSync(
    `${sshDir}/config`,
    `Host github.com\n  IdentityFile ${keyPath}\n  StrictHostKeyChecking no\n`
  );

  console.log(`✅ SSH key written and configured at ${keyPath}.`);
} catch (err) {
  console.error("❌ Failed to configure SSH key:", err.message);
  process.exit(1);
}

// ---------------------------------------------
// 4️⃣ Test SSH connection to GitHub (optional check)
// ---------------------------------------------
try {
  console.log("🔑 Testing SSH connection to GitHub...");
  const testCmd = `ssh -i ${sshDir}/id_ed25519 -T git@github.com -o StrictHostKeyChecking=no`;
  execSync(testCmd, { stdio: "pipe" }).toString();
  console.log("✅ SSH authentication verified with GitHub.");
} catch (err) {
  const stderr = err.stderr?.toString() || err.message;
  if (stderr.includes("successfully authenticated") || stderr.includes("Welcome to GitHub")) {
    console.log("✅ SSH test succeeded (authenticated).");
  } else {
    console.error("❌ SSH test failed:\n", stderr);
    // Don’t exit — sometimes Render blocks outbound SSH
    console.warn("⚠️ Continuing deploy anyway (SSH test may fail on Render).");
  }
}

// ---------------------------------------------
// ✅ All predeploy checks passed
// ---------------------------------------------
console.log("✅ All predeploy checks passed. Ready for Render deploy!");
