require('dotenv').config();
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const multer = require('multer');
const upload = multer({ dest: path.join(os.tmpdir(), 'airgram_uploads'), limits: { fileSize: 500 * 1024 * 1024 } });
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { TelegramManager, signToken, verifyToken } = require('./telegramManager');
const { StreamEngine } = require('./streamEngine');
const archiver = require('archiver');
const { ShareStore } = require('./shareStore');
const { BackupStore, CATEGORIES, categorizeFile, formatCaption } = require('./backupStore');
const { STREAMING_MODES } = require('./streamingPolicy');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const tg = new TelegramManager();
const streamEngine = new StreamEngine(process.env.STREAM_CACHE_MAX_MB || 256);
const shareStore = new ShareStore();
const backupStore = new BackupStore();

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// Compress JSON/text responses, but NEVER buffer/compress binary media streams
app.use(
  compression({
    filter: (req, res) => {
      if (req.path.startsWith('/api/stream/')) return false;
      return compression.filter(req, res);
    },
  })
);

function setAuthCookie(res, token) {
  res.cookie('airgram_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

async function requireAuth(req, res, next) {
  try {
    const session = await tg.getSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    req.tgSession = session;
    next();
  } catch (err) {
    res.status(401).json({ error: err.message || 'Authentication failed' });
  }
}

// --- Health & Diagnostics ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'AirGram Web', time: new Date().toISOString() });
});

