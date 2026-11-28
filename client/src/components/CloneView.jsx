import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api';

function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fmtSpeed(bps) {
  if (!bps || bps < 1) return '—';
  return `${fmtBytes(bps)}/s`;
}

export default function CloneView({ chats, selectedChat, onClose }) {
  const [source, setSource] = useState(String(selectedChat?.id || ''));
  const [destination, setDestination] = useState('me');
  const [mode, setMode] = useState('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [types, setTypes] = useState(['photo', 'video', 'audio', 'pdf', 'document', 'text', 'other']);
  const [fallback, setFallback] = useState(true);
  const [forceReupload, setForceReupload] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [limits, setLimits] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  const idFromLink = (v) => {
    const m = String(v)
      .trim()
      .match(/^https:\/\/t\.me\/(?:c\/\d+|[A-Za-z0-9_]+)\/(\d+)\/?$/);
    return m ? m[1] : String(v).trim();
  };

  const refresh = () =>
    apiFetch('/api/clone/jobs')
      .then((r) => {
        setJobs(r.jobs || []);
        if (r.limits) setLimits(r.limits);
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  const act = async (url, body) => {
    setBusy(true);
    setError('');
    try {
      await apiFetch(url, { method: 'POST', body: JSON.stringify(body || {}) });
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const field = { display: 'grid', gap: 6, marginBottom: 12, minWidth: 0 };
  const options = chats
    .filter(
      (c) =>
        !search ||
        String(c.title).toLowerCase().includes(search.toLowerCase()) ||
        [source, destination].includes(String(c.id))
    )
    .map((c) => (
      <option key={c.id} value={String(c.id)}>
        {c.title}
      </option>
    ));

  const progressLine = (j) => {
    const p = j.progress || {};
    if (p.floodWait) return `⏳ Flood wait ${p.floodWait}s`;
    if (p.phase === 'download' || p.phase === 'upload') {
      const pct = p.total ? Math.min(100, Math.round((100 * (p.bytes || 0)) / p.total)) : 0;
      return `${p.note || p.phase} · ${pct}% · ${fmtSpeed(p.speed)}`;
    }
    if (p.done != null && p.total != null) return `${p.note || ''} · ${p.done}/${p.total}`;
    return p.note || j.status;
  };

  return (
    <div className="modal-backdrop" style={{ padding: 12, boxSizing: 'border-box' }}>
      <section
        style={{
          background: 'var(--bg, #18212b)',
          color: 'var(--text, #eee)',
          width: 'min(640px, 100%)',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          maxHeight: '85dvh',
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: 16,
          borderRadius: 16,
          overflowWrap: 'anywhere',
        }}
      >
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>AirGram Fast Cloner</h2>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <p style={{ opacity: 0.85, fontSize: 13, marginTop: 8 }}>
          Forward mode is fastest for open chats. <strong>Re-upload mode</strong> downloads and
          re-sends media (parallel + in-memory) so it works on restricted content you can view —
          same approach as AirSaver.
        </p>

        {limits && (
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Engine: up to {limits.parallel} pending files · {limits.ulWorkers} upload workers ·
            in-mem ≤{limits.inmemMb}MB · max {limits.maxFileMb}MB
          </p>
        )}

        <label style={field}>
          Search chats
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter…" />
        </label>

        <label style={field}>
          Source chat
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">Select…</option>
            {options}
          </select>
        </label>

        <label style={field}>
          Destination
          <select value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="me">Saved Messages</option>
            {options}
          </select>
        </label>

        <label style={field}>
          Range
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="all">All messages</option>
            <option value="from">From message ID / link</option>
            <option value="range">Message ID range</option>
          </select>
        </label>

        {mode !== 'all' && (
          <label style={field}>
            Start (ID or t.me link)
            <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="123 or https://t.me/c/…/123" />
          </label>
        )}
        {mode === 'range' && (
          <label style={field}>
            End (ID or t.me link)
            <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="456" />
          </label>
        )}

        <div style={{ ...field, gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))' }}>
          {['photo', 'video', 'audio', 'pdf', 'document', 'text', 'other'].map((t) => (
            <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={types.includes(t)}
                onChange={(e) =>
                  setTypes((old) => (e.target.checked ? [...old, t] : old.filter((x) => x !== t)))
                }
              />
              {t}
            </label>
          ))}
        </div>

        <label style={field}>
          <span>
            <input
              type="checkbox"
              checked={forceReupload}
              onChange={(e) => setForceReupload(e.target.checked)}
            />{' '}
            <strong>Re-upload mode (restricted / protected content)</strong> — download + re-send
            instead of forward. Use when source blocks forwards.
          </span>
        </label>

        {!forceReupload && (
          <label style={field}>
            <span>
              <input type="checkbox" checked={fallback} onChange={(e) => setFallback(e.target.checked)} />{' '}
              Fallback: re-upload on media errors (FILE_REFERENCE_EXPIRED etc.)
            </span>
          </label>
        )}

        <label style={field}>
          <span>
            <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />{' '}
            I have permission to copy this content.
          </span>
        </label>

        <p style={{ fontSize: 12, opacity: 0.75 }}>
          Jobs run on the server. Only one active job at a time. Pause applies after the current
          transfer. Protected content requires Re-upload mode and a session that can view the
          messages.
        </p>

        <button
          className="btn"
          disabled={
            busy ||
            !source ||
            !authorized ||
            !types.length ||
            (mode !== 'all' && !start) ||
            (mode === 'range' && !end)
          }
          onClick={() =>
            act('/api/clone/jobs', {
              source,
              destination,
              start: mode === 'all' ? null : idFromLink(start),
              end: mode === 'range' ? idFromLink(end) : null,
              types,
              fallback,
              forceReupload,
              mode: forceReupload ? 'reupload' : 'forward',
              authorized,
            })
          }
        >
          Start {forceReupload ? 're-upload clone' : 'forward clone'}
        </button>

        {error && (
          <p role="alert" style={{ color: '#f87171' }}>
            {error}
          </p>
        )}

        <h3>Jobs</h3>
        {jobs
          .slice()
          .reverse()
          .map((j) => (
            <article
              key={j.id}
              style={{
                border: '1px solid #64748b',
                borderRadius: 10,
                padding: 12,
                marginTop: 10,
              }}
            >
              <strong>
                {chats.find((c) => String(c.id) === j.source)?.title || j.source} →{' '}
                {j.destination === 'me'
                  ? 'Saved Messages'
                  : chats.find((c) => String(c.id) === j.destination)?.title || j.destination}
              </strong>
              <p style={{ margin: '4px 0', fontSize: 13 }}>
                <span
                  style={{
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    color:
                      j.status === 'running'
                        ? '#34d399'
                        : j.status === 'completed'
                          ? '#60a5fa'
                          : j.status === 'blocked'
                            ? '#f87171'
                            : '#fbbf24',
                  }}
                >
                  {j.status}
                </span>
                {' · '}
                mode {j.mode || (j.forceReupload ? 'reupload' : 'forward')} · IDs {j.start}–
                {j.end ?? 'latest'} · cursor {j.cursor}
              </p>
              <p style={{ margin: '4px 0', fontSize: 13 }}>
                Forwarded {j.forwarded} · Re-uploaded {j.uploaded} · Skipped {j.skipped}
              </p>
              {j.status === 'running' && (
                <div style={{ margin: '4px 0', fontSize: 12, opacity: 0.9 }}>
                  <p style={{ margin: '4px 0' }}>{progressLine(j)} · per-file</p>
                  <p style={{ margin: '4px 0', fontWeight: 600 }}>
                    Aggregate payload: {j.metrics && Date.now() - j.metrics.updatedAt < 6000
                      ? `↓ ${fmtSpeed(j.metrics.downloadBps)} · ↑ ${fmtSpeed(j.metrics.uploadBps)}`
                      : 'No recent sample'}
                  </p>
                  {j.progressAgeSec >= 60 && (
                    <p style={{ margin: '4px 0', color: '#fbbf24' }}>
                      No progress update for {j.progressAgeSec}s. The operation may be waiting.
                    </p>
                  )}
                </div>
              )}
              {j.error && (
                <p style={{ color: '#f87171', fontSize: 13 }}>{j.error}</p>
              )}
              {j.inflight?.length > 0 && j.status === 'paused' && (
                <p style={{ fontSize: 12 }}>Delivery uncertain: inspect destination before restarting.</p>
              )}
              {j.status === 'blocked' && (
                <p style={{ fontSize: 12 }}>
                  Source restricts saving. Enable <strong>Re-upload mode</strong> if your account can
                  view the messages, or ask the owner for an authorized copy.
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {['running', 'paused', 'blocked'].includes(j.status) && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act('/api/clone/jobs/' + j.id + '/cancel')}
                  >
                    Cancel
                  </button>
                )}
                {j.status === 'running' && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act('/api/clone/jobs/' + j.id + '/pause')}
                  >
                    Pause
                  </button>
                )}
                {j.status === 'paused' &&
                  !j.inflight?.length &&
                  !/protected content|CHAT_FORWARDS_RESTRICTED/i.test(j.error || '') && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => act('/api/clone/jobs/' + j.id + '/resume')}
                    >
                      Resume
                    </button>
                  )}
                {j.status !== 'running' && (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Delete this job record? Transferred messages will remain.')) {
                        act('/api/clone/jobs/' + j.id + '/delete');
                      }
                    }}
                  >
                    Delete job
                  </button>
                )}
              </div>
            </article>
          ))}
      </section>
    </div>
  );
}
