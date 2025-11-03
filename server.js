// =============================================
// MILA AFRIKA LICENSE SERVER (GitHub + Dropbox Hybrid Sync)
// Updated: adds robust Payhip webhook handling, logging, and safety checks
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
// body parser for JSON webhooks / API calls
app.use(bodyParser.json({ limit: "1mb" }));

// ================= Configuration =================
const LICENSES_DIR = path.resolve("./licenses");
if (!fs.existsSync(LICENSES_DIR)) fs.mkdirSync(LICENSES_DIR, { recursive: true });

const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GIT_SSH_KEY = process.env.GIT_SSH_KEY || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const PAYHIP_WEBHOOK_SECRET = process.env.PAYHIP_WEBHOOK_SECRET || "";
const PASSPHRASE = process.env.ENCRYPTION_KEY || "thayu!";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(PASSPHRASE).digest(); // 32 bytes
const PULL_INTERVAL_HOURS = parseInt(process.env.PULL_INTERVAL_HOURS || "24", 10);
const PORT = parseInt(process.env.PORT || "10000", 10);

// small helper to mask repo logs
function maskedRepoDisplay(repo) {
  if (!repo) return "(none)";
  return repo.replace(/:\/\/.*@/, "://***:***@").replace(/:[^/]+@/, ":***@");
}

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
      try { fs.writeFileSync("/tmp/ssh_config_for_render", sshConfig, { mode: 0o600 }); } catch (e) {}
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
const git = simpleGit({
  baseDir: process.cwd(),
  binary: "git",
  config: sshConfigured ? [`core.sshCommand=${process.env.GIT_SSH_COMMAND}`] : [],
});

function httpsAuthUrl(repoUrl, token) {
  if (!repoUrl?.startsWith("https://") || !token) return repoUrl;
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
  if (!fs.existsSync(path.join(process.cwd(), ".git"))) {
    console.log("📦 No .git found — cloning license repo...");
    let repoUrl = GITHUB_REPO;
    if (!repoUrl) throw new Error("GITHUB_REPO not configured");
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
  if (files.length === 0) {
    console.log("ℹ️ No license files to push.");
    return;
  }
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
      if (GITHUB_REPO.startsWith("https://") && GITHUB_TOKEN) {
        const auth = httpsAuthUrl(GITHUB_REPO, GITHUB_TOKEN);
        try { await git.remote(["set-url", "origin", auth]); } catch {}
      }
      await git.add("./*");
      try {
        await git.commit(`🔐 License update @ ${new Date().toISOString()}`);
      } catch (e) {
        // nothing to commit -> ignore
      }
      await git.push("origin", "main");
    }, 4, 2000);
  } finally {
    // restore decrypted files for runtime
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
    if (content.includes(":")) {
      const dec = decryptText(content);
      if (dec !== null) fs.writeFileSync(p, dec, "utf8");
    }
  }
}

