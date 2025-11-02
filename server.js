// =============================================
// MILA AFRIKA LICENSE SERVER (Encrypted GitHub Sync + Auth + Retry)
// - isolates the license Git repo to ./_licenses_repo
// - reads token from GITHUB_TOKEN (supports fine-grained or classic PAT)
// - encrypts/decrypts license files stored in ./licenses
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
// Configuration
// =============================================
const ROOT = process.cwd();
const REPO_DIR = path.join(ROOT, '_licenses_repo'); // isolated clone location
const LICENSES_DIR = path.join(ROOT, 'licenses');   // runtime folder used by server
const git = simpleGit(); // generic (used only for non-repo work if needed)

if (!fs.existsSync(LICENSES_DIR)) fs.mkdirSync(LICENSES_DIR, { recursive: true });

const GITHUB_REPO = process.env.GITHUB_REPO || 'https://github.com/wahinya-music/licenses-db.git';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const PASSPHRASE = process.env.ENCRYPTION_KEY || 'thayu!';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(PASSPHRASE).digest(); // 32-byte AES key
const PULL_INTERVAL_HOURS = parseInt(process.env.PULL_INTERVAL_HOURS || '24', 10);
const PORT = process.env.PORT || 10000;

// Build authenticated URL safely (token is URL-encoded)
function buildAuthUrl(repoUrl, token) {
  if (!token) return repoUrl;
  // If token is already embedded in repoUrl, keep as-is
  if (repoUrl.includes('@') && repoUrl.includes('://')) {
    return repoUrl;
  }
  const enc = encodeURIComponent(token);
  // Recommended form for HTTPS with PAT: https://x-access-token:TOKEN@github.com/owner/repo.git
  if (repoUrl.startsWith('https://')) {
    return repoUrl.replace('https://', `https://x-access-token:${enc}@`);
  }
  return repoUrl;
}

const AUTH_URL = buildAuthUrl(GITHUB_REPO, GITHUB_TOKEN);
const repoGit = simpleGit({ baseDir: REPO_DIR });

// =============================================
// Encryption helpers
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
// Git repo helpers (operate in REPO_DIR)
 // =============================================
async function ensureRepoCloned() {
  if (!fs.existsSync(REPO_DIR) || !fs.existsSync(path.join(REPO_DIR, '.git'))) {
    console.log('📦 Cloning license repo into', REPO_DIR);
    // ensure parent exists
    fs.mkdirSync(REPO_DIR, { recursive: true });
    await git.clone(AUTH_URL, REPO_DIR);
    // after clone, ensure origin remote is set to AUTH_URL so future pulls/pushes use the token
    await repoGit.addRemote('origin', AUTH_URL).catch(() => repoGit.remote(['set-url', 'origin', AUTH_URL]));
    return;
  }
  // repo exists — make sure remote has auth URL so pushes work
  try {
    const remotes = await repoGit.getRemotes(true);
    const origin = remotes.find(r => r.name === 'origin');
    if (!origin || !origin.refs.fetch.includes('://')) {
      // set remote URL with AUTH_URL
      await repoGit.remote(['set-url', 'origin', AUTH_URL]);
    } else {
      // ensure remote URL contains token; if not, update
      if (GITHUB_TOKEN && !origin.refs.fetch.includes(encodeURIComponent(GITHUB_TOKEN))) {
        await repoGit.remote(['set-url', 'origin', AUTH_URL]);
      }
    }
  } catch (err) {
    console.warn('Could not inspect remotes:', err.message);
  }
}

async function pullRepo() {
  await ensureRepoCloned();
  console.log('⬇️ Pulling latest licenses from GitHub (repo dir:', REPO_DIR + ')');
  await repoGit.fetch('origin').catch(e => { throw e; });
  // ensure we have main branch
  await repoGit.pull('origin', 'main').catch(async (err) => {
    // try to create local main if missing
    console.warn('Warning: pull failed — attempting to fetch and reset main:', err.message);
    await repoGit.fetch('origin', 'main').catch(() => {});
    // attempt to checkout origin/main
    try {
      await repoGit.raw(['checkout', '-B', 'main', 'origin/main']);
    } catch (e) {
      console.warn('Could not reset to origin/main:', e.message);
    }
  });
  // copy/decrypt JSON license files from repo into LICENSES_DIR
  const files = fs.readdirSync(REPO_DIR);
  for (const f of files) {
    if (f.endsWith('.json')) {
      const p = path.join(REPO_DIR, f);
      try {
        const enc = fs.readFileSync(p, 'utf8');
        // try decrypt; if not decryptable assume it's plain JSON and just write
        const dec = decrypt(enc);
        const out = dec !== null ? dec : enc;
        fs.writeFileSync(path.join(LICENSES_DIR, f), out, 'utf8');
      } catch (err) {
        console.warn('Failed to copy license file', f, err.message);
      }
    }
  }
  console.log('✅ Sync complete — license files available at', LICENSES_DIR);
}

