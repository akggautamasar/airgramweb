require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { TelegramManager, signToken, verifyToken } = require('./telegramManager');
const { StreamEngine } = require('./streamEngine');
const { STREAMING_MODES } = require('./streamingPolicy');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const tg = new TelegramManager();
const streamEngine = new StreamEngine(process.env.STREAM_CACHE_MAX_MB || 256);

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
    const dialogs = await tg.getDialogs(req.tgSession, { limit: req.query.limit || 100 });
    res.json({ chats: dialogs });
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
  res.setHeader('Content-Disposition', `attachment; filename="${entry.meta.fileName}.m3u"`);
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
