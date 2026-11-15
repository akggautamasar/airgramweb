const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');
const APP_SECRET = process.env.APP_SECRET || 'airgram_default_dev_secret_change_me';

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getEncKey() {
  return crypto.createHash('sha256').update(APP_SECRET).digest();
}

function encryptString(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function decryptString(payload) {
  const [ivB64, tagB64, encB64] = String(payload || '').split('.');
  if (!ivB64 || !tagB64 || !encB64) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncKey(), Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64url')), decipher.final()]).toString('utf8');
}

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pwd), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pwd, stored) {
  if (!stored) return true;
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pwd || ''), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

class ShareStore {
  constructor() {
    ensureDir();
    this.shares = this.load();
  }

  load() {
    try {
      if (fs.existsSync(SHARES_FILE)) {
        return JSON.parse(fs.readFileSync(SHARES_FILE, 'utf8'));
      }
    } catch {}
    return {};
  }

  save() {
    ensureDir();
    fs.writeFileSync(SHARES_FILE, JSON.stringify(this.shares, null, 2));
  }

  createShare({ chatId, msgId, meta, sessionString, password, expiresInHours }) {
    const id = crypto.randomBytes(6).toString('base64url');
    const hrs = Number(expiresInHours || 0);
    const expiresAt = hrs > 0 ? Date.now() + hrs * 3600 * 1000 : null; // null = Lifetime

    this.shares[id] = {
      id,
      chatId: String(chatId),
      msgId: Number(msgId),
      meta: {
        id: meta.id,
        chatId: String(chatId),
        kind: meta.kind,
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        size: meta.size,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        title: meta.title,
        performer: meta.performer,
        date: meta.date,
        caption: meta.caption,
        hasThumb: meta.hasThumb,
        miniThumb: meta.miniThumb,
        streamable: meta.streamable,
      },
      passwordHash: password && String(password).trim() ? hashPassword(String(password).trim()) : null,
      encryptedSession: encryptString(sessionString),
      createdAt: Date.now(),
      expiresAt,
    };
    this.save();
    return this.getPublicInfo(id);
  }

  getRaw(id) {
    const entry = this.shares[id];
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      delete this.shares[id];
      this.save();
      return null;
    }
    return entry;
  }

  getSessionString(id) {
    const entry = this.getRaw(id);
    if (!entry) return null;
    return decryptString(entry.encryptedSession);
  }

  checkPassword(id, password) {
    const entry = this.getRaw(id);
    if (!entry) return false;
    return verifyPassword(password, entry.passwordHash);
  }

  getPublicInfo(id) {
    const entry = this.getRaw(id);
    if (!entry) return null;
    return {
      id: entry.id,
      requiresPassword: Boolean(entry.passwordHash),
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
      meta: entry.meta,
    };
  }
}

module.exports = { ShareStore };