// ================= License file helpers =================
function productToFile(product) {
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

// ================= Payhip webhook payload helper =================
// Payhip webhook fields can vary; try several common shapes.
function extractFromPayhipBody(body) {
  // Common shape you're using earlier
  if (body.license_key || body.licenseKey) {
    return {
      license_key: body.license_key || body.licenseKey,
      buyer_email: body.buyer_email || body.email || body.buyerEmail || null,
      product_name: body.product_name || body.product || body.productName || null,
    };
  }

  // Some payloads nest license inside an object
  if (body.license && typeof body.license === "object") {
    return {
      license_key: body.license.key || body.license.license_key || null,
      buyer_email: body.license.email || body.license.buyer_email || null,
      product_name: body.product_name || body.product || null,
    };
  }

  // Generic fallback: attempt to find keys by scanning
  const license_key = body.license_key || body.license || body.key || null;
  const buyer_email = body.buyer_email || body.email || body.customer_email || null;
  const product_name = body.product_name || body.product || body.product_title || null;

  return { license_key, buyer_email, product_name };
}

// ================= API Routes =================

// Health
app.get("/health", (_, res) => res.json({ ok: true, envRepo: !!GITHUB_REPO }));

// License verify
app.post("/verify", (req, res) => {
  try {
    const { license_key, product } = req.body || {};
    if (!license_key || !product) return res.status(400).json({ success: false, message: "Missing license_key or product" });

    const licenses = loadLicenses(product);
    const found = licenses.find((l) => l.license_key === license_key);
    if (found) return res.json({ success: true, license: found });
    return res.status(404).json({ success: false, message: "Invalid license key" });
  } catch (err) {
    console.error("❌ /verify error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Payhip webhook — validates ?secret= query parameter, responds immediately then processes
app.post("/webhook/payhip", async (req, res) => {
  try {
    const providedSecret = req.query.secret || "";
    if (!PAYHIP_WEBHOOK_SECRET) {
      console.warn("⚠️ PAYHIP_WEBHOOK_SECRET not configured on server. Accepting webhook for debugging.");
    } else if (providedSecret !== PAYHIP_WEBHOOK_SECRET) {
      console.warn("❌ Invalid webhook secret provided:", providedSecret);
      // reply forbidden to tell sender it's not accepted
      return res.status(403).send("Forbidden");
    }

    // quick ack to the webhook sender so Payhip doesn't retry
    res.status(200).send("OK");

    // process in background
    (async () => {
      try {
        console.log("🎯 Received Payhip webhook headers:", req.headers);
        console.log("🎯 Received Payhip webhook body:", req.body);

        const { license_key, buyer_email, product_name } = extractFromPayhipBody(req.body);

        if (!license_key || !product_name) {
          console.warn("⚠️ Webhook payload missing license_key or product_name. Full body logged above.");
          return;
        }

        const product = product_name;
        const licenses = loadLicenses(product);

        if (!licenses.some((l) => l.license_key === license_key)) {
          licenses.push({
            license_key,
            buyer_email: buyer_email || null,
            activated: false,
            issued_at: new Date().toISOString(),
          });
          saveLicenses(product, licenses);
          console.log(`✅ License saved locally for product="${product}" key="${license_key}"`);

          // push to GitHub (encrypted) and upload to Dropbox — do not block webhook ack
          pushEncryptedAndRestore()
            .then(() => console.log("✅ GitHub push complete (background)"))
            .catch((err) => console.error("❌ GitHub push error (background):", err && err.message ? err.message : err));

          // Dropbox upload — background
          try {
            uploadLicensesToDropbox()
              .then(() => console.log("✅ Dropbox upload complete (background)"))
              .catch((err) => console.error("❌ Dropbox upload error (background):", err && err.message ? err.message : err));
          } catch (err) {
            console.error("❌ trigger uploadLicensesToDropbox error:", err && err.message ? err.message : err);
          }
        } else {
          console.log("⚠️ Duplicate license — skipping:", license_key);
        }
      } catch (bgErr) {
        console.error("❌ Error processing Payhip webhook (background):", bgErr && bgErr.message ? bgErr.message : bgErr);
      }
    })();
  } catch (err) {
    console.error("❌ /webhook/payhip error:", err);
    // If we failed to validate before sending response, return 500
    try { res.status(500).send("Server error"); } catch {}
  }
});

// Admin route (list files) — protect with ADMIN_KEY if you use one
app.get("/admin/licenses", (req, res) => {
  try {
    const ADMIN_KEY = process.env.ADMIN_KEY || "";
    if (ADMIN_KEY && req.query.key !== ADMIN_KEY) return res.status(403).json({ success: false, message: "Unauthorized" });

    const files = fs.readdirSync(LICENSES_DIR).filter((f) => f.endsWith(".json"));
    const out = {};
    for (const f of files) {
      out[f] = JSON.parse(fs.readFileSync(path.join(LICENSES_DIR, f), "utf8"));
    }
    res.json(out);
  } catch (err) {
    console.error("❌ /admin/licenses error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Root
app.get("/", (req, res) =>
  res.send({
    success: true,
    message: "Mila License Server running",
    repo: maskedRepoDisplay(GITHUB_REPO || "(none)"),
    ssh_key: !!GIT_SSH_KEY,
    token: !!GITHUB_TOKEN,
  })
);

// ================= Periodic sync =================
cron.schedule(`0 */${Math.max(1, PULL_INTERVAL_HOURS)} * * *`, async () => {
  console.log("⏰ Scheduled sync starting...");
  try {
    if (GITHUB_REPO) {
      await pullLatest();
      decryptAllFiles();
    }
    // Always attempt Dropbox restore/download after git pull
    try { await downloadLicensesFromDropbox(); } catch (e) { console.warn("⚠️ Dropbox scheduled download skipped:", e && e.message ? e.message : e); }
    console.log("✅ Scheduled sync complete.");
  } catch (err) {
    console.error("❌ Scheduled sync failed:", err && err.message ? err.message : err);
  }
});

// ================= Startup =================
(async function startup() {
  // global safety handlers so Render logs anything unexpected
  process.on("unhandledRejection", (r) => console.error("🔴 unhandledRejection:", r));
  process.on("uncaughtException", (err) => console.error("🔴 uncaughtException:", err && err.stack ? err.stack : err));

  try {
    console.log("⬇️ Attempting Dropbox restore...");
    try {
      await downloadLicensesFromDropbox();
      console.log("✅ Dropbox restore finished (startup).");
    } catch (err) {
      console.warn("⚠️ Dropbox restore skipped or failed:", err && err.message ? err.message : err);
    }

    if (GITHUB_REPO) {
      try {
        await pullLatest();
        decryptAllFiles();
        console.log("✅ Initial GitHub sync complete.");
      } catch (err) {
        console.warn("⚠️ Initial GitHub sync failed:", err && err.message ? err.message : err);
      }
    } else {
      console.warn("⚠️ GITHUB_REPO not set — GitHub sync disabled.");
    }

    console.log("✅ Startup complete.");
  } catch (err) {
    console.error("❌ Startup error:", err && err.message ? err.message : err);
  } finally {
    app.listen(PORT, () => {
      console.log(`🚀 Mila License Server running on port ${PORT}`);
      console.log(`🗄 Repo: ${maskedRepoDisplay(GITHUB_REPO || "(none)")}`);
    });
  }
})();
