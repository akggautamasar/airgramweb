const bigInt = require('big-integer');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { computeCheck } = require('telegram/Password');

const API_ID = Number(process.env.TG_API_ID || 0);
const API_HASH = process.env.TG_API_HASH || '';
const APP_SECRET = process.env.APP_SECRET || 'airgram_default_dev_secret_change_me';

function resolvePeer(session, chatId) {
  const str = String(chatId);
  if (str === String(session.user?.id)) return 'me';
  if (/^-?\d+$/.test(str)) return bigInt(str);
  return str;
}

function requireApiCreds() {
  if (!API_ID || !API_HASH) {
    throw new Error('Server is missing TG_API_ID or TG_API_HASH in .env');
  }
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', APP_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', APP_SECRET).update(data).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function sendSessionBackupMessage(client, sessionString) {
  try {
    const backupText =
      `🔐 AirGram Web Login Backup\n\n` +
      `Aapka Session Key:\n\n` +
      `\`${sessionString}\`\n\n` +
      `💡 *Tip: Kisi bhi doosre phone ya laptop par bina QR scan kiye ye key paste karke instant login kar sakte hain!*`;

    await client.sendMessage('me', {
      message: backupText,
      parseMode: 'markdown',
    });
  } catch (err) {
    console.warn('[AirGram] Could not send Saved Messages backup:', err.message);
  }
}

function serializeUser(me) {
  if (!me) return null;
  return {
    id: me.id ? me.id.toString() : '',
    firstName: me.firstName || '',
    lastName: me.lastName || '',
    username: me.username || '',
    phone: me.phone || '',
  };
}

function extractMediaMeta(msg, chatId) {
  const media = msg.media;
  if (!media) return null;

  let kind = null;
  let fileName = '';
  let mimeType = 'application/octet-stream';
  let size = 0;
  let duration = 0;
  let width = 0;
  let height = 0;
  let title = '';
  let performer = '';
  let hasThumb = false;
  let miniThumb = null;

  if (media.className === 'MessageMediaPhoto' && media.photo) {
    kind = 'photo';
    mimeType = 'image/jpeg';
    fileName = `photo_${msg.id}.jpg`;
    const sizes = media.photo.sizes || [];
    const largest = sizes[sizes.length - 1];
    if (largest) {
      size = largest.size || (largest.sizes ? largest.sizes[largest.sizes.length - 1] : 0) || 0;
      width = largest.w || 0;
      height = largest.h || 0;
    }
    const stripped = sizes.find((s) => s.className === 'PhotoStrippedSize');
    if (stripped && stripped.bytes) {
      miniThumb = `data:image/jpeg;base64,${Buffer.from(stripped.bytes).toString('base64')}`;
    }
    hasThumb = sizes.length > 0;
  } else if (media.className === 'MessageMediaDocument' && media.document) {
    const doc = media.document;
    mimeType = doc.mimeType || 'application/octet-stream';
    size = Number(doc.size || 0);
    hasThumb = Array.isArray(doc.thumbs) && doc.thumbs.length > 0;

    if (Array.isArray(doc.thumbs)) {
      const stripped = doc.thumbs.find((t) => t.className === 'PhotoStrippedSize');
      if (stripped && stripped.bytes) {
        miniThumb = `data:image/jpeg;base64,${Buffer.from(stripped.bytes).toString('base64')}`;
      }
    }

    const attrs = doc.attributes || [];
    for (const attr of attrs) {
      if (attr.className === 'DocumentAttributeFilename') {
        fileName = attr.fileName || '';
      } else if (attr.className === 'DocumentAttributeVideo') {
        kind = 'video';
        duration = attr.duration || 0;
        width = attr.w || 0;
        height = attr.h || 0;
      } else if (attr.className === 'DocumentAttributeAudio') {
        kind = attr.voice ? 'audio' : 'audio';
        duration = attr.duration || 0;
        title = attr.title || '';
        performer = attr.performer || '';
      }
    }

    if (!kind) {
      if (mimeType.startsWith('video/')) kind = 'video';
      else if (mimeType.startsWith('audio/')) kind = 'audio';
      else if (mimeType.startsWith('image/')) kind = 'photo';
      else kind = 'document';
    }

    if (!fileName) {
      const ext = mimeType.split('/')[1] || 'bin';
      fileName = `${kind}_${msg.id}.${ext}`;
    }
  } else {
    return null;
  }

  return {
    id: msg.id,
    chatId: String(chatId),
    cacheId: `${chatId}_${msg.id}`,
    kind,
    fileName,
    mimeType,
    size,
    duration,
    width,
    height,
    title: title || fileName,
    performer,
    date: msg.date || 0,
    caption: msg.message || '',
    hasThumb,
    miniThumb,
    streamable: kind === 'video' || kind === 'audio',
  };
}

