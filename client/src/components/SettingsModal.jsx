import React, { useEffect, useState } from 'react';
import { X, Trash2, Copy, Check, LogOut, Activity } from 'lucide-react';
import { apiFetch } from '../api';

export default function SettingsModal({ prefs, onUpdatePrefs, sessionString, onLogout, onClose }) {
  const [diag, setDiag] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const loadDiag = async () => {
    try {
      const data = await apiFetch('/api/diagnostics');
      setDiag(data);
    } catch {}
  };

  useEffect(() => {
    loadDiag();
  }, []);

  const clearCache = async () => {
    const res = await apiFetch('/api/cache/clear', { method: 'POST' });
    if (res.diagnostics) setDiag(res.diagnostics);
  };

  const copySession = async () => {
    if (!sessionString) return;
    await navigator.clipboard.writeText(sessionString);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 540,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: 24,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>AirGram Settings & Diagnostics</h2>
          <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Theme */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Theme</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Appearance across browser & player</div>
            </div>
            <select
              className="input"
              style={{ width: 130, padding: '7px 10px' }}
              value={prefs.theme}
              onChange={(e) => onUpdatePrefs({ ...prefs, theme: e.target.value })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          {/* Default Streaming Mode */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Default Streaming Mode</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Fast Web optimizes for slow internet</div>
            </div>
            <select
              className="input"
              style={{ width: 150, padding: '7px 10px' }}
              value={prefs.streamingMode}
              onChange={(e) => onUpdatePrefs({ ...prefs, streamingMode: e.target.value })}
            >
              <option value="fast_web">Fast Web</option>
              <option value="telegram_hq">Telegram HQ</option>
            </select>
          </div>

          {/* Thumbnails */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Load Media Thumbnails</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Disable on very slow connections</div>
            </div>
            <input
              type="checkbox"
              checked={prefs.loadThumbnails}
              onChange={(e) => onUpdatePrefs({ ...prefs, loadThumbnails: e.target.checked })}
            />
          </label>

          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>Suspend Thumbnails While Playing</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Saves bandwidth for instant video playback</div>
            </div>
            <input
              type="checkbox"
              checked={prefs.suspendThumbsOnPlay}
              onChange={(e) => onUpdatePrefs({ ...prefs, suspendThumbsOnPlay: e.target.checked })}
            />
          </label>

          {/* Diagnostics Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 14,
              marginTop: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13.5 }}>
                <Activity size={15} color="#00bfd8" /> Streaming Diagnostics
              </span>
              <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={clearCache}>
                <Trash2 size={13} /> Clear Cache
              </button>
            </div>
            {diag ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
                <div>Cache Used: <strong style={{ color: 'var(--text)' }}>{diag.cacheUsedMb} / {diag.cacheMaxMb} MB</strong></div>
                <div>Cache Hit Rate: <strong style={{ color: 'var(--text)' }}>{diag.cacheHitRate}%</strong></div>
                <div>Est. Throughput: <strong style={{ color: 'var(--text)' }}>{diag.estimatedMbps} Mbps</strong></div>
                <div>Total Served: <strong style={{ color: 'var(--text)' }}>{diag.totalServedMb} MB</strong></div>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Loading diagnostics...</div>
            )}
          </div>

          {/* Session Key & Logout */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 6 }}>
            <button type="button" className="btn" style={{ flex: 1 }} onClick={copySession}>
              {copiedKey ? <Check size={15} /> : <Copy size={15} />}
              {copiedKey ? 'Session Key Copied' : 'Copy Session Key'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.35)' }}
              onClick={onLogout}
            >
              <LogOut size={15} /> Logout
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
