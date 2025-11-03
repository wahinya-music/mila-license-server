// =============================================
// MILA AFRIKA LICENSE SERVER (Encrypted GitHub Sync + SSH/Token auth + Retry)
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

dotenv.config();

const app = express();
app.use(bodyParser.json());

// ================= Configuration =================
const LICENSES_DIR = path.resolve("./licenses");
if (!fs.existsSync(LICENSES_DIR)) fs.mkdirSync(LICENSES_DIR, { recursive: true });

const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GIT_SSH_KEY = process.env.GIT_SSH_KEY || ""; // private SSH key contents (optional)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ""; // token fallback for HTTPS
const PASSPHRASE = process.env.ENCRYPTION_KEY || "thayu!";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(PASSPHRASE).digest(); // 32 bytes
const PULL_INTERVAL_HOURS = parseInt(process.env.PULL_INTERVAL_HOURS || "24", 10);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 10000;

// Masked repo display for logs
function maskedRepoDisplay(repo) {
  if (!repo) return "(none)";
  return repo.replace(/:\/\/.*@/, "://***:***@").replace(/:[^/]+@/, ":***@");
}

// ================= SSH setup (if key provided) =================
const sshKeyPath = "/tmp/render_id_ed25519"; // writable in Render
const sshConfigured = (() => {
  try {
    if (GIT_SSH_KEY && GIT_SSH_KEY.trim().length > 0) {
      // write private key to file
      fs.writeFileSync(sshKeyPath, GIT_SSH_KEY.trim() + "\n", { mode: 0o600 });
      // optional SSH config (not strictly required because we'll use GIT_SSH_COMMAND)
      const sshConfig = `Host github.com
  IdentityFile ${sshKeyPath}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
`;
      try { fs.writeFileSync("/tmp/ssh_config_for_render", sshConfig, { mode: 0o600 }); } catch {}
      // attempt to start ssh-agent and add the key
      try {
        execSync(`ssh-add -l >/dev/null 2>&1 || (eval $(ssh-agent -s) >/dev/null && ssh-add ${sshKeyPath})`, { stdio: "inherit", shell: "/bin/bash" });
      } catch (err) {
        // ssh-agent may not be available; still set GIT_SSH_COMMAND
      }
      // force simple-git / git to use this key
      process.env.GIT_SSH_COMMAND = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`;
      return true;
    }
  } catch (err) {
    console.warn("⚠️ SSH setup warning:", err.message);
  }
  return false;
})();

console.log("🗄 Repo configured:", maskedRepoDisplay(GITHUB_REPO));
console.log(`🔐 Encryption key: ${PASSPHRASE ? "(set)" : "(using default)"}`);
console.log(`🔑 SSH key provided: ${sshConfigured ? "yes" : "no (using token/https if configured)"}`);

// ================= Encryption helpers =================
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
  } catch (err) {
    console.warn("⚠️ Decrypt failed:", err.message);
    return null;
  }
}

// ================= simple-git setup =================
// Pass core.sshCommand only if SSH configured; otherwise rely on HTTPS+token if provided.
const gitOptions = { baseDir: process.cwd(), binary: "git" };
if (sshConfigured) gitOptions.config = [`core.sshCommand=${process.env.GIT_SSH_COMMAND}`];

const git = simpleGit(gitOptions);

// Build an authenticated HTTPS URL if repo is HTTPS and token provided
function httpsAuthUrl(repoUrl, token) {
  if (!repoUrl || !repoUrl.startsWith("https://")) return repoUrl;
  if (!token) return repoUrl;
  // prefer x-access-token style for GitHub: https://x-access-token:<token>@github.com/owner/repo.git
  return repoUrl.replace("https://", `https://x-access-token:${encodeURIComponent(token)}@`);
}

// ================= Utility: retry wrapper for git ops =================
async function withRetries(fn, attempts = 3, baseDelayMs = 1500) {
  let lastErr;
  for (let i = 0; i < attempts; ++i) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = baseDelayMs * Math.pow(2, i);
      console.warn(`⚠️ Operation failed (attempt ${i + 1}/${attempts}): ${err.message}. Retrying in ${Math.round(wait)}ms...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ================= Git sync helpers =================
async function ensureRepoCloned() {
  // If there is already a .git, assume repo present. If not, clone.
  if (!fs.existsSync(path.join(process.cwd(), ".git"))) {
    console.log("📦 No .git found — cloning license repo...");
    let repoUrl = GITHUB_REPO;
    if (!repoUrl) throw new Error("GITHUB_REPO not configured");
    // prefer SSH (git@github...) if provided, else https with token
    if (repoUrl.startsWith("https://") && GITHUB_TOKEN) {
      repoUrl = httpsAuthUrl(repoUrl, GITHUB_TOKEN);
    }
    await withRetries(() => git.clone(repoUrl, "."), 4);
    console.log("✅ Repo cloned.");
  } else {
    console.log("🔁 Repo already present — skipping clone.");
  }
}

async function pullLatest() {
  await ensureRepoCloned();
  await withRetries(async () => {
    // If HTTPS repo and token provided, set remote URL temporarily to auth form (so pull works)
    if (GITHUB_REPO.startsWith("https://") && GITHUB_TOKEN) {
      const auth = httpsAuthUrl(GITHUB_REPO, GITHUB_TOKEN);
      try { await git.remote(["set-url", "origin", auth]); } catch {}
    }
    await git.pull("origin", "main");
  }, 4);
}

async function pushEncryptedAndRestore() {
  // Encrypt on-disk files, commit & push, then re-decrypt for runtime usage.
  const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  // store originals
  const originals = {};
  for (const f of files) originals[f] = fs.readFileSync(path.join(LICENSES_DIR, f), "utf8");

  try {
    // encrypt each file
    for (const f of files) {
      const p = path.join(LICENSES_DIR, f);
      const enc = encryptText(originals[f]);
      fs.writeFileSync(p, enc, "utf8");
    }

    // stage/commit/push
    await withRetries(async () => {
      // ensure remote uses auth if HTTPS
      if (GITHUB_REPO.startsWith("https://") && GITHUB_TOKEN) {
        const auth = httpsAuthUrl(GITHUB_REPO, GITHUB_TOKEN);
        try { await git.remote(["set-url", "origin", auth]); } catch {}
      }
      await git.add("./*");
      try {
        await git.commit(`🔐 License update @ ${new Date().toISOString()}`);
      } catch (e) {
        // nothing to commit (no changes) -> ignore
      }
      await git.push("origin", "main");
    }, 4, 2000);
  } finally {
    // restore decrypted files to runtime
    for (const f of files) {
      fs.writeFileSync(path.join(LICENSES_DIR, f), originals[f], "utf8");
    }
  }
}

// decrypt all files in licenses dir (in-place)
function decryptAllFiles() {
  const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const p = path.join(LICENSES_DIR, f);
    const content = fs.readFileSync(p, "utf8");
    // if looks encrypted (contains ':' and base64), try decrypt
    if (content.includes(":")) {
      const dec = decryptText(content);
      if (dec !== null) fs.writeFileSync(p, dec, "utf8");
    }
  }
}

// ================= License file helpers =================
function productToFile(product) {
  // sanitize product name to file-safe name
  return product.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_\-]/g, "") + ".json";
}

function loadLicenses(product) {
  const file = path.join(LICENSES_DIR, productToFile(product));
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn("⚠️ Failed to parse license file:", err.message);
    return [];
  }
}

function saveLicenses(product, licenses) {
  const file = path.join(LICENSES_DIR, productToFile(product));
  fs.writeFileSync(file, JSON.stringify(licenses, null, 2), "utf8");
}

// ================= API routes =================

// Verify license
app.post("/verify", (req, res) => {
  const { license_key, product } = req.body || {};
  if (!license_key || !product) return res.status(400).json({ success: false, message: "Missing license_key or product" });

  const licenses = loadLicenses(product);
  const found = licenses.find((l) => l.license_key === license_key);
  if (found) return res.json({ success: true, license: found });
  return res.status(404).json({ success: false, message: "Invalid license key" });
});

// Payhip webhook (store license and push encrypted)
app.post("/webhook/payhip", async (req, res) => {
  try {
    const { license_key, buyer_email, product_name } = req.body || {};
    if (!license_key || !product_name) return res.status(400).json({ success: false, message: "Invalid webhook data" });

    const product = product_name;
    const licenses = loadLicenses(product);
    // avoid duplicates
    if (!licenses.some((l) => l.license_key === license_key)) {
      licenses.push({ license_key, buyer_email, activated: false, issued_at: new Date().toISOString() });
      saveLicenses(product, licenses);
      // push to GitHub (encrypted), but don't block success if push fails — log it and return success
      pushEncryptedAndRestore().catch((err) => console.error("❌ pushToGitHub error:", err.message));
    } else {
      console.log("⚠️ License already present, skipping duplicate:", license_key);
    }

    return res.json({ success: true, message: "License recorded" });
  } catch (err) {
    console.error("❌ Webhook handler error:", err);
    return res.status(500).json({ success: false, message: "Server error saving license." });
  }
});

// Admin route (list files) — protect with ADMIN_KEY if you use one
app.get("/admin/licenses", (req, res) => {
  const ADMIN_KEY = process.env.ADMIN_KEY || "";
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY) return res.status(403).json({ success: false, message: "Unauthorized" });

  const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
  const out = {};
  for (const f of files) {
    out[f] = JSON.parse(fs.readFileSync(path.join(LICENSES_DIR, f), "utf8"));
  }
  res.json(out);
});

// Root
app.get("/", (req, res) => {
  res.send({
    success: true,
    message: "Mila License Server running",
    repo: maskedRepoDisplay(GITHUB_REPO || "(none)"),
    ssh_key: !!GIT_SSH_KEY,
    token: !!GITHUB_TOKEN,
  });
});

// ================= Periodic sync =================
cron.schedule(`0 */${Math.max(1, PULL_INTERVAL_HOURS)} * * *`, async () => {
  console.log("⏰ Scheduled sync starting...");
  try {
    await pullLatest();
    decryptAllFiles();
    console.log("✅ Scheduled sync complete.");
  } catch (err) {
    console.error("❌ Scheduled sync failed:", err.message);
  }
});

// ================= Startup =================
(async function startup() {
  try {
    // attempt initial sync: prefer SSH clone if GIT_SSH_KEY provided (we already set process.env.GIT_SSH_COMMAND)
    if (!GITHUB_REPO) console.warn("⚠️ GITHUB_REPO not set — sync disabled.");
    else {
      try {
        await pullLatest();
        decryptAllFiles();
        console.log("✅ Initial GitHub sync complete.");
      } catch (err) {
        console.warn("⚠️ Initial GitHub sync failed:", err.message);
        // as last resort, if repo is https and token is present, try with auth URL explicitly
        if (GITHUB_REPO.startsWith("https://") && GITHUB_TOKEN) {
          try {
            const authUrl = httpsAuthUrl(GITHUB_REPO, GITHUB_TOKEN);
            console.log("ℹ️ Trying HTTPS auth URL fallback (token)...");
            await withRetries(() => git.clone(authUrl, "."), 3);
            await pullLatest();
            decryptAllFiles();
            console.log("✅ Fallback HTTPS token clone + sync succeeded.");
          } catch (e) {
            console.error("❌ Fallback HTTPS sync also failed:", e.message);
          }
        }
      }
    }
  } catch (err) {
    console.error("❌ Startup error:", err);
  } finally {
    app.listen(PORT, () => {
      console.log(`🚀 Mila License Server listening on port ${PORT}`);
      console.log(`🗄 Repo: ${maskedRepoDisplay(GITHUB_REPO || "(none)")}`);
    });
  }
})();