class TelegramManager {
  constructor() {
    this.activeClients = new Map(); // authId -> { client, user, sessionString, lastUsed }
    this.pendingLogins = new Map(); // loginId -> state
    this.messageCache = new Map(); // `${authId}:${chatId}:${msgId}` -> { message, meta }
  }

  createClient(sessionStr = '') {
    requireApiCreds();
    return new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, {
      connectionRetries: 5,
      useWSS: false,
    });
  }

  registerAuthenticatedClient(client, user, sessionString) {
    const authId = crypto.randomUUID();
    this.activeClients.set(authId, {
      client,
      user: serializeUser(user),
      sessionString,
      lastUsed: Date.now(),
    });
    const token = signToken({ authId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    return { token, authId, user: serializeUser(user), sessionString };
  }

  async getSession(req) {
    const cookieToken = req.cookies && req.cookies.airgram_token;
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null;
    const queryToken = req.query.token;
    const rawToken = headerToken || cookieToken || queryToken;
    const decoded = verifyToken(rawToken);
    if (!decoded || !decoded.authId) return null;

    const entry = this.activeClients.get(decoded.authId);
    if (!entry) return null;
    entry.lastUsed = Date.now();
    if (!entry.client.connected) {
      await entry.client.connect();
    }
    return { ...entry, authId: decoded.authId };
  }

  // --- 1. QR Login ---
  async startQrLogin() {
    const loginId = crypto.randomUUID();
    const client = this.createClient('');
    await client.connect();

    const state = {
      type: 'qr',
      status: 'waiting',
      qrDataUrl: null,
      client,
      error: null,
      authResult: null,
      resolve2fa: null,
    };
    this.pendingLogins.set(loginId, state);

    // Run QR auth loop asynchronously
    (async () => {
      try {
        const user = await client.signInUserWithQrCode(
          { apiId: API_ID, apiHash: API_HASH },
          {
            qrCode: async (code) => {
              const tokenB64 = code.token.toString('base64url');
              const tgUrl = `tg://login?token=${tokenB64}`;
              state.qrDataUrl = await QRCode.toDataURL(tgUrl, {
                width: 280,
                margin: 2,
                color: { dark: '#0B1021', light: '#FFFFFF' },
              });
            },
            password: async (hint) => {
              state.status = 'needs_2fa';
              state.hint = hint || '';
              return await new Promise((resolve) => {
                state.resolve2fa = resolve;
              });
            },
            onError: (err) => {
              state.error = err.message || String(err);
              state.status = 'error';
            },
          }
        );

        const sessionString = client.session.save();
        await sendSessionBackupMessage(client, sessionString);
        state.authResult = this.registerAuthenticatedClient(client, user, sessionString);
        state.status = 'authenticated';
      } catch (err) {
        if (state.status !== 'error') {
          state.error = err.message || 'QR Login failed';
          state.status = 'error';
        }
      }
    })();

    // Wait briefly for first QR code to render
    for (let i = 0; i < 25; i++) {
      if (state.qrDataUrl || state.status === 'error') break;
      await new Promise((r) => setTimeout(r, 120));
    }

    return {
      loginId,
      status: state.status,
      qrDataUrl: state.qrDataUrl,
      error: state.error,
    };
  }

  getQrStatus(loginId) {
    const state = this.pendingLogins.get(loginId);
    if (!state) return { status: 'expired', error: 'Login session expired' };
    const payload = {
      status: state.status,
      qrDataUrl: state.qrDataUrl,
      hint: state.hint || '',
      error: state.error,
    };
    if (state.status === 'authenticated' && state.authResult) {
      payload.auth = state.authResult;
      this.pendingLogins.delete(loginId);
    }
    return payload;
  }

  submitQr2fa(loginId, password) {
    const state = this.pendingLogins.get(loginId);
    if (!state || !state.resolve2fa) {
      throw new Error('No 2FA prompt active for this login session');
    }
    state.status = 'verifying_2fa';
    state.resolve2fa(password);
    return { status: 'verifying_2fa' };
  }

  // --- 2. Phone + OTP + 2FA ---
  async startPhoneLogin(phoneNumber) {
    const loginId = crypto.randomUUID();
    const client = this.createClient('');
    await client.connect();

    const { phoneCodeHash } = await client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phoneNumber);
    this.pendingLogins.set(loginId, {
      type: 'phone',
      status: 'needs_code',
      phoneNumber,
      phoneCodeHash,
      client,
    });

    return { loginId, status: 'needs_code' };
  }

  async verifyPhoneCode(loginId, phoneCode) {
    const state = this.pendingLogins.get(loginId);
    if (!state) throw new Error('Login session expired');

    try {
      const result = await state.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: state.phoneNumber,
          phoneCodeHash: state.phoneCodeHash,
          phoneCode: String(phoneCode).trim(),
        })
      );
      const user = result.user || (await state.client.getMe());
      const sessionString = state.client.session.save();
      await sendSessionBackupMessage(state.client, sessionString);
      const auth = this.registerAuthenticatedClient(state.client, user, sessionString);
      this.pendingLogins.delete(loginId);
      return { status: 'authenticated', auth };
    } catch (err) {
      if (err.errorMessage === 'SESSION_PASSWORD_NEEDED' || String(err.message).includes('SESSION_PASSWORD_NEEDED')) {
        const pwdInfo = await state.client.invoke(new Api.account.GetPassword());
        state.status = 'needs_2fa';
        state.hint = pwdInfo.hint || '';
        return { status: 'needs_2fa', hint: state.hint };
      }
      throw err;
    }
  }

  async verifyPhone2fa(loginId, password) {
    const state = this.pendingLogins.get(loginId);
    if (!state) throw new Error('Login session expired');

    const pwdInfo = await state.client.invoke(new Api.account.GetPassword());
    const passwordCheck = await computeCheck(pwdInfo, password);
    const result = await state.client.invoke(new Api.auth.CheckPassword({ password: passwordCheck }));

    const user = result.user || (await state.client.getMe());
    const sessionString = state.client.session.save();
    await sendSessionBackupMessage(state.client, sessionString);
    const auth = this.registerAuthenticatedClient(state.client, user, sessionString);
    this.pendingLogins.delete(loginId);
    return { status: 'authenticated', auth };
  }

  // --- 3. Session String Login ---
  async loginWithSessionString(sessionString) {
    const clean = String(sessionString || '').trim();
    if (!clean) throw new Error('Session key cannot be empty');

    const client = this.createClient(clean);
    await client.connect();
    const me = await client.getMe();
    if (!me) throw new Error('Invalid or expired session key');

    const saved = client.session.save() || clean;
    return this.registerAuthenticatedClient(client, me, saved);
  }

  async logout(authId) {
    const entry = this.activeClients.get(authId);
    if (entry) {
      try {
        await entry.client.disconnect();
      } catch {}
      this.activeClients.delete(authId);
    }
  }

  // --- Chats & Media ---
  async getDialogs(session, { limit = 100 } = {}) {
    const dialogs = await session.client.getDialogs({ limit });
    const meId = session.user.id;
    const list = dialogs.map((d) => {
      const entity = d.entity;
      const id = d.id ? d.id.toString() : '';
      let type = 'user';
      if (id === meId) type = 'saved';
      else if (d.isChannel) type = entity?.megagroup ? 'group' : 'channel';
      else if (d.isGroup) type = 'group';
      else if (entity?.bot) type = 'bot';

      const title = type === 'saved' ? 'Saved Messages' : d.title || d.name || 'Unknown Chat';
      return {
        id,
        title,
        type,
        unreadCount: d.unreadCount || 0,
        lastMessageDate: d.date || 0,
        lastMessageText: d.message?.message ? d.message.message.slice(0, 80) : '',
      };
    });

    // Pin Saved Messages to top
    list.sort((a, b) => (a.type === 'saved' ? -1 : b.type === 'saved' ? 1 : 0));
    return list;
  }

  async getMediaMessages(session, { chatId, tab = 'video', offsetId = 0, limit = 40, query = '' }) {
    const filterMap = {
      video: new Api.InputMessagesFilterVideo(),
      audio: new Api.InputMessagesFilterMusic(),
      photo: new Api.InputMessagesFilterPhotos(),
      document: new Api.InputMessagesFilterDocument(),
      all: new Api.InputMessagesFilterEmpty(),
    };
    const filter = filterMap[tab] || filterMap.video;
    const peer = resolvePeer(session, chatId);

    const msgs = await session.client.getMessages(peer, {
      limit: Math.min(80, Number(limit) || 40),
      offsetId: Number(offsetId) || 0,
      filter,
      search: query || undefined,
    });

    const items = [];
    for (const m of msgs) {
      const meta = extractMediaMeta(m, chatId);
      if (meta) {
        this.messageCache.set(`${session.authId}:${chatId}:${m.id}`, { message: m, meta });
        items.push(meta);
      }
    }

    const nextOffsetId = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;
    return { items, nextOffsetId, hasMore: msgs.length >= (Number(limit) || 40) };
  }


  async getChatTimeline(session, { chatId, offsetId = 0, limit = 40, query = '' }) {
    const peer = resolvePeer(session, chatId);
    let msgs;
    try {
      msgs = await session.client.getMessages(peer, {
        limit: Math.min(60, Number(limit) || 40),
        offsetId: Number(offsetId) || 0,
        search: query || undefined,
      });
    } catch (e) {
      await session.client.getDialogs({ limit: 100 });
      msgs = await session.client.getMessages(peer, {
        limit: Math.min(60, Number(limit) || 40),
        offsetId: Number(offsetId) || 0,
        search: query || undefined,
      });
    }

    const items = [];
    for (const m of msgs) {
      if (!m || m.className === 'MessageService') continue;
      const meta = extractMediaMeta(m, chatId);
      if (meta) {
        this.messageCache.set(`${session.authId}:${chatId}:${m.id}`, { message: m, meta });
      }
      let senderName = '';
      if (m.sender) {
        senderName =
          m.sender.title ||
          [m.sender.firstName, m.sender.lastName].filter(Boolean).join(' ') ||
          m.sender.username ||
          '';
      }
      items.push({
        id: m.id,
        chatId: String(chatId),
        date: m.date || 0,
        out: Boolean(m.out),
        senderName,
        text: m.message || '',
        replyToMsgId: m.replyTo?.replyToMsgId || null,
        fwdFrom: m.fwdFrom?.fromName || null,
        media: meta,
      });
    }

    const nextOffsetId = msgs.length > 0 ? msgs[msgs.length - 1].id : 0;
    return {
      messages: items.reverse(),
      nextOffsetId,
      hasMore: msgs.length >= (Number(limit) || 40),
    };
  }

  async sendChatMessage(session, { chatId, text, replyToMsgId }) {
    const peer = resolvePeer(session, chatId);
    const m = await session.client.sendMessage(peer, {
      message: String(text || ''),
      replyTo: replyToMsgId ? Number(replyToMsgId) : undefined,
    });
    return {
      id: m.id,
      chatId: String(chatId),
      date: m.date || Math.floor(Date.now() / 1000),
      out: true,
      senderName: [session.user?.firstName, session.user?.lastName].filter(Boolean).join(' '),
      text: m.message || String(text || ''),
      replyToMsgId: replyToMsgId ? Number(replyToMsgId) : null,
      fwdFrom: null,
      media: null,
    };
  }

  async getMessageAndMeta(session, chatId, msgId) {
    const key = `${session.authId}:${chatId}:${msgId}`;
    let cached = this.messageCache.get(key);
    if (cached) return cached;

    const peer = resolvePeer(session, chatId);
    let msgs;
    try {
      msgs = await session.client.getMessages(peer, { ids: [Number(msgId)] });
    } catch (e) {
      // Populate GramJS entity cache if server restarted or chat wasn't loaded yet
      await session.client.getDialogs({ limit: 100 });
      msgs = await session.client.getMessages(peer, { ids: [Number(msgId)] });
    }
    const msg = msgs && msgs[0];
    if (!msg) return null;

    const meta = extractMediaMeta(msg, chatId);
    if (!meta) return null;

    cached = { message: msg, meta };
    this.messageCache.set(key, cached);
    return cached;
  }

  async downloadThumbnail(session, chatId, msgId, fullQuality = false) {
    const entry = await this.getMessageAndMeta(session, chatId, msgId);
    if (!entry) return null;

    const { message, meta } = entry;
    if (fullQuality && meta.kind === 'photo') {
      return await session.client.downloadMedia(message, {});
    }

    // For video/doc/photo preview, download medium thumbnail if available
    if (message.media?.photo) {
      const sizes = message.media.photo.sizes || [];
      const medium = sizes.find((s) => s.type === 'x' || s.type === 'm') || sizes[sizes.length - 1];
      return await session.client.downloadMedia(message, { thumb: medium });
    }
    if (message.media?.document?.thumbs?.length) {
      const thumbs = message.media.document.thumbs;
      const thumb = thumbs.find((t) => t.type === 'm' || t.type === 'x') || thumbs[thumbs.length - 1];
      return await session.client.downloadMedia(message, { thumb });
    }
    return null;
  }
}

module.exports = { TelegramManager, signToken, verifyToken };
