import React, { useState } from 'react';
import { X, Share2, Lock, Clock, Copy, Check, ExternalLink, Loader2, Folder } from 'lucide-react';
import { apiFetch, formatBytes } from '../api';

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Lifetime (Never Expires)' },
  { value: 1, label: '1 Hour' },
  { value: 24, label: '24 Hours' },
  { value: 168, label: '7 Days' },
  { value: 720, label: '30 Days' },
];

export default function ShareModal({ item, onClose }) {
  const isCollection = Boolean(item?.isCollection && Array.isArray(item?.items));
  const [title, setTitle] = useState(
    isCollection ? `Shared Folder (${item.items.length} files)` : ''
  );
  const [password, setPassword] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!item) return null;

  const totalSize = isCollection
    ? item.items.reduce((acc, x) => acc + Number(x.size || 0), 0)
    : item.size;

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = isCollection
        ? {
            items: item.items.map((x) => ({ chatId: x.chatId, msgId: x.id })),
            title: title.trim() || `Shared Folder (${item.items.length} files)`,
            password: password.trim(),
            expiresInHours: Number(expiresInHours),
          }
        : {
            chatId: item.chatId,
            msgId: item.id,
            password: password.trim(),
            expiresInHours: Number(expiresInHours),
          };

      const data = await apiFetch('/api/share', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setCreated(data);
    } catch (err) {
      setError(err.message || 'Could not create share link');
    } finally {
      setLoading(false);
    }
  };

  const copyLink = async () => {
    if (!created?.shareUrl) return;
    await navigator.clipboard.writeText(created.shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Share2 size={18} color="#00bfd8" />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              {isCollection ? 'Share Folder / Collection' : 'Share File Link'}
            </h2>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isCollection ? `${item.items.length} selected files` : item.title || item.fileName}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {isCollection ? 'COLLECTION' : item.kind.toUpperCase()} · {formatBytes(totalSize)}
          </div>
        </div>

        {error && (
          <div
            style={{
              marginBottom: 14,
              padding: '9px 12px',
              borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.14)',
              color: '#fca5a5',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!created ? (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isCollection && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <Folder size={13} /> Folder / Playlist Title
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Power Electronics Lectures"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                <Lock size={13} /> Password Protection (Optional)
              </label>
              <input
                type="text"
                className="input"
                placeholder="Leave blank for no password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                <Clock size={13} /> Link Expiration
              </label>
              <select
                className="input"
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(Number(e.target.value))}
              >
                {EXPIRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="spin" /> : 'Generate Share Link'}
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Anyone with this link can stream, view, or download{' '}
              {isCollection ? 'all files in this folder' : 'this file'}
              {created.requiresPassword ? ' after entering your password' : ''}.
            </div>
            <input
              type="text"
              readOnly
              className="input"
              value={created.shareUrl}
              onClick={(e) => e.currentTarget.select()}
              style={{ fontFamily: 'monospace', fontSize: 12.5 }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={copyLink}>
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              <a
                href={created.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={15} /> Open
              </a>
            </div>
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12.5 }} onClick={() => setCreated(null)}>
              Create Another Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