// --- Auth: 1. QR Scan ---
app.post('/api/auth/qr/start', async (req, res) => {
  try {
    const result = await tg.startQrLogin();
    res.json(result);
  } catch (err) {
    console.error('[AirGram Chat Timeline Error]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/qr/status/:loginId', (req, res) => {
  const result = tg.getQrStatus(req.params.loginId);
  if (result.status === 'authenticated' && result.auth) {
    setAuthCookie(res, result.auth.token);
  }
  res.json(result);
});

app.post('/api/auth/qr/2fa', (req, res) => {
  try {
    const { loginId, password } = req.body;
    res.json(tg.submitQr2fa(loginId, password));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Auth: 2. Phone + OTP + 2FA ---
app.post('/api/auth/phone/start', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'Phone number is required' });
    const result = await tg.startPhoneLogin(phoneNumber);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/phone/verify-code', async (req, res) => {
  try {
    const { loginId, code } = req.body;
    const result = await tg.verifyPhoneCode(loginId, code);
    if (result.status === 'authenticated' && result.auth) {
      setAuthCookie(res, result.auth.token);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/phone/verify-2fa', async (req, res) => {
  try {
    const { loginId, password } = req.body;
    const result = await tg.verifyPhone2fa(loginId, password);
    if (result.status === 'authenticated' && result.auth) {
      setAuthCookie(res, result.auth.token);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Auth: 3. Session String (Paste Key) ---
app.post('/api/auth/session', async (req, res) => {
  try {
    const { sessionString } = req.body;
    const auth = await tg.loginWithSessionString(sessionString);
    setAuthCookie(res, auth.token);
    res.json({ status: 'authenticated', auth });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    user: req.tgSession.user,
    sessionString: req.tgSession.sessionString,
  });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await tg.logout(req.tgSession.authId);
  res.clearCookie('airgram_token');
  res.json({ ok: true });
});

// --- Chats & Media Browser ---
app.get('/api/chats', requireAuth, async (req, res) => {
  try {
    const data = await tg.getDialogs(req.tgSession, { limit: req.query.limit || 150 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', requireAuth, async (req, res) => {
  try {
    const { q = '', tab = 'all', limit = 40 } = req.query;
    const data = await tg.searchGlobalMedia(req.tgSession, { query: q, tab, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chats/:chatId/media', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { tab = 'video', offsetId = 0, limit = 40, q = '' } = req.query;
    const result = await tg.getMediaMessages(req.tgSession, {
      chatId,
      tab,
      offsetId,
      limit,
      query: q,
    });
    res.json(result);
  } catch (err) {
    console.error('[AirGram Chat Timeline Error]', err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/chats/:chatId/messages', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { offsetId = 0, limit = 40, q = '' } = req.query;
    const result = await tg.getChatTimeline(req.tgSession, {
      chatId,
      offsetId,
      limit,
      query: q,
    });
    res.json(result);
  } catch (err) {
    console.error('[AirGram Chat Timeline Error]', err);
    res.status(500).json({ error: err.message });
  }
});


app.post('/api/chats/:chatId/upload', requireAuth, upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: 'No file provided' });
  try {
    const { chatId } = req.params;
    const { caption = '', replyToMsgId = '' } = req.body;
    const msg = await tg.sendChatFile(req.tgSession, {
      chatId,
      filePath: uploaded.path,
      originalName: uploaded.originalname,
      mimeType: uploaded.mimetype,
      caption,
      replyToMsgId: replyToMsgId || null,
    });
    res.json({ message: msg });
  } catch (err) {
    console.error('[AirGram Upload Error]', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  } finally {
    fs.unlink(uploaded.path, () => {});
  }
});

app.post('/api/chats/:chatId/messages', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { text, replyToMsgId } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const msg = await tg.sendChatMessage(req.tgSession, {
      chatId,
      text: String(text).trim(),
      replyToMsgId,
    });
    res.json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/thumb/:chatId/:msgId', requireAuth, async (req, res) => {
  try {
    const { chatId, msgId } = req.params;
    const full = req.query.full === '1';
    const buf = await tg.downloadThumbnail(req.tgSession, chatId, msgId, full);
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch {
    res.status(404).end();
  }
});

// --- External VLC Signed Stream Token + M3U Playlist ---
app.get('/api/stream-link/:chatId/:msgId', requireAuth, async (req, res) => {
  const { chatId, msgId } = req.params;
  const mode = req.query.mode || STREAMING_MODES.TELEGRAM_HQ;
  const entry = await tg.getMessageAndMeta(req.tgSession, chatId, msgId);
  if (!entry) return res.status(404).json({ error: 'Media not found' });

  const streamToken = signToken({
    authId: req.tgSession.authId,
    chatId,
    msgId,
    exp: Date.now() + 12 * 60 * 60 * 1000, // 12h link for VLC
  });

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const directUrl = `${proto}://${host}/api/stream/${chatId}/${msgId}?mode=${encodeURIComponent(mode)}&st=${encodeURIComponent(streamToken)}`;

  res.json({
    directUrl,
    vlcDeepLink: `vlc://${directUrl}`,
    fileName: entry.meta.fileName,
  });
});

app.get('/api/playlist/:chatId/:msgId.m3u', requireAuth, async (req, res) => {
  const { chatId, msgId } = req.params;
  const entry = await tg.getMessageAndMeta(req.tgSession, chatId, msgId);
  if (!entry) return res.status(404).end();

  const streamToken = signToken({
    authId: req.tgSession.authId,
    chatId,
    msgId,
    exp: Date.now() + 12 * 60 * 60 * 1000,
  });
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const directUrl = `${proto}://${host}/api/stream/${chatId}/${msgId}?mode=telegram_hq&st=${encodeURIComponent(streamToken)}`;

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  const asciiM3u = (entry.meta.fileName || 'stream').replace(/[^\x20-\x7E]/g, '_').replace(/["\\;\r\n]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiM3u}.m3u"`);
  res.send(`#EXTM3U\n#EXTINF:-1,${entry.meta.title || entry.meta.fileName}\n${directUrl}\n`);
});

// --- High-Speed HTTP 206 Range Streaming ---
async function resolveStreamAuth(req) {
  if (req.query.st) {
    const decoded = verifyToken(req.query.st);
    if (decoded && decoded.authId) {
      const entry = tg.activeClients.get(decoded.authId);
      if (entry) return { ...entry, authId: decoded.authId };
    }
  }
  return await tg.getSession(req);
}

app.all('/api/stream/:chatId/:msgId', async (req, res) => {
  try {
    const session = await resolveStreamAuth(req);
    if (!session) return res.status(401).json({ error: 'Stream unauthorized' });

    const { chatId, msgId } = req.params;
    const mode = req.query.mode === STREAMING_MODES.TELEGRAM_HQ
      ? STREAMING_MODES.TELEGRAM_HQ
      : STREAMING_MODES.FAST_WEB;
    const download = req.query.download === '1';

    const entry = await tg.getMessageAndMeta(session, chatId, msgId);
    if (!entry) return res.status(404).json({ error: 'Media not found' });

    await streamEngine.handleStreamRequest({
      req,
      res,
      client: session.client,
      message: entry.message,
      meta: entry.meta,
      mode,
      download,
    });
  } catch (err) {
    console.error('[AirGram Stream Error]', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Streaming error' });
    }
  }
});


// --- Public Share Links (Optional Password & Expiry / Lifetime) ---

app.get('/api/shares', requireAuth, (req, res) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const list = shareStore.listByOwner(req.tgSession.user?.id).map((s) => ({
    ...s,
    shareUrl: `${proto}://${host}/s/${s.id}`,
  }));
  res.json({ shares: list });
});

app.delete('/api/shares/:id', requireAuth, (req, res) => {
  const ok = shareStore.revoke(req.params.id, req.tgSession.user?.id);
  if (!ok) return res.status(404).json({ error: 'Share link not found' });
  res.json({ ok: true });
});

app.post('/api/share', requireAuth, async (req, res) => {
  try {
    const { chatId, msgId, password = '', expiresInHours = 0 } = req.body;
    if (!chatId || !msgId) return res.status(400).json({ error: 'chatId and msgId are required' });

    const entry = await tg.getMessageAndMeta(req.tgSession, chatId, msgId);
    if (!entry) return res.status(404).json({ error: 'File not found' });

    const share = shareStore.createShare({
      ownerId: req.tgSession.user?.id,
      chatId,
      msgId,
      meta: entry.meta,
      sessionString: req.tgSession.sessionString,
      password,
      expiresInHours,
    });

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    res.json({
      ...share,
      shareUrl: `${proto}://${host}/s/${share.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/share/:id', (req, res) => {
  const info = shareStore.getPublicInfo(req.params.id);
  if (!info) return res.status(404).json({ error: 'Share link not found or has expired' });
  res.json(info);
});

app.post('/api/share/:id/unlock', (req, res) => {
  const info = shareStore.getPublicInfo(req.params.id);
  if (!info) return res.status(404).json({ error: 'Share link not found or has expired' });

  const { password = '' } = req.body;
  if (!shareStore.checkPassword(req.params.id, password)) {
    return res.status(403).json({ error: 'Incorrect password' });
  }
  const unlockToken = signToken({
    shareId: req.params.id,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  });
  res.json({ unlockToken });
});

function verifyShareAccess(req, shareId) {
  const info = shareStore.getPublicInfo(shareId);
  if (!info) return { ok: false, status: 404, error: 'Share link expired or not found' };
  if (!info.requiresPassword) return { ok: true, info };
  const token = req.query.st || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  const decoded = verifyToken(token);
  if (!decoded || decoded.shareId !== shareId) {
    return { ok: false, status: 403, error: 'Password required to access this shared file' };
  }
  return { ok: true, info };
}

app.all('/api/share/:id/stream', async (req, res) => {
  try {
    const shareId = req.params.id;
    const access = verifyShareAccess(req, shareId);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const sessionStr = shareStore.getSessionString(shareId);
    if (!sessionStr) return res.status(404).json({ error: 'Share session unavailable' });

    const shareSession = await tg.getOrReconnectShareClient(shareId, sessionStr);
    const entry = await tg.getMessageAndMeta(shareSession, access.info.meta.chatId, access.info.meta.id);
    if (!entry) return res.status(404).json({ error: 'Shared file no longer exists on Telegram' });

    const mode = req.query.mode === STREAMING_MODES.TELEGRAM_HQ ? STREAMING_MODES.TELEGRAM_HQ : STREAMING_MODES.FAST_WEB;
    const download = req.query.download === '1';

    await streamEngine.handleStreamRequest({
      req,
      res,
      client: shareSession.client,
      message: entry.message,
      meta: entry.meta,
      mode,
      download,
    });
  } catch (err) {
    console.error('[AirGram Share Stream Error]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/api/share/:id/thumb', async (req, res) => {
  try {
    const shareId = req.params.id;
    const access = verifyShareAccess(req, shareId);
    if (!access.ok) return res.status(access.status).end();

    const sessionStr = shareStore.getSessionString(shareId);
    const shareSession = await tg.getOrReconnectShareClient(shareId, sessionStr);
    const buf = await tg.downloadThumbnail(
      shareSession,
      access.info.meta.chatId,
      access.info.meta.id,
      req.query.full === '1'
    );
    if (!buf) return res.status(404).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buf);
  } catch {
    res.status(404).end();
  }
});

app.get('/api/share/:id/playlist.m3u', (req, res) => {
  const shareId = req.params.id;
  const access = verifyShareAccess(req, shareId);
  if (!access.ok) return res.status(access.status).end();

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const stPart = req.query.st ? `&st=${encodeURIComponent(req.query.st)}` : '';
  const directUrl = `${proto}://${host}/api/share/${shareId}/stream?mode=telegram_hq${stPart}`;
  const asciiM3u = (access.info.meta.fileName || 'stream').replace(/[^\x20-\x7E]/g, '_').replace(/[\"\\;\r\n]/g, '_');

  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiM3u}.m3u"`);
  res.send(`#EXTM3U
#EXTINF:-1,${access.info.meta.title || access.info.meta.fileName}
${directUrl}
`);
});


// --- AirDrive 7-Channel Backup, Sync, Dedup, Cloud Drive & Bulk Zip ---
function humanSize(bytes) {
  const b = Number(bytes || 0);
  if (b <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

app.get('/api/backup/config', requireAuth, (req, res) => {
  res.json(backupStore.getConfig(req.tgSession.user?.id));
});

app.post('/api/backup/config', requireAuth, (req, res) => {
  const updated = backupStore.setConfig(req.tgSession.user?.id, req.body || {});
  res.json(updated);
});

app.post('/api/backup/sync-channels', requireAuth, async (req, res) => {
  try {
    const userId = req.tgSession.user?.id;
    const cfg = backupStore.getConfig(userId);
    const seenChats = new Set();
    let syncedCount = 0;

    for (const cat of CATEGORIES) {
      const chatId = cfg.channels[cat];
      if (!chatId || seenChats.has(chatId)) continue;
      seenChats.add(chatId);

      let offsetId = 0;
      for (let page = 0; page < 4; page++) {
        const batch = await tg.getMediaMessages(req.tgSession, {
          chatId,
          tab: 'all',
          offsetId,
          limit: 50,
        });
        if (!batch.items.length) break;
        for (const item of batch.items) {
          backupStore.addRecord(userId, {
            fileName: item.fileName,
            size: item.size,
            category: cat,
            chatId: item.chatId,
            msgId: item.id,
            date: item.date,
            mimeType: item.mimeType,
            duration: item.duration,
            hasThumb: item.hasThumb,
            miniThumb: item.miniThumb,
          });
          syncedCount += 1;
        }
        offsetId = batch.nextOffsetId;
        if (!batch.hasMore) break;
      }
    }

    res.json({ ok: true, syncedCount, drive: backupStore.getDriveView(userId) });
  } catch (err) {
    console.error('[AirGram Sync Error]', err);
    res.status(500).json({ error: err.message || 'Sync failed' });
  }
});

app.post('/api/backup/check-duplicates', requireAuth, (req, res) => {
  const results = backupStore.checkDuplicates(req.tgSession.user?.id, req.body?.files || []);
  res.json({ results });
});

app.post('/api/backup/upload', requireAuth, upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  if (!uploaded) return res.status(400).json({ error: 'No file provided' });
  try {
    const userId = req.tgSession.user?.id;
    const { sha256 = '', relPath = '' } = req.body;
    const cfg = backupStore.getConfig(userId);
    const category = categorizeFile(uploaded.originalname, uploaded.mimetype, relPath);
    const targetChatId = cfg.channels[category] || req.tgSession.user?.id;

    const ext = uploaded.originalname.includes('.') ? uploaded.originalname.split('.').pop() : '';
    const caption = formatCaption(cfg.captionTemplate, {
      name: uploaded.originalname,
      category,
      size: humanSize(uploaded.size),
      date: new Date().toISOString().slice(0, 10),
      ext,
    });

    const msg = await tg.sendChatFile(req.tgSession, {
      chatId: targetChatId,
      filePath: uploaded.path,
      originalName: uploaded.originalname,
      mimeType: uploaded.mimetype,
      caption,
    });

    backupStore.addRecord(userId, {
      sha256,
      fileName: uploaded.originalname,
      size: uploaded.size,
      category,
      chatId: targetChatId,
      msgId: msg.id,
      date: msg.date,
      mimeType: uploaded.mimetype,
      duration: msg.media?.duration || 0,
      hasThumb: Boolean(msg.media?.hasThumb),
      miniThumb: msg.media?.miniThumb || null,
    });

    res.json({ ok: true, category, chatId: targetChatId, message: msg });
  } catch (err) {
    console.error('[AirGram Backup Upload Error]', err);
    res.status(500).json({ error: err.message || 'Backup upload failed' });
  } finally {
    fs.unlink(uploaded.path, () => {});
  }
});

app.get('/api/backup/drive', requireAuth, (req, res) => {
  res.json(backupStore.getDriveView(req.tgSession.user?.id));
});

app.get('/api/backup/export.csv', requireAuth, (req, res) => {
  const csv = backupStore.exportCsv(req.tgSession.user?.id);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="airgram-backup-manifest.csv"');
  res.send(csv);
});

app.post('/api/bulk-zip', requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'No files selected' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="airgram-bundle.zip"');

    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (err) => {
      console.error('[AirGram Bulk Zip Error]', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);

    const usedNames = new Set();
    for (const it of items.slice(0, 50)) {
      const entry = await tg.getMessageAndMeta(req.tgSession, it.chatId, it.msgId);
      if (!entry) continue;
      let name = (entry.meta.fileName || `file_${it.msgId}`).replace(/[\/:*?"<>|]/g, '_');
      while (usedNames.has(name)) {
        name = `${it.msgId}_${name}`;
      }
      usedNames.add(name);
      const buf = await req.tgSession.client.downloadMedia(entry.message, {});
      if (buf) archive.append(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), { name });
    }

    await archive.finalize();
  } catch (err) {
    console.error('[AirGram Bulk Zip Error]', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// --- Diagnostics & Cache ---
app.get('/api/diagnostics', requireAuth, (req, res) => {
  res.json(streamEngine.getDiagnostics());
});

app.post('/api/cache/clear', requireAuth, (req, res) => {
  streamEngine.clearCache();
  res.json({ ok: true, diagnostics: streamEngine.getDiagnostics() });
});

// --- Serve Built React Frontend in Production ---
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 AirGram Web server listening on http://localhost:${PORT}`);
});
