const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_FILE = path.join(DATA_DIR, 'backups.json');

const CATEGORIES = [
  'photos',
  'videos',
  'pdfs',
  'documents',
  'audio',
  'call_recordings',
  'other',
];

const DEFAULT_CAPTION_TEMPLATE = '{name} | {category} | {size} | {date}';

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function categorizeFile(fileName = '', mimeType = '', relPath = '') {
  const name = String(fileName).toLowerCase();
  const mime = String(mimeType).toLowerCase();
  const p = String(relPath).toLowerCase();

  if (
    p.includes('call') ||
    p.includes('recording') ||
    name.includes('call_rec') ||
    name.includes('call recording')
  ) {
    if (mime.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|amr|aac|opus|3gp)$/i.test(name)) {
      return 'call_recordings';
    }
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdfs';
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp|svg)$/i.test(name)) return 'photos';
  if (mime.startsWith('video/') || /\.(mp4|mkv|webm|mov|avi|flv|3gp|m4v)$/i.test(name)) return 'videos';
  if (mime.startsWith('audio/') || /\.(mp3|m4a|flac|wav|ogg|aac|opus|wma)$/i.test(name)) return 'audio';
  if (
    /\.(epub|docx?|xlsx?|pptx?|txt|csv|md|rtf|odt|ods|odp)$/i.test(name) ||
    mime.includes('epub') ||
    mime.includes('word') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime.startsWith('text/')
  ) {
    return 'documents';
  }
  return 'other';
}

function formatCaption(template, { name, category, size, date, ext }) {
  const tpl = template || DEFAULT_CAPTION_TEMPLATE;
  return tpl
    .replace(/\{name\}/g, name || '')
    .replace(/\{category\}/g, category || '')
    .replace(/\{size\}/g, size || '')
    .replace(/\{date\}/g, date || '')
    .replace(/\{ext\}/g, ext || '');
}

class BackupStore {
  constructor() {
    ensureDir();
    this.db = this.load();
  }

