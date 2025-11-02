// =============================================
// MILA AFRIKA LICENSE SERVER (Encrypted GitHub Sync + Auth + Retry)
// =============================================
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import simpleGit from 'simple-git';
import cron from 'node-cron';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

// =============================================
// 🔧 Configuration
// =============================================
const git = simpleGit();
const LICENSES_DIR = './licenses';
if (!fs.existsSync(LICENSES_DIR)) fs.mkdirSync(LICENSES_DIR);

const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const PASSPHRASE = process.env.ENCRYPTION_KEY || 'thayu!';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(PASSPHRASE).digest(); // 32-byte AES key
const PULL_INTERVAL_HOURS = parseInt(process.env.PULL_INTERVAL_HOURS || '24');
const PORT = process.env.PORT || 10000;

console.log("🗄 GitHub repo:", GITHUB_REPO);

// =============================================
// 🔐 Encryption Helpers
// =============================================
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(encText) {
  try {
    const [ivStr, encrypted] = encText.split(':');
    const iv = Buffer.from(ivStr, 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.warn('⚠️ Decryption failed:', err.message);
    return null;
  }
}

// =============================================
// 🪣 GitHub Sync Helpers
// =============================================
async function ensureGitRepo() {
  if (!fs.existsSync('.git')) {
    console.log('📦 Cloning license repo from GitHub (authenticated)...');
    await git.clone(GITHUB_REPO, '.');
  } else {
    console.log('🔁 Git repo found — skipping clone.');
  }
}

async function syncFromGitHub() {
  try {
    await ensureGitRepo();
    console.log('⬇️ Pulling latest licenses from GitHub...');
    await git.pull('origin', 'main');

    // Decrypt all product license files
    const files = fs.readdirSync(LICENSES_DIR);
    for (const f of files) {
      const p = path.join(LICENSES_DIR, f);
      const encryptedData = fs.readFileSync(p, 'utf8');
      const decrypted = decrypt(encryptedData);
      if (decrypted) fs.writeFileSync(p, decrypted);
    }

    console.log('✅ Sync complete.');
  } catch (err) {
    console.error('❌ GitHub sync failed:', err.message);
  }
}

async function pushToGitHub(retries = 3, delay = 2000) {
  try {
    console.log('🔒 Encrypting and pushing license data...');

    const files = fs.readdirSync(LICENSES_DIR);
    for (const f of files) {
      const p = path.join(LICENSES_DIR, f);
      const plain = fs.readFileSync(p, 'utf8');
      const encrypted = encrypt(plain);
      fs.writeFileSync(p, encrypted);
    }

    await git.add('./*');
    await git.commit(`🔐 License update @ ${new Date().toISOString()}`);
    await git.push('origin', 'main');

    console.log('✅ Licenses pushed successfully.');

    // Re-decrypt after push for runtime use
    for (const f of files) {
      const p = path.join(LICENSES_DIR, f);
      const enc = fs.readFileSync(p, 'utf8');
      const dec = decrypt(enc);
      fs.writeFileSync(p, dec);
    }
  } catch (err) {
    if (retries > 0) {
      console.warn(`⚠️ Push failed (${err.message}). Retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
      return pushToGitHub(retries - 1, delay * 2); // exponential backoff
    } else {
      console.error('❌ GitHub push failed permanently:', err.message);
    }
  }
}

// =============================================
// 💾 License Management
// =============================================
function getLicenseFile(product) {
  return path.join(LICENSES_DIR, `${product}.json`);
}

function loadLicenses(product) {
  const file = getLicenseFile(product);
  if (!fs.existsSync(file)) return [];
  try {
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveLicenses(product, licenses) {
  const file = getLicenseFile(product);
  fs.writeFileSync(file, JSON.stringify(licenses, null, 2));
}

// =============================================
// 🧭 API ROUTES
// =============================================

// ✅ Verify license
app.post('/verify', (req, res) => {
  const { license_key, product } = req.body;
  if (!license_key || !product)
    return res.status(400).json({ success: false, message: 'Missing license_key or product' });

  const licenses = loadLicenses(product);
  const found = licenses.find(l => l.license_key === license_key);

  if (found) res.json({ success: true, ...found });
  else res.status(404).json({ success: false, message: 'Invalid license key' });
});

// ✅ Payhip webhook (store license and sync)
app.post('/webhook/payhip', async (req, res) => {
  try {
    const { license_key, buyer_email, product_name } = req.body;
    if (!license_key || !product_name)
      return res.status(400).json({ success: false, message: 'Invalid webhook data' });

    const product = product_name.toLowerCase().replace(/\s+/g, '_');
    const licenses = loadLicenses(product);

    licenses.push({
      license_key,
      buyer_email,
      activated: false,
      issued_at: new Date().toISOString(),
    });

    saveLicenses(product, licenses);
    await pushToGitHub();

    res.json({ success: true, message: 'License saved and synced.' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: 'Server error saving license.' });
  }
});

// =============================================
// ⏰ Scheduled Daily Sync (default every 24h)
// =============================================
cron.schedule(`0 */${PULL_INTERVAL_HOURS} * * *`, async () => {
  console.log('⏰ Daily license sync starting...');
  await syncFromGitHub();
});

// =============================================
// 🚀 Startup
// =============================================
syncFromGitHub().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Mila License Server running on port ${PORT}`);
    console.log(`🔑 Using encryption key: ${PASSPHRASE}`);
    console.log(`🗄 Repo: ${GITHUB_REPO.replace(GITHUB_TOKEN, '***TOKEN***')}`);
  });
});
