const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Exercise the real module and filesystem without connecting to Telegram.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'airgram-transfer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(__dirname, '../cloneRoutes.js'), 'utf8');
  const mod = { exports: {} };
  const load = new Function('require', 'module', 'exports', 'process', 'Buffer',
    source + '\nreturn { writeMediaFile, downloadOne, run };');
  const api = load(require, mod, mod.exports, {
    env: { CLONE_DATA_DIR: root, CLONE_INMEM_MB: '1', CLONE_PARALLEL: '2' },
  }, Buffer);
  return { root, ...api };
}

const media = (id, size) => ({
  id, className: 'Message', message: 'test',
  media: { document: { size, mimeType: 'application/pdf', attributes: [{ fileName: 'test.pdf' }] } },
});
function job() {
  return {
    id: 'job', source: '1', destination: '2', start: 1, end: 3, cursor: 0,
    status: 'queued', mode: 'reupload', types: ['pdf'], forwarded: 0,
    uploaded: 0, skipped: 0, inflight: [],
  };
}

test('writer flushes all bytes before returning', async t => {
  const { root, writeMediaFile } = fixture(t);
  const file = path.join(root, 'payload');
  const data = Buffer.alloc(2 * 1024 * 1024 + 17, 83);
  const bytes = await writeMediaFile({
    async downloadMedia(m, options) {
      for (let i = 0; i < data.length; i += 65536) {
        await options.outputFile.write(data.subarray(i, i + 65536));
      }
    },
  }, {}, file, () => {});
  assert.equal(bytes, data.length);
  assert.deepEqual(fs.readFileSync(file), data);
});

test('incomplete download is rejected and temporary files are removed', async t => {
  const { root, downloadOne } = fixture(t);
  await assert.rejects(downloadOne({
    async downloadMedia(m, opts) { await opts.outputFile.write(Buffer.alloc(7)); },
  }, media(13, 2 * 1024 * 1024), { status: 'running' }), e =>
    e.transferFailure?.msgId === 13 && e.transferFailure?.actualBytes === 7);
  assert.equal(fs.readdirSync(root).length, 0);
});

function makeClient(fail) {
  return {
    async getDialogs() { return []; },
    async getEntity(id) { return { id, className: 'Channel', noforwards: false }; },
    async getInputEntity(x) { return x; },
    async *iterMessages() {
      yield media(1, 8);
      yield { id: 2, className: 'MessageService' };
      yield media(3, 8);
    },
    async downloadMedia() { return Buffer.alloc(8); },
    async sendFile(dst, p) {
      assert.equal(fs.statSync(p.file.path).size, 8);
      if (fail) throw new Error('simulated upload failure');
      p.progressCallback(1);
    },
  };
}

test('success commits checkpoint in order and removes upload backing files', async t => {
  const { root, run } = fixture(t);
  const j = job();
  await run(j, { client: makeClient(false) });
  assert.equal(j.status, 'completed');
  assert.equal(j.cursor, 3);
  assert.equal(j.uploaded, 2);
  assert.equal(j.skipped, 1);
  assert.deepEqual(j.inflight, []);
  assert.deepEqual(fs.readdirSync(root), ['job.json']);
});

test('upload failure pauses without committing uncertain delivery', async t => {
  const { root, run } = fixture(t);
  const j = job();
  await run(j, { client: makeClient(true) });
  assert.equal(j.status, 'paused');
  assert.equal(j.cursor, 0);
  assert.deepEqual(j.inflight, [1]);
  assert.deepEqual(fs.readdirSync(root), ['job.json']);
});