  load() {
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        return JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
      }
    } catch {}
    return {};
  }

  save() {
    ensureDir();
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(this.db, null, 2));
  }

  getUserBucket(userId) {
    const uid = String(userId || 'default');
    if (!this.db[uid]) {
      this.db[uid] = {
        channels: {
          photos: '',
          videos: '',
          pdfs: '',
          documents: '',
          audio: '',
          call_recordings: '',
          other: '',
        },
        captionTemplate: DEFAULT_CAPTION_TEMPLATE,
        lastSyncedMsgId: {}, // { [chatId]: maxMsgId }
        indexMsgId: null, // message ID of airgram-drive-index.json in Saved Messages
        records: [],
      };
    }
    if (!this.db[uid].lastSyncedMsgId) this.db[uid].lastSyncedMsgId = {};
    return this.db[uid];
  }

  getConfig(userId) {
    const b = this.getUserBucket(userId);
    return {
      channels: b.channels,
      captionTemplate: b.captionTemplate || DEFAULT_CAPTION_TEMPLATE,
      indexedCount: b.records.length,
      lastSyncedMsgId: b.lastSyncedMsgId || {},
      indexMsgId: b.indexMsgId || null,
    };
  }

  setConfig(userId, { channels, captionTemplate }) {
    const b = this.getUserBucket(userId);
    if (channels && typeof channels === 'object') {
      for (const cat of CATEGORIES) {
        if (cat in channels) {
          b.channels[cat] = String(channels[cat] || '').trim();
        }
      }
    }
    if (typeof captionTemplate === 'string') {
      b.captionTemplate = captionTemplate.trim() || DEFAULT_CAPTION_TEMPLATE;
    }
    this.save();
    return this.getConfig(userId);
  }

  getChannelCategoryMap(userId) {
    const b = this.getUserBucket(userId);
    const map = {};
    for (const cat of CATEGORIES) {
      const cid = b.channels[cat];
      if (cid) map[String(cid)] = cat;
    }
    return map;
  }

  getLastSyncedId(userId, chatId) {
    const b = this.getUserBucket(userId);
    return Number(b.lastSyncedMsgId?.[String(chatId)] || 0);
  }

  setLastSyncedId(userId, chatId, msgId) {
    const b = this.getUserBucket(userId);
    const prev = Number(b.lastSyncedMsgId?.[String(chatId)] || 0);
    if (Number(msgId) > prev) {
      b.lastSyncedMsgId[String(chatId)] = Number(msgId);
      this.save();
    }
  }

  setIndexMsgId(userId, msgId) {
    const b = this.getUserBucket(userId);
    b.indexMsgId = Number(msgId);
    this.save();
  }

  addRecord(userId, rec) {
    const b = this.getUserBucket(userId);
    const exists = b.records.some(
      (r) => String(r.chatId) === String(rec.chatId) && Number(r.msgId) === Number(rec.msgId)
    );
    let added = false;
    if (!exists) {
      b.records.unshift({
        sha256: rec.sha256 || '',
        fileName: rec.fileName || '',
        size: Number(rec.size || 0),
        category: rec.category || categorizeFile(rec.fileName, rec.mimeType),
        chatId: String(rec.chatId),
        msgId: Number(rec.msgId),
        date: Number(rec.date || Math.floor(Date.now() / 1000)),
        mimeType: rec.mimeType || 'application/octet-stream',
        duration: Number(rec.duration || 0),
        hasThumb: Boolean(rec.hasThumb),
        miniThumb: rec.miniThumb || null,
      });
      added = true;
    } else if (rec.sha256) {
      const target = b.records.find(
        (r) => String(r.chatId) === String(rec.chatId) && Number(r.msgId) === Number(rec.msgId)
      );
      if (target && !target.sha256) {
        target.sha256 = rec.sha256;
      }
    }

    const prevMax = Number(b.lastSyncedMsgId?.[String(rec.chatId)] || 0);
    if (Number(rec.msgId) > prevMax) {
      b.lastSyncedMsgId[String(rec.chatId)] = Number(rec.msgId);
    }
    this.save();
    return added;
  }

  // Export compact JSON (without bulky miniThumb strings) for Saved Messages storage
  exportState(userId) {
    const b = this.getUserBucket(userId);
    return {
      version: 1,
      updatedAt: Date.now(),
      channels: b.channels,
      captionTemplate: b.captionTemplate,
      lastSyncedMsgId: b.lastSyncedMsgId || {},
      records: b.records.map(({ miniThumb, ...rest }) => rest),
    };
  }

  importState(userId, remote, indexMsgId = null) {
    if (!remote || typeof remote !== 'object') return false;
    const b = this.getUserBucket(userId);
    if (remote.channels) {
      for (const cat of CATEGORIES) {
        if (!b.channels[cat] && remote.channels[cat]) {
          b.channels[cat] = String(remote.channels[cat]).trim();
        }
      }
    }
    if (remote.captionTemplate && !b.captionTemplate) {
      b.captionTemplate = remote.captionTemplate;
    }
    if (remote.lastSyncedMsgId) {
      for (const [cid, mid] of Object.entries(remote.lastSyncedMsgId)) {
        const cur = Number(b.lastSyncedMsgId[cid] || 0);
        if (Number(mid) > cur) b.lastSyncedMsgId[cid] = Number(mid);
      }
    }
    const existingKeys = new Set(b.records.map((r) => `${r.chatId}_${r.msgId}`));
    for (const r of remote.records || []) {
      const key = `${r.chatId}_${r.msgId}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        b.records.push(r);
      }
    }
    if (indexMsgId) b.indexMsgId = Number(indexMsgId);
    this.save();
    return true;
  }

  checkDuplicates(userId, files = []) {
    const b = this.getUserBucket(userId);
    const hashSet = new Set(b.records.map((r) => r.sha256).filter(Boolean));
    const nameSizeSet = new Set(
      b.records.map((r) => `${String(r.fileName).toLowerCase()}::${Number(r.size || 0)}`)
    );

    return files.map((f) => {
      const byHash = Boolean(f.sha256 && hashSet.has(f.sha256));
      const byNameSize = nameSizeSet.has(`${String(f.name || '').toLowerCase()}::${Number(f.size || 0)}`);
      return {
        name: f.name,
        size: f.size,
        sha256: f.sha256,
        alreadyUploaded: byHash || byNameSize,
      };
    });
  }

  getDriveView(userId) {
    const b = this.getUserBucket(userId);
    const stats = {};
    for (const cat of CATEGORIES) {
      stats[cat] = { count: 0, size: 0 };
    }

    const versionMap = new Map();
    for (const r of b.records) {
      const cat = CATEGORIES.includes(r.category) ? r.category : 'other';
      stats[cat].count += 1;
      stats[cat].size += Number(r.size || 0);

      const key = String(r.fileName || '').toLowerCase();
      if (key) {
        if (!versionMap.has(key)) versionMap.set(key, []);
        versionMap.get(key).push(r);
      }
    }

    const items = b.records.map((r) => {
      const versions = versionMap.get(String(r.fileName || '').toLowerCase()) || [r];
      return {
        ...r,
        id: r.msgId,
        title: r.fileName,
        kind:
          r.category === 'photos'
            ? 'photo'
            : r.category === 'videos'
            ? 'video'
            : r.category === 'audio' || r.category === 'call_recordings'
            ? 'audio'
            : 'document',
        streamable: r.category === 'videos' || r.category === 'audio' || r.category === 'call_recordings',
        versionCount: versions.length,
        versions: versions.length > 1 ? versions : undefined,
      };
    });

    return { stats, items, totalCount: items.length };
  }

  exportCsv(userId) {
    const b = this.getUserBucket(userId);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['File Name', 'Category', 'Size (Bytes)', 'Date', 'Chat ID', 'Message ID', 'SHA-256'].join(',');
    const rows = b.records.map((r) =>
      [
        esc(r.fileName),
        esc(r.category),
        r.size,
        esc(r.date ? new Date(r.date * 1000).toISOString() : ''),
        esc(r.chatId),
        r.msgId,
        esc(r.sha256 || ''),
      ].join(',')
    );
    return [header, ...rows].join('\n');
  }
}

module.exports = {
  BackupStore,
  CATEGORIES,
  DEFAULT_CAPTION_TEMPLATE,
  categorizeFile,
  formatCaption,
};
