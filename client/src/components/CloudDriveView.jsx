import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  FolderUp,
  Upload,
  RefreshCw,
  Download,
  FileSpreadsheet,
  Image as ImageIcon,
  Film,
  FileText,
  Music,
  PhoneCall,
  Folder,
  CheckCircle2,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  X,
  History,
  Archive,
  Loader2,
  Menu,
  Share2,
} from 'lucide-react';
import { apiFetch, formatBytes, formatDate, formatDuration, streamUrl } from '../api';

const CAT_META = [
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Film },
  { id: 'pdfs', label: 'PDFs', icon: FileText },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'call_recordings', label: 'Call Recordings', icon: PhoneCall },
  { id: 'other', label: 'Other', icon: Folder },
];

async function computeFileHash(file) {
  if (!window.crypto?.subtle || file.size > 150 * 1024 * 1024) {
    // Fast deterministic fingerprint for very large files
    return `fast_${file.size}_${file.lastModified}_${file.name}`;
  }
  const buf = await file.arrayBuffer();
  const digest = await window.crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function CloudDriveView({
  chats = [],
  prefs,
  onOpenItem,
  onShareItem,
  onOpenMobileChats,
}) {
  const folderInputRef = useRef(null);
  const filesInputRef = useRef(null);
  const pausedRef = useRef(false);
  const runningRef = useRef(false);

  const [config, setConfig] = useState({
    channels: { photos: '', videos: '', pdfs: '', documents: '', audio: '', call_recordings: '', other: '' },
    captionTemplate: '{name} | {category} | {size} | {date}',
  });
  const [drive, setDrive] = useState({ stats: {}, items: [], totalCount: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const [activeCat, setActiveCat] = useState('all');
  const [galleryMode, setGalleryMode] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [zipping, setZipping] = useState(false);
  const [versionModalItem, setVersionModalItem] = useState(null);

  // Scanner & Live Upload Queue State
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState(null); // { scanned, skipped, queued }
  const [queue, setQueue] = useState([]); // [{ id, file, relPath, sha256, status: 'pending'|'uploading'|'done'|'failed', progress, error }]
  const [paused, setPaused] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [cfg, drv] = await Promise.all([
        apiFetch('/api/backup/config'),
        apiFetch('/api/backup/drive'),
      ]);
      setConfig(cfg);
      setDrive(drv);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleSaveConfig = async (e) => {
    e.preventDefault();
    const updated = await apiFetch('/api/backup/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    setConfig(updated);
    setConfigOpen(false);
  };

  const handleSyncChannels = async () => {
    setSyncing(true);
    try {
      const res = await apiFetch('/api/backup/sync-channels', { method: 'POST' });
      if (res.drive) setDrive(res.drive);
    } finally {
      setSyncing(false);
    }
  };

  // Scan folder / files -> compute hashes -> deduplicate -> start live queue
  const processSelectedFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => f.size > 0);
    if (files.length === 0) return;

    setScanning(true);
    setScanSummary(null);

    const hashed = [];
    for (const file of files) {
      const sha256 = await computeFileHash(file);
      hashed.push({
        file,
        name: file.name,
        size: file.size,
        relPath: file.webkitRelativePath || file.name,
        sha256,
      });
    }

    let dupMap = new Map();
    try {
      const res = await apiFetch('/api/backup/check-duplicates', {
        method: 'POST',
        body: JSON.stringify({
          files: hashed.map((h) => ({ name: h.name, size: h.size, sha256: h.sha256 })),
        }),
      });
      (res.results || []).forEach((r, idx) => {
        dupMap.set(idx, r.alreadyUploaded);
      });
    } catch {}

    const newJobs = [];
    let skipped = 0;
    hashed.forEach((h, idx) => {
      if (dupMap.get(idx)) {
        skipped += 1;
      } else {
        newJobs.push({
          id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          file: h.file,
          relPath: h.relPath,
          sha256: h.sha256,
          status: 'pending',
          progress: 0,
          error: '',
        });
      }
    });

    setScanSummary({ scanned: files.length, skipped, queued: newJobs.length });
    setQueue((prev) => [...prev, ...newJobs]);
    setScanning(false);
  };

  // Queue Runner
  useEffect(() => {
    if (paused || runningRef.current) return;
    const nextIdx = queue.findIndex((j) => j.status === 'pending');
    if (nextIdx === -1) return;

    runningRef.current = true;
    const job = queue[nextIdx];

    setQueue((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: 'uploading', progress: 0 } : j))
    );

    const uploadOne = () =>
      new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('file', job.file);
        form.append('sha256', job.sha256);
        form.append('relPath', job.relPath);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/backup/upload');
        xhr.withCredentials = true;
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100);
            setQueue((prev) => prev.map((j) => (j.id === job.id ? { ...j, progress: pct } : j)));
          }
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText || '{}');
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(data.error || `HTTP ${xhr.status}`));
          } catch (e) {
            reject(e);
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(form);
      });

    uploadOne()
      .then(() => {
        setQueue((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, status: 'done', progress: 100 } : j))
        );
        apiFetch('/api/backup/drive').then(setDrive).catch(() => {});
      })
      .catch((err) => {
        setQueue((prev) =>
          prev.map((j) =>
            j.id === job.id ? { ...j, status: 'failed', error: err.message || 'Failed' } : j
          )
        );
      })
      .finally(() => {
        runningRef.current = false;
      });
  }, [queue, paused]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (drive.items || []).filter((it) => {
      if (activeCat !== 'all' && it.category !== activeCat) return false;
      if (galleryMode && it.category !== 'photos' && it.category !== 'videos') return false;
      if (q && !String(it.fileName).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [drive.items, activeCat, galleryMode, search]);

  // Month-grouped Gallery buckets
  const galleryGroups = useMemo(() => {
    if (!galleryMode) return [];
    const map = new Map();
    for (const it of filteredItems) {
      const d = it.date ? new Date(it.date * 1000) : new Date();
      const label = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(it);
    }
    return Array.from(map.entries());
  }, [filteredItems, galleryMode]);

  const toggleSelect = (item) => {
    const key = `${item.chatId}_${item.id}`;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleBulkZip = async () => {
    if (selectedKeys.size === 0 || zipping) return;
    setZipping(true);
    try {
      const selectedItems = (drive.items || [])
        .filter((it) => selectedKeys.has(`${it.chatId}_${it.id}`))
        .map((it) => ({ chatId: it.chatId, msgId: it.id }));

      const res = await fetch('/api/bulk-zip', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedItems }),
      });
      if (!res.ok) throw new Error('Zip download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'airgram-bundle.zip';
      a.click();
      URL.revokeObjectURL(url);
      setSelectedKeys(new Set());
    } finally {
      setZipping(false);
    }
  };

  const qStats = {
    done: queue.filter((j) => j.status === 'done').length,
    failed: queue.filter((j) => j.status === 'failed').length,
    remaining: queue.filter((j) => j.status === 'pending' || j.status === 'uploading').length,
    current: queue.find((j) => j.status === 'uploading'),
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
      {/* Header */}
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" className="btn mobile-only" style={{ padding: 8 }} onClick={onOpenMobileChats}>
            <Menu size={18} />
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Cloud size={20} color="#00bfd8" /> Cloud Drive (7-Channel Backup)
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {drive.totalCount} indexed files across your backup channels
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            ref={folderInputRef}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              processSelectedFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={filesInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              processSelectedFiles(e.target.files);
              e.target.value = '';
            }}
          />

          <button type="button" className="btn btn-primary" onClick={() => folderInputRef.current?.click()} disabled={scanning}>
            {scanning ? <Loader2 size={15} className="spin" /> : <FolderUp size={15} />}
            Scan Folder
          </button>
          <button type="button" className="btn" onClick={() => filesInputRef.current?.click()} disabled={scanning}>
            <Upload size={15} /> Upload Files
          </button>
          <button type="button" className="btn" onClick={handleSyncChannels} disabled={syncing} title="Sync index from your 7 Telegram channels">
            <RefreshCw size={15} className={syncing ? 'spin' : ''} />
            <span className="desktop-only">Sync Channels</span>
          </button>
          <button type="button" className="btn" onClick={() => setConfigOpen(true)} title="Configure 7 Channels & Captions">
            <Settings2 size={15} />
            <span className="desktop-only">7 Channels</span>
          </button>
          <a href="/api/backup/export.csv" className="btn" style={{ textDecoration: 'none' }} title="Export CSV Manifest">
            <FileSpreadsheet size={15} />
          </a>
        </div>
      </header>

      {/* Main Scroll Area */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: 18 }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) processSelectedFiles(e.dataTransfer.files);
        }}
      >
        {/* Live Scan & Upload Queue Banner */}
        {(scanSummary || queue.length > 0) && (
          <div
            style={{
              marginBottom: 18,
              padding: 14,
              borderRadius: 14,
              background: 'var(--bg-card)',
              border: '1px solid rgba(0, 191, 216, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
                {qStats.remaining === 0 && queue.length > 0 ? (
                  <>
                    <CheckCircle2 size={17} color="#10b981" /> All uploads complete!
                  </>
                ) : (
                  <>
                    <Loader2 size={16} className="spin" color="#00bfd8" />
                    {qStats.current ? `Uploading: ${qStats.current.file.name} (${qStats.current.progress}%)` : 'Upload Queue Ready'}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span className="badge">{qStats.done} Uploaded</span>
                {scanSummary && <span className="badge">{scanSummary.skipped} Already Backed Up</span>}
                <span className="badge">{qStats.remaining} Remaining</span>
                {qStats.failed > 0 && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '4px 9px', fontSize: 11.5, color: '#fca5a5' }}
                    onClick={() =>
                      setQueue((prev) => prev.map((j) => (j.status === 'failed' ? { ...j, status: 'pending', error: '' } : j)))
                    }
                  >
                    <RotateCcw size={12} /> Retry {qStats.failed} Failed
                  </button>
                )}
                {qStats.remaining > 0 && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '4px 9px', fontSize: 11.5 }}
                    onClick={() => {
                      pausedRef.current = !paused;
                      setPaused(!paused);
                    }}
                  >
                    {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Resume' : 'Pause'}
                  </button>
                )}
                {qStats.remaining === 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: 4 }}
                    onClick={() => {
                      setQueue([]);
                      setScanSummary(null);
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {qStats.current && (
              <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(148,163,184,0.2)', overflow: 'hidden' }}>
                <div style={{ width: `${qStats.current.progress}%`, height: '100%', background: 'var(--cyan)', transition: 'width 0.15s' }} />
              </div>
            )}
          </div>
        )}

        {/* 7-Category Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(145px, 1fr))',
            gap: 10,
            marginBottom: 18,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveCat('all')}
            style={{
              padding: 12,
              borderRadius: 13,
              border: `1px solid ${activeCat === 'all' ? 'var(--cyan)' : 'var(--border)'}`,
              background: activeCat === 'all' ? 'rgba(0, 191, 216, 0.14)' : 'var(--bg-card)',
              color: 'var(--text)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>All Categories</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{drive.totalCount} files</div>
          </button>

          {CAT_META.map((c) => {
            const Icon = c.icon;
            const st = drive.stats?.[c.id] || { count: 0, size: 0 };
            const active = activeCat === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveCat(c.id)}
                style={{
                  padding: 12,
                  borderRadius: 13,
                  border: `1px solid ${active ? 'var(--cyan)' : 'var(--border)'}`,
                  background: active ? 'rgba(0, 191, 216, 0.14)' : 'var(--bg-card)',
                  color: 'var(--text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
                  <Icon size={14} color="#38bdf8" /> {c.label}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  {st.count} files · {formatBytes(st.size)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Filter & Bulk Action Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <input
            type="text"
            className="input"
            placeholder="Filter backed-up files..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 260, padding: '8px 12px', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn ${galleryMode ? 'btn-primary' : ''}`}
              onClick={() => setGalleryMode((g) => !g)}
            >
              <ImageIcon size={15} /> Month Gallery
            </button>
            {selectedKeys.size > 0 && (
              <button type="button" className="btn btn-primary" onClick={handleBulkZip} disabled={zipping}>
                {zipping ? <Loader2 size={15} className="spin" /> : <Archive size={15} />}
                Download Zip ({selectedKeys.size})
              </button>
            )}
          </div>
        </div>

        {/* Content: Month Gallery OR Unified File List */}
        {loading ? (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--text-muted)' }}>
            <Loader2 size={26} className="spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 60, color: 'var(--text-muted)', fontSize: 13.5 }}>
            No backed-up files indexed yet. Click <strong>7 Channels</strong> to configure your channels & <strong>Sync Channels</strong>, or click <strong>Scan Folder</strong> to upload!
          </div>
        ) : galleryMode ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {galleryGroups.map(([month, groupItems]) => (
              <div key={month}>
                <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700, color: 'var(--cyan)' }}>
                  {month} ({groupItems.length})
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  {groupItems.map((item) => (
                    <div
                      key={`${item.chatId}_${item.id}`}
                      onClick={() => onOpenItem(item)}
                      style={{
                        position: 'relative',
                        height: 150,
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: '#050811',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      <img
                        src={item.hasThumb ? `/api/thumb/${encodeURIComponent(item.chatId)}/${item.id}` : item.miniThumb || ''}
                        alt={item.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      {item.duration > 0 && (
                        <span
                          style={{
                            position: 'absolute',
                            right: 6,
                            bottom: 6,
                            background: 'rgba(0,0,0,0.78)',
                            color: '#fff',
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: 5,
                          }}
                        >
                          {formatDuration(item.duration)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredItems.map((item) => {
              const key = `${item.chatId}_${item.id}`;
              const checked = selectedKeys.has(key);
              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    background: 'var(--bg-card)',
                    border: `1px solid ${checked ? 'var(--cyan)' : 'var(--border)'}`,
                    borderRadius: 12,
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggleSelect(item)} />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpenItem(item)}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.fileName}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {item.category} · {formatBytes(item.size)} · {formatDate(item.date)}
                    </div>
                  </div>
                  {item.versionCount > 1 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '5px 9px', fontSize: 11.5 }}
                      onClick={() => setVersionModalItem(item)}
                      title="View File Version History"
                    >
                      <History size={13} /> v{item.versionCount}
                    </button>
                  )}
                  <button type="button" className="btn" style={{ padding: 7 }} onClick={() => onShareItem(item)} title="Share">
                    <Share2 size={14} />
                  </button>
                  <a
                    href={streamUrl(item.chatId, item.id, prefs.streamingMode, true)}
                    className="btn"
                    style={{ padding: 7, textDecoration: 'none' }}
                    title="Download"
                  >
                    <Download size={14} />
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 7-Channel Config Modal */}
      {configOpen && (
        <div className="modal-backdrop" onClick={() => setConfigOpen(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveConfig}
            style={{
              width: '100%',
              maxWidth: 520,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 20,
              padding: 24,
              maxHeight: '90vh',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>7-Channel Backup Destination</h3>
              <button type="button" className="btn btn-ghost" style={{ padding: 6 }} onClick={() => setConfigOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>
              Map each file category to one of your 7 Telegram channels (blank defaults to Saved Messages).
            </p>

            {CAT_META.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 600, minWidth: 120 }}>{c.label}</label>
                <select
                  className="input"
                  style={{ padding: '7px 10px', fontSize: 13 }}
                  value={config.channels?.[c.id] || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      channels: { ...prev.channels, [c.id]: e.target.value },
                    }))
                  }
                >
                  <option value="">Saved Messages (Default)</option>
                  {chats.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.title} ({ch.id})
                    </option>
                  ))}
                </select>
              </div>
            ))}

            <div>
              <label style={{ fontSize: 12.5, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Caption Template ({'{name} {category} {size} {date} {ext}'})
              </label>
              <input
                type="text"
                className="input"
                value={config.captionTemplate || ''}
                onChange={(e) => setConfig((prev) => ({ ...prev, captionTemplate: e.target.value }))}
              />
            </div>

            <button type="submit" className="btn btn-primary">
              Save 7-Channel Settings
            </button>
          </form>
        </div>
      )}

      {/* Version History Modal */}
      {versionModalItem && (
        <div className="modal-backdrop" onClick={() => setVersionModalItem(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 460,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: 22,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>File Version History</h3>
              <button type="button" className="btn btn-ghost" style={{ padding: 6 }} onClick={() => setVersionModalItem(null)}>
                <X size={17} />
              </button>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{versionModalItem.fileName}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(versionModalItem.versions || []).map((v, idx) => (
                <div
                  key={`${v.chatId}_${v.msgId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '9px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700 }}>Revision #{(versionModalItem.versions?.length || 1) - idx}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {formatBytes(v.size)} · {formatDate(v.date)}
                    </div>
                  </div>
                  <a
                    href={streamUrl(v.chatId, v.msgId, prefs.streamingMode, true)}
                    className="btn btn-primary"
                    style={{ padding: '5px 10px', fontSize: 12, textDecoration: 'none' }}
                  >
                    <Download size={13} /> Restore
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