async function pushRepo(retries = 3, delay = 2000) {
  try {
    await ensureRepoCloned();
    console.log('🔒 Preparing to push licenses to GitHub from', REPO_DIR);
    // copy & encrypt runtime license files into repo dir
    const runtimeFiles = fs.existsSync(LICENSES_DIR) ? fs.readdirSync(LICENSES_DIR) : [];
    for (const f of runtimeFiles) {
      if (!f.endsWith('.json')) continue;
      const src = path.join(LICENSES_DIR, f);
      const dest = path.join(REPO_DIR, f);
      const plain = fs.readFileSync(src, 'utf8');
      const encrypted = encrypt(plain);
      fs.writeFileSync(dest, encrypted, 'utf8');
    }
    // commit & push from REPO_DIR
    await repoGit.add('./*');
    const status = await repoGit.status();
    if (status.modified.length === 0 && status.not_added.length === 0 && status.created.length === 0) {
      console.log('No changes to push.');
      return;
    }
    await repoGit.commit(`🔐 License update @ ${new Date().toISOString()}`);
    // ensure origin uses AUTH_URL so push authenticates
    await repoGit.remote(['set-url', 'origin', AUTH_URL]).catch(() => {});
    await repoGit.push('origin', 'main');
    console.log('✅ Licenses pushed successfully to GitHub.');
    // re-decrypt back into runtime folder (keep runtime files unchanged; they were source)
  } catch (err) {
    if (retries > 0) {
      console.warn(`⚠️ Push failed (${err.message}). Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      return pushRepo(retries - 1, delay * 2);
    } else {
      console.error('❌ GitHub push failed permanently:', err.message);
    }
  }
}

// =============================================
// API routes and license logic
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

// Verify license endpoint
app.post('/verify', (req, res) => {
  const { license_key, product } = req.body;
  if (!license_key || !product) {
    return res.status(400).json({ success: false, message: 'Missing license_key or product' });
  }
  const licenses = loadLicenses(product);
  const found = licenses.find(l => l.license_key === license_key);
  if (found) res.json({ success: true, ...found });
  else res.status(404).json({ success: false, message: 'Invalid license key' });
});

// Payhip webhook — store license and sync (save locally then push encrypted to GitHub)
app.post('/webhook/payhip', async (req, res) => {
  try {
    const { license_key, buyer_email, product_name } = req.body;
    if (!license_key || !product_name) {
      return res.status(400).json({ success: false, message: 'Invalid webhook data' });
    }
    const product = product_name.toLowerCase().replace(/\s+/g, '_');
    const licenses = loadLicenses(product);
    licenses.push({
      license_key,
      buyer_email,
      activated: false,
      issued_at: new Date().toISOString(),
    });
    saveLicenses(product, licenses);
    // push to GitHub (encrypted)
    await pushRepo();
    res.json({ success: true, message: 'License saved and synced.' });
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).json({ success: false, message: 'Server error saving license.' });
  }
});

// =============================================
// Cron: scheduled repo pull
// =============================================
cron.schedule(`0 */${PULL_INTERVAL_HOURS} * * *`, async () => {
  console.log('⏰ Daily license sync starting...');
  await syncFromGitHub().catch(err => console.error('Scheduled sync error:', err.message));
});

// lightweight wrapper to call pull and surface errors
async function syncFromGitHub() {
  try {
    await pullRepo();
  } catch (err) {
    console.error('❌ GitHub sync failed:', err.message || err);
    throw err;
  }
}

// =============================================
// Startup
// =============================================
syncFromGitHub().then(() => {
  app.listen(PORT, () => {
    // hide full token from logs
    const tokenMasked = GITHUB_TOKEN ? '***TOKEN***' : '(none)';
    console.log(`✅ Mila License Server running on port ${PORT}`);
    console.log(`🔑 Using encryption key: ${PASSPHRASE}`);
    console.log(`🗄 Repo: ${GITHUB_REPO}`);
    console.log(`🔐 Auth token present: ${Boolean(GITHUB_TOKEN)} (${tokenMasked})`);
    console.log(`📁 Repo workspace: ${REPO_DIR}`);
    console.log(`📁 Runtime licenses: ${LICENSES_DIR}`);
  });
}).catch(err => {
  console.error('Startup sync failed:', err && err.message ? err.message : err);
  // still start server so webhooks and verify endpoints may work (and we can try manual sync)
  app.listen(PORT, () => {
    console.log(`✅ Mila License Server running on port ${PORT} (with sync errors)`);
  });
});
