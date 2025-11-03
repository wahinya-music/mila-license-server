// =============================================
// MILA AFRIKA LICENSE SERVER (GitHub + Dropbox Hybrid Sync)
// =============================================
import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import simpleGit from "simple-git";
import cron from "node-cron";
import bodyParser from "body-parser";
import { execSync } from "child_process";
import dotenv from "dotenv";

// Dropbox sync helper
import { uploadLicensesToDropbox, downloadLicensesFromDropbox } from "./dropboxSync.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// ================= Configuration =================
const LICENSES_DIR = path.resolve("./licenses");
if (!fs.existsSync(LICENSES_DIR)) fs.mkdirSync(LICENSES_DIR, { recursive: true });

const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GIT_SSH_KEY = process.env.GIT_SSH_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const PASSPHRASE = process.env.ENCRYPTION_KEY || "thayu!";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(PASSPHRASE).digest();
const PULL_INTERVAL_HOURS = parseInt(process.env.PULL_INTERVAL_HOURS || "24", 10);
const PORT = parseInt(process.env.PORT || "10000", 10);

// ================= SSH Setup =================
const sshKeyPath = "/tmp/render_id_ed25519";
const sshConfigured = (() => {
  try {
    if (GIT_SSH_KEY?.trim()) {
      fs.writeFileSync(sshKeyPath, GIT_SSH_KEY.trim() + "\n", { mode: 0o600 });
      const sshConfig = `Host github.com
  IdentityFile ${sshKeyPath}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;
      fs.writeFileSync("/tmp/ssh_config_for_render", sshConfig, { mode: 0o600 });
      process.env.GIT_SSH_COMMAND = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      return true;
    }
  } catch (err) {
    console.warn("⚠️ SSH setup warning:", err.message);
  }
  return false;
})();

// ================= Encryption =================
const ALGORITHM = "aes-256-cbc";
const IV_LENGTH = 16;

function encryptText(plain) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plain, "utf8")), cipher.final()]);
  return iv.toString("base64") + ":" + encrypted.toString("base64");
}
function decryptText(encryptedStr) {
  try {
    const [ivB64, dataB64] = encryptedStr.split(":");
    if (!ivB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, "base64");
    const encrypted = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

// ================= Git Setup =================
const git = simpleGit({
  baseDir: process.cwd(),
  binary: "git",
  config: sshConfigured ? [`core.sshCommand=${process.env.GIT_SSH_COMMAND}`] : [],
});

function httpsAuthUrl(repoUrl, token) {
  if (!repoUrl?.startsWith("https://") || !token) return repoUrl;
  return repoUrl.replace("https://", `https://x-access-token:${encodeURIComponent(token)}@`);
}

// ================= Utility =================
async function withRetries(fn, attempts = 3, baseDelayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = baseDelayMs * Math.pow(2, i);
      console.warn(`⚠️ Attempt ${i + 1}/${attempts} failed: ${err.message}. Retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ================= Git Sync Helpers =================
async function ensureRepoCloned() {
  if (!fs.existsSync(".git")) {
    console.log("📦 Cloning license repo...");
    let repoUrl = GITHUB_REPO;
    if (!repoUrl) throw new Error("GITHUB_REPO not configured");
    if (repoUrl.startsWith("https://") && GITHUB_TOKEN)
      repoUrl = httpsAuthUrl(repoUrl, GITHUB_TOKEN);
    await withRetries(() => git.clone(repoUrl, "."), 4);
    console.log("✅ Repo cloned.");
  }
}

async function pullLatest() {
  await ensureRepoCloned();
  await withRetries(async () => {
    if (GITHUB_REPO.startsWith("https://") && GITHUB_TOKEN)
      await git.remote(["set-url", "origin", httpsAuthUrl(GITHUB_REPO, GITHUB_TOKEN)]);
    await git.pull("origin", "main");
  }, 4);
}

async function pushEncryptedAndRestore() {
  const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  const originals = {};
  for (const f of files) originals[f] = fs.readFileSync(path.join(LICENSES_DIR, f), "utf8");

  try {
    for (const f of files) {
      fs.writeFileSync(path.join(LICENSES_DIR, f), encryptText(originals[f]), "utf8");
    }

    await withRetries(async () => {
      if (GITHUB_REPO.startsWith("https://") && GITHUB_TOKEN)
        await git.remote(["set-url", "origin", httpsAuthUrl(GITHUB_REPO, GITHUB_TOKEN)]);
      await git.add("./*");
      try {
        await git.commit(`🔐 License update @ ${new Date().toISOString()}`);
      } catch {}
      await git.push("origin", "main");
    }, 3, 2000);
  } finally {
    for (const f of files)
      fs.writeFileSync(path.join(LICENSES_DIR, f), originals[f], "utf8");
  }
}

function decryptAllFiles() {
  const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const p = path.join(LICENSES_DIR, f);
    const content = fs.readFileSync(p, "utf8");
    if (content.includes(":")) {
      const dec = decryptText(content);
      if (dec) fs.writeFileSync(p, dec, "utf8");
    }
  }
}

// ================= License Helpers =================
function productToFile(product) {
  return product.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_\-]/g, "") + ".json";
}
function loadLicenses(product) {
  const file = path.join(LICENSES_DIR, productToFile(product));
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}
function saveLicenses(product, data) {
  fs.writeFileSync(path.join(LICENSES_DIR, productToFile(product)), JSON.stringify(data, null, 2));
}

// ================= API Routes =================
app.post("/verify", (req, res) => {
  const { license_key, product } = req.body;
  if (!license_key || !product) return res.status(400).json({ success: false, message: "Missing fields" });
  const found = loadLicenses(product).find((l) => l.license_key === license_key);
  res.status(found ? 200 : 404).json(found ? { success: true, license: found } : { success: false, message: "Invalid key" });
});

app.post("/webhook/payhip", async (req, res) => {
  try {
    const { license_key, buyer_email, product_name } = req.body;
    if (!license_key || !product_name) return res.status(400).json({ success: false, message: "Invalid webhook data" });

    const product = product_name;
    const licenses = loadLicenses(product);
    if (!licenses.some((l) => l.license_key === license_key)) {
      licenses.push({ license_key, buyer_email, activated: false, issued_at: new Date().toISOString() });
      saveLicenses(product, licenses);

      pushEncryptedAndRestore().catch((err) => console.error("❌ GitHub push error:", err.message));
      uploadLicensesToDropbox().catch((err) => console.error("❌ Dropbox upload error:", err.message));
    }
    res.json({ success: true, message: "License recorded" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/admin/licenses", (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_KEY;
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY)
    return res.status(403).json({ success: false, message: "Unauthorized" });
  const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  res.json(Object.fromEntries(files.map((f) => [f, JSON.parse(fs.readFileSync(path.join(LICENSES_DIR, f), "utf8"))])));
});

app.get("/", (_, res) =>
  res.send({ success: true, message: "Mila License Server running", repo: GITHUB_REPO, ssh: sshConfigured })
);

// ================= Cron Sync =================
cron.schedule(`0 */${Math.max(1, PULL_INTERVAL_HOURS)} * * *`, async () => {
  console.log("⏰ Scheduled sync...");
  try {
    await pullLatest();
    decryptAllFiles();
    await downloadLicensesFromDropbox();
    console.log("✅ Sync complete");
  } catch (err) {
    console.error("❌ Sync failed:", err.message);
  }
});

// ================= Startup =================
(async () => {
  try {
    console.log("⬇️ Attempting Dropbox restore...");
    await downloadLicensesFromDropbox().catch(() => console.warn("⚠️ Dropbox restore skipped."));

    if (GITHUB_REPO) {
      await pullLatest().catch(() => console.warn("⚠️ GitHub sync failed, continuing..."));
      decryptAllFiles();
    } else {
      console.warn("⚠️ GITHUB_REPO not set — GitHub sync disabled.");
    }

    console.log("✅ Startup complete.");
  } catch (err) {
    console.error("❌ Startup error:", err.message);
  } finally {
    app.listen(PORT, () => console.log(`🚀 Mila License Server running on port ${PORT}`));
  }
})();
