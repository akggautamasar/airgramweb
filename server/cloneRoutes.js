/**
 * AirGram Fast Cloner — AirSaver-inspired high-throughput engine
 *
 * Modes:
 *   forward  — batch forwardMessages (fastest for unrestricted chats)
 *   reupload — download + re-upload pipeline (works for restricted content
 *              the logged-in user can view; preserves captions/entities)
 *
 * Speed phases (reupload):
 *   1. Parallel downloads (PARALLEL_FILES) with DC warm-up
 *   2. In-memory transfer for files ≤ INMEM_THRESHOLD (skip disk)
 *   3. Pipelined ordered upload while downloads continue
 *   4. Tunable GramJS workers for multi-connection transfers
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bigInt = require('big-integer');
const { CustomFile } = require('telegram/client/uploads');

const root = path.resolve(process.env.CLONE_DATA_DIR || 'clone-data');

// ── Tunables (env-overridable, AirSaver-style defaults) ─────────────────────
const PARALLEL_FILES = Math.max(1, Math.min(16, Math.floor(Number(process.env.CLONE_PARALLEL) || 4)));
const INMEM_THRESHOLD = Math.max(1, Number(process.env.CLONE_INMEM_MB || 200)) * 1024 * 1024;
const MAX_FILE_MB = Math.max(1, Number(process.env.CLONE_MAX_FILE_MB || 2048));
const FORWARD_BATCH = Math.max(1, Number(process.env.CLONE_FORWARD_BATCH || 50));
// downloadMedia in GramJS 2.26.x does not accept a workers option.
const UL_WORKERS = Math.max(1, Number(process.env.CLONE_UL_WORKERS || 8));
const FLOOD_BASE_MS = Math.max(500, Number(process.env.CLONE_FLOOD_BASE_MS || 1500));

const jobs = new Map();
const running = new Set();
const rateWindows = new WeakMap();

const peer = (id) => (id === 'me' ? id : bigInt(id));
const errorText = (e) => String(e?.errorMessage || e?.message || e);

// Track aggregate payload progress independently of the most recent file callback.
function trackProgress(j, direction) {
  let previous = 0;
  return (value) => {
    const bytes = Math.max(0, Number(value) || 0);
    const delta = bytes >= previous ? bytes - previous : bytes;
    previous = bytes;
    const now = Date.now();
    let window = rateWindows.get(j);
    if (!window) {
      window = { start: now, download: 0, upload: 0 };
      rateWindows.set(j, window);
    }
    window[direction] += delta;
    const elapsed = (now - window.start) / 1000;
    if (elapsed >= 1) {
      j.metrics = {
        downloadBps: Math.round(window.download / elapsed),
        uploadBps: Math.round(window.upload / elapsed),
        updatedAt: now,
      };
      window.start = now;
      window.download = 0;
      window.upload = 0;
    }
    return bytes;
  };
}

function save(j) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const p = path.join(root, j.id + '.json');
  fs.writeFileSync(p + '.tmp', JSON.stringify(j), { mode: 0o600 });
  fs.renameSync(p + '.tmp', p);
}

function load() {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const f of fs.readdirSync(root).filter((x) => x.endsWith('.json'))) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
      if (j.status === 'running' || j.status === 'queued') j.status = 'paused';
      jobs.set(j.id, j);
    } catch (e) {
      console.error('Clone checkpoint unreadable', f, e.message);
    }
  }
}

function kind(m) {
  if (m.media?.photo) return 'photo';
  const d = m.media?.document;
  const mime = d?.mimeType || '';
  if (d) {
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime === 'application/pdf') return 'pdf';
    return 'document';
  }
  return m.media && m.media.className !== 'MessageMediaWebPage' ? 'other' : 'text';
}

function parseId(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483646) throw new Error('Invalid message ID');
  return n;
}

function fileNameOf(m) {
  const attrs = m.media?.document?.attributes || [];
  const named = attrs.find((a) => a.fileName);
  if (named?.fileName) return path.basename(named.fileName);
  if (m.media?.photo) return `photo-${m.id}.jpg`;
  const mime = m.media?.document?.mimeType || '';
  const ext =
    mime.includes('video') ? '.mp4' :
    mime.includes('audio') ? '.mp3' :
    mime.includes('pdf') ? '.pdf' : '';
  return `file-${m.id}${ext}`;
}

function mediaSize(m) {
  if (m.media?.document?.size != null) return Number(m.media.document.size);
  if (m.media?.photo) {
    const sizes = m.media.photo.sizes || [];
    const best = sizes[sizes.length - 1];
    return Number(best?.size || 0);
  }
  return 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withFloodRetry(fn, j, label = 'op') {
  let attempt = 0;
  for (;;) {
    if (j.status !== 'running') throw new Error('Job paused or cancelled');
    try {
      return await fn();
    } catch (e) {
      const err = errorText(e);
      const waitMatch = err.match(/FLOOD_WAIT[_OF_]*\s*(\d+)/i) || err.match(/wait of (\d+)/i);
      if (waitMatch) {
        const sec = Number(waitMatch[1]) || 5;
        if (sec > 120) throw e; // pause rather than retry before Telegram permits
        const ms = sec * 1000 + FLOOD_BASE_MS;
        j.progress = { ...(j.progress || {}), floodWait: sec, note: `Flood wait ${sec}s (${label})` };
        save(j);
        await sleep(ms);
        j.progress = { ...(j.progress || {}), floodWait: 0, note: '' };
        save(j);
        attempt++;
        if (attempt > 8) throw e;
        continue;
      }
      throw e;
    }
  }
}

// Validation diagnostics are intentionally read-only: a mismatch still pauses the job.
function downloadValidationError(m, expected, actual, storage, reason) {
  const failure = {
    stage: 'download-validation',
    msgId: m.id,
    expectedBytes: Number.isFinite(expected) && expected > 0 ? expected : null,
    actualBytes: Number.isFinite(actual) ? actual : null,
    storage,
    reason,
  };
  const e = new Error(
    'Download validation failed (message ' + failure.msgId + ', ' + storage +
    '): ' + reason + '; expected ' + (failure.expectedBytes ?? 'unknown') +
    ' bytes, actual ' + (failure.actualBytes ?? 'unknown') + ' bytes'
  );
  e.transferFailure = failure;
  return e;
}

// GramJS accepts a writer whose write() result is awaited. Own the file
// descriptor ourselves so validation never races buffered stream writes.
async function writeMediaFile(client, m, file, onProgress) {
  const handle = await fs.promises.open(file, 'w', 0o600);
  let count = 0;
  try {
    const writer = {
      async write(chunk) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Invalid downloaded chunk');
        if (count + chunk.length > MAX_FILE_MB * 1024 * 1024) throw new Error('File exceeds configured size limit');
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(chunk, offset, chunk.length - offset, count + offset);
          if (!result.bytesWritten) throw new Error('Zero-byte disk write');
          offset += result.bytesWritten;
        }
        count += chunk.length;
      },
    };
    await client.downloadMedia(m, { outputFile: writer, progressCallback: onProgress });
  } finally {
    await handle.close();
  }
  return count;
}

async function downloadOne(client, m, j) {
  const size = mediaSize(m);
  if (size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`File exceeds ${MAX_FILE_MB} MiB limit (${Math.round(size / 1024 / 1024)} MiB)`);
  }

  const useInmem = size > 0 && size <= INMEM_THRESHOLD;
  const name = fileNameOf(m);
  const started = Date.now();

  const record = trackProgress(j, 'download');
  const onProgress = (received, total) => {
    if (j.status !== 'running') throw new Error('Job paused or cancelled');
    received = record(received);
    total = Number(total) || size;
    const now = Date.now();
    const elapsed = Math.max(1, (now - started) / 1000);
    const speed = received / elapsed;
    j.progress = {
      ...(j.progress || {}),
      phase: 'download',
      msgId: m.id,
      bytes: received,
      total: total || size,
      speed,
      note: `↓ ${name}`,
    };
    if (!j._lastProg || now - j._lastProg > 800) {
      j._lastProg = now;
      save(j);
    }
  };

  if (useInmem) {
    const buf = await withFloodRetry(
      () =>
        client.downloadMedia(m, {
          progressCallback: onProgress,
        }),
      j,
      'download'
    );
    if (!Buffer.isBuffer(buf)) {
      throw downloadValidationError(m, size, null, 'memory', 'result is not a Buffer');
    }
    const buffer = buf;
    if (!buffer.length) throw downloadValidationError(m, size, 0, 'memory', 'empty buffer');
    if (m.media?.document && size > 0 && buffer.length !== size) {
      throw downloadValidationError(m, size, buffer.length, 'memory', 'document size mismatch');
    }
    return {
      kind: 'buffer',
      buffer,
      name,
      size: buffer.length,
      caption: m.message || '',
      entities: m.entities || [],
      isDocument: !!m.media?.document,
      msgId: m.id,
    };
  }

  const dir = fs.mkdtempSync(path.join(root, 'xfer-'));
  const file = path.join(dir, 'payload');
  try {
    if (fs.statfsSync) {
      const s = fs.statfsSync(root);
      const free = s.bavail * s.bsize;
      if (free < Math.max(size, 64 * 1024 * 1024) + 512 * 1024 * 1024) {
        throw new Error('Insufficient disk space for download');
      }
    }
    const written = await withFloodRetry(
      () => writeMediaFile(client, m, file, onProgress),
      j,
      'download'
    );
    let st;
    try {
      st = fs.statSync(file);
    } catch (e) {
      throw downloadValidationError(m, size, null, 'disk', 'stat failed: ' + (e.code || 'unknown'));
    }
    if (!st.isFile()) throw downloadValidationError(m, size, st.size, 'disk', 'not a regular file');
    if (!st.size) throw downloadValidationError(m, size, 0, 'disk', 'empty file');
    if (st.size !== written) throw downloadValidationError(m, written, st.size, 'disk', 'writer byte count mismatch');
    if (m.media?.document && size > 0 && st.size !== size) {
      throw downloadValidationError(m, size, st.size, 'disk', 'document size mismatch');
    }
    return {
      kind: 'path',
      path: file,
      dir,
      name,
      size: st.size,
      caption: m.message || '',
      entities: m.entities || [],
      isDocument: !!m.media?.document,
      msgId: m.id,
    };
  } catch (e) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
    throw e;
  }
}

function cleanupItem(item) {
  if (item?.kind === 'path' && item.dir) {
    try {
      fs.rmSync(item.dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function uploadOne(client, dst, item, j) {
  const started = Date.now();
  const record = trackProgress(j, 'upload');
  const onProgress = (fraction) => {
    const sent = record(Math.min(1, Math.max(0, Number(fraction) || 0)) * item.size);
    const now = Date.now();
    const elapsed = Math.max(1, (now - started) / 1000);
    const speed = sent / elapsed;
    j.progress = {
      ...(j.progress || {}),
      phase: 'upload',
      msgId: item.msgId,
      bytes: sent,
      total: item.size,
      speed,
      note: `↑ ${item.name}`,
    };
    if (!j._lastProg || now - j._lastProg > 800) {
      j._lastProg = now;
      save(j);
    }
  };

  let uploadDir;
  try {
    let fileArg;
    if (item.kind === 'buffer') {
      if (!Buffer.isBuffer(item.buffer) || !item.buffer.length || item.buffer.length !== item.size) {
        throw new Error('Invalid upload buffer');
      }
      // GramJS may switch from buffer to path internally for larger files.
      // Provide both valid inputs and keep the backing file until sendFile settles.
      uploadDir = fs.mkdtempSync(path.join(root, 'upload-'));
      const filePath = path.join(uploadDir, 'payload');
      await fs.promises.writeFile(filePath, item.buffer, { mode: 0o600 });
      fileArg = new CustomFile(item.name, item.size, filePath, item.buffer);
    } else {
      if (item.kind !== 'path' || !item.path) throw new Error('Missing upload path');
      const st = fs.statSync(item.path);
      if (!st.isFile() || !st.size || st.size !== item.size) throw new Error('Invalid upload file');
      fileArg = new CustomFile(item.name, item.size, item.path);
    }

    await withFloodRetry(
      () =>
        client.sendFile(dst, {
          file: fileArg,
          caption: item.caption,
          formattingEntities: item.entities,
          forceDocument: item.isDocument,
          workers: UL_WORKERS,
          progressCallback: onProgress,
        }),
      j,
      'upload'
    );
  } finally {
    if (uploadDir) {
      try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

async function runForward(j, session) {
  const c = session.client;
  await c.getDialogs({ limit: 150 });
  const src = await c.getEntity(peer(j.source));
  const target = await c.getEntity(peer(j.destination));
  if (String(src.id) === String(target.id) && src.className === target.className) {
    throw new Error('Source and destination must differ');
  }
  const dst = await c.getInputEntity(target);

  if (src.noforwards && !j.forceReupload) {
    throw new Error('Source has protected content — enable Re-upload mode');
  }

  if (j.end === null) {
    const latest = await c.getMessages(src, { limit: 1 });
    j.end = latest[0]?.id || 0;
    save(j);
  }

  let batch = [];

  async function flush() {
    if (!batch.length) return;
    const ids = batch.map((m) => m.id);
    j.inflight = ids;
    save(j);
    try {
      await withFloodRetry(
        () => c.forwardMessages(dst, { messages: ids, fromPeer: src }),
        j,
        'forward'
      );
      j.forwarded += ids.length;
    } catch (e) {
      const err = errorText(e);
      if (!j.fallback || !/FILE_REFERENCE_EXPIRED|MEDIA_EMPTY|MEDIA_INVALID/.test(err)) {
        if (/FLOOD_WAIT|CHAT_WRITE_FORBIDDEN|CHAT_FORWARDS_RESTRICTED/.test(err)) {
          j.inflight = [];
          save(j);
        }
        throw e;
      }
      for (const m of batch) {
        if (j.status !== 'running') break;
        if (m.noforwards || src.noforwards) throw e;
        if (!m.media?.document && !m.media?.photo) throw e;
        const item = await downloadOne(c, m, j);
        try {
          await uploadOne(c, dst, item, j);
          j.uploaded++;
          j.cursor = m.id;
          j.inflight = j.inflight.filter((id) => id !== m.id);
          save(j);
        } finally {
          cleanupItem(item);
        }
      }
    }
    j.cursor = ids[ids.length - 1];
    j.inflight = [];
    batch = [];
    j.progress = { ...(j.progress || {}), phase: 'forward', note: `Forwarded ${j.forwarded}` };
    save(j);
  }

  for await (const m of c.iterMessages(src, {
    reverse: true,
    minId: Math.max(j.start - 1, j.cursor),
    maxId: j.end + 1,
  })) {
    if (j.status !== 'running') break;
    if (m.id < j.start || m.id > j.end) continue;
    if (m.className !== 'Message' || m.noforwards || !j.types.includes(kind(m))) {
      await flush();
      j.skipped++;
      j.cursor = m.id;
      save(j);
      continue;
    }
    batch.push(m);
    if (batch.length >= FORWARD_BATCH) await flush();
  }
  if (j.status === 'running') {
    await flush();
    if (j.status === 'running') j.status = 'completed';
  }
}

async function runReupload(j, session) {
  const c = session.client;
  await c.getDialogs({ limit: 150 });
  const src = await c.getEntity(peer(j.source));
  const target = await c.getEntity(peer(j.destination));
  if (String(src.id) === String(target.id) && src.className === target.className) {
    throw new Error('Source and destination must differ');
  }
  const dst = await c.getInputEntity(target);

  if (j.end === null) {
    const latest = await c.getMessages(src, { limit: 1 });
    j.end = latest[0]?.id || 0;
    save(j);
  }

  // Keep only a bounded number of downloads in flight. Attach rejection
  // handlers at creation, not after an unrelated download finishes.
  const pending = [];
  let scanned = 0;
  async function prepare(m) {
    if (j.status !== 'running') throw new Error('Job paused or cancelled');
    if (m.className !== 'Message' || !j.types.includes(kind(m))) {
      return { skip: true, msgId: m.id };
    }
    if (!m.media?.document && !m.media?.photo) {
      return { textOnly: true, caption: m.message || '', entities: m.entities || [], msgId: m.id };
    }
    try {
      return await downloadOne(c, m, j);
    } catch (e) {
      const f = e?.transferFailure;
      const retryable = f?.stage === 'download-validation' &&
        f.actualBytes != null && f.expectedBytes != null && f.actualBytes < f.expectedBytes;
      if (src.noforwards || m.noforwards || !retryable || j.status !== 'running') throw e;
      await sleep(1500);
      if (j.status !== 'running') throw new Error('Job paused or cancelled');
      return downloadOne(c, m, j);
    }
  }

  function enqueue(m) {
    pending.push(prepare(m).then(item => ({ item }), error => ({ error, msgId: m.id })));
  }

  async function consume() {
    const result = await pending.shift();
    if (result.error) {
      const e = result.error instanceof Error ? result.error : new Error(errorText(result.error));
      if (!e.transferFailure) e.transferFailure = { stage: 'prepare', msgId: result.msgId };
      throw e;
    }
    const item = result.item;
    try {
      if (j.status !== 'running') throw new Error('Job paused or cancelled');
      if (item.skip) {
        j.skipped++;
      } else {
        j.inflight = [item.msgId];
        save(j);
        if (item.textOnly) {
          await withFloodRetry(() => c.sendMessage(dst, {
            message: item.caption || ' ',
            formattingEntities: item.entities,
          }), j, 'sendText');
          j.forwarded++;
        } else {
          await uploadOne(c, dst, item, j);
          j.uploaded++;
        }
        j.inflight = [];
      }
      j.cursor = item.msgId;
      j._lastProg = Date.now();
      save(j);
    } finally {
      cleanupItem(item);
    }
  }

  try {
    for await (const m of c.iterMessages(src, {
      reverse: true,
      minId: Math.max(j.start - 1, j.cursor),
      maxId: j.end + 1,
    })) {
      if (j.status !== 'running') break;
      if (m.id < j.start || m.id > j.end) continue;
      scanned++;
      enqueue(m);
      if (pending.length >= PARALLEL_FILES) await consume();
    }
    while (pending.length && j.status === 'running') await consume();
    if (j.status === 'running') {
      j.status = 'completed';
      j.progress = {
        phase: 'done', note: 'Completed',
        done: j.uploaded + j.forwarded, scanned,
      };
    }
  } finally {
    // Finish/clean any already-started downloads before releasing the job lock.
    for (const result of await Promise.all(pending)) cleanupItem(result.item);
  }
}

async function run(j, session) {
  if (running.size && !running.has(j.id)) throw new Error('Another clone is running; pause it first');
  running.add(j.id);
  j.status = 'running';
  j.error = '';
  j.failure = null;
  j.progress = { phase: 'start', note: 'Starting…' };
  j.metrics = null;
  rateWindows.set(j, { start: Date.now(), download: 0, upload: 0 });
  j._lastProg = Date.now();
  save(j);

  try {
    if (j.forceReupload || j.mode === 'reupload') {
      await runReupload(j, session);
    } else {
      await runForward(j, session);
    }
  } catch (e) {
    j.error = errorText(e);
    if (e?.transferFailure) {
      j.failure = e.transferFailure;
    } else if (j.inflight?.length) {
      j.failure = { stage: 'send', msgIds: [...j.inflight] };
    }
    // Do not log captions, file paths, account data or session credentials.
    if (j.failure) console.warn('[clone] transfer stopped', JSON.stringify(j.failure));
    if (j.inflight?.length && /FLOOD_WAIT|CHAT_WRITE_FORBIDDEN|CHAT_FORWARDS_RESTRICTED/.test(j.error)) {
      // keep checkpoint
    }
    if (j.status !== 'cancelled') {
      j.status = /protected content|CHAT_FORWARDS_RESTRICTED|noforwards/i.test(j.error)
        ? 'blocked'
        : 'paused';
    }
  } finally {
    running.delete(j.id);
    rateWindows.delete(j);
    j.progress = { ...(j.progress || {}), phase: j.status };
    save(j);
  }
}

module.exports = function register(app, auth) {
  load();
  const owner = (req) => String(req.tgSession.user.id);

  app.get('/api/clone/jobs', auth, (req, res) => {
    res.json({
      jobs: [...jobs.values()].filter((j) => j.owner === owner(req)).map(j => ({
        ...j,
        progressAgeSec: j.status === 'running' && j._lastProg ? Math.max(0, Math.floor((Date.now() - j._lastProg) / 1000)) : null,
      })),
      limits: {
        parallel: PARALLEL_FILES,
        inmemMb: Math.round(INMEM_THRESHOLD / 1024 / 1024),
        maxFileMb: MAX_FILE_MB,
        forwardBatch: FORWARD_BATCH,
        dlWorkers: null, // not exposed by GramJS downloadMedia
        ulWorkers: UL_WORKERS,
      },
    });
  });

  app.post('/api/clone/jobs', auth, (req, res) => {
    try {
      if (running.size) throw new Error('Another clone is running');
      const b = req.body;
      const source = String(b.source);
      const destination = String(b.destination);
      if (
        !/^-?\d+$/.test(source) ||
        !(/^-?\d+$/.test(destination) || destination === 'me') ||
        source === destination ||
        (destination === 'me' && source === owner(req))
      ) {
        throw new Error('Select different source and destination chats');
      }
      if (b.authorized !== true) throw new Error('Confirm permission to copy content');

      const start = b.start ? parseId(b.start) : 1;
      const end = b.end ? parseId(b.end) : null;
      if (end !== null && end < start) throw new Error('End must be at least start');

      const types = ['photo', 'video', 'audio', 'pdf', 'document', 'text', 'other'].filter(
        (t) => Array.isArray(b.types) && b.types.includes(t)
      );
      if (!types.length) throw new Error('Select content types');

      const forceReupload = b.forceReupload === true || b.mode === 'reupload';
      const mode = forceReupload ? 'reupload' : 'forward';

      const dup = [...jobs.values()].some(
        (j) =>
          j.owner === owner(req) &&
          j.source === source &&
          j.destination === destination &&
          j.start === start &&
          (j.requestedEnd ?? null) === end &&
          JSON.stringify(j.types) === JSON.stringify(types) &&
          j.mode === mode &&
          ['running', 'queued', 'paused', 'blocked'].includes(j.status)
      );
      if (dup) throw new Error('Matching job already exists; review or delete it first');

      const j = {
        requestedEnd: end,
        id: crypto.randomUUID(),
        owner: owner(req),
        source,
        destination,
        start,
        end,
        types,
        fallback: b.fallback === true,
        forceReupload,
        mode,
        cursor: start - 1,
        forwarded: 0,
        uploaded: 0,
        skipped: 0,
        inflight: [],
        status: 'queued',
        createdAt: Date.now(),
        progress: { phase: 'queued', note: 'Queued' },
      };
      jobs.set(j.id, j);
      save(j);
      run(j, req.tgSession).catch(console.error);
      res.json({ job: j });
    } catch (e) {
      res.status(400).json({ error: errorText(e) });
    }
  });

  app.post('/api/clone/jobs/:id/:action', auth, (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j || j.owner !== owner(req)) return res.status(404).json({ error: 'Job not found' });

    if (req.params.action === 'cancel' && ['running', 'paused', 'blocked', 'queued'].includes(j.status)) {
      j.status = 'cancelled';
      save(j);
      return res.json({ job: j });
    }
    if (req.params.action === 'delete' && !running.has(j.id)) {
      try {
        fs.unlinkSync(path.join(root, j.id + '.json'));
      } catch (_) {}
      jobs.delete(j.id);
      return res.json({ ok: true });
    }
    if (req.params.action === 'pause' && j.status === 'running') {
      j.status = 'paused';
      save(j);
    } else if (
      req.params.action === 'resume' &&
      j.status === 'paused' &&
      !running.size &&
      !(j.inflight && j.inflight.length)
    ) {
      run(j, req.tgSession).catch(console.error);
    } else {
      return res.status(409).json({
        error: j.inflight?.length
          ? 'Uncertain delivery: review destination before creating a new range'
          : 'Action unavailable',
      });
    }
    res.json({ job: j });
  });
};
