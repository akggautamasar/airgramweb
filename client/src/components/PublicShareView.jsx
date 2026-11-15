import React, { useEffect, useState } from 'react';
import {
  Lock,
  Download,
  Play,
  FileText,
  Film,
  Music,
  Image as ImageIcon,
  Loader2,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { apiFetch, formatBytes, formatDuration } from '../api';
import VideoPlayerModal from './VideoPlayerModal';
import PdfModal from './PdfModal';
import EpubModal from './EpubModal';
import PhotoModal from './PhotoModal';

export default function PublicShareView({ shareId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  const [password, setPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockToken, setUnlockToken] = useState('');
  const [mode, setMode] = useState('fast_web');

  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/share/${encodeURIComponent(shareId)}`)
      .then((data) => {
        setInfo(data);
        setError('');
      })
      .catch((err) => setError(err.message || 'Share link not found or expired'))
      .finally(() => setLoading(false));
  }, [shareId]);

  const handleUnlock = async (e) => {
    e.preventDefault();
    setUnlocking(true);
    setError('');
    try {
      const data = await apiFetch(`/api/share/${encodeURIComponent(shareId)}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setUnlockToken(data.unlockToken);
    } catch (err) {
      setError(err.message || 'Incorrect password');
    } finally {
      setUnlocking(false);
    }
  };

  if (loading) {
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Loader2 size={24} className="spin" color="#00bfd8" />
        <span>Loading shared file...</span>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <img src="/airgram-icon.svg" alt="AirGram" style={{ width: 52, height: 52, borderRadius: 14, marginBottom: 14 }} />
        <h2 style={{ margin: '0 0 8px' }}>Link Unavailable</h2>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>{error}</p>
      </div>
    );
  }

  const locked = info.requiresPassword && !unlockToken;
  const stParam = unlockToken ? `&st=${encodeURIComponent(unlockToken)}` : '';
  const streamSrc = `/api/share/${encodeURIComponent(shareId)}/stream?mode=${mode}${stParam}`;
  const downloadSrc = `/api/share/${encodeURIComponent(shareId)}/stream?mode=telegram_hq&download=1${stParam}`;
  const thumbSrc = `/api/share/${encodeURIComponent(shareId)}/thumb${unlockToken ? `?st=${encodeURIComponent(unlockToken)}` : ''}`;
  const fullThumbSrc = `/api/share/${encodeURIComponent(shareId)}/thumb?full=1${stParam}`;
  const playlistSrc = `/api/share/${encodeURIComponent(shareId)}/playlist.m3u${unlockToken ? `?st=${encodeURIComponent(unlockToken)}` : ''}`;

  const meta = info.meta;
  const isPdf = meta.mimeType === 'application/pdf' || meta.fileName?.toLowerCase().endsWith('.pdf');
  const isEpub = meta.mimeType === 'application/epub+zip' || meta.fileName?.toLowerCase().endsWith('.epub');
  const canPreview = meta.kind === 'video' || meta.kind === 'photo' || isPdf || isEpub;

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'radial-gradient(circle at 50% 0%, rgba(51, 71, 216, 0.2), transparent 55%), var(--bg)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 22,
          padding: 24,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <img src="/airgram-icon.svg" alt="AirGram" style={{ width: 34, height: 34, borderRadius: 9 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>AirGram Shared File</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Clock size={11} />
              {info.expiresAt ? `Expires ${new Date(info.expiresAt).toLocaleString()}` : 'Lifetime Access'}
            </div>
          </div>
        </div>

        {locked ? (
          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13.5 }}>
              <Lock size={16} color="#38bdf8" /> This shared file is password protected.
            </div>
            {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
            <input
              type="password"
              className="input"
              placeholder="Enter password to unlock"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={unlocking}>
              {unlocking ? <Loader2 size={16} className="spin" /> : 'Unlock File'}
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 14,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                {meta.kind === 'video' ? <Film size={22} /> : meta.kind === 'audio' ? <Music size={22} /> : meta.kind === 'photo' ? <ImageIcon size={22} /> : <FileText size={22} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5, wordBreak: 'break-word' }}>{meta.title || meta.fileName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {formatBytes(meta.size)}
                  {meta.duration > 0 ? ` · ${formatDuration(meta.duration)}` : ''}
                </div>
              </div>
            </div>

            {meta.kind === 'audio' && (
              <audio controls src={streamSrc} style={{ width: '100%' }} />
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canPreview && (
                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => setViewerOpen(true)}>
                  <Play size={15} fill="#fff" /> {meta.kind === 'video' ? 'Stream Video' : isPdf ? 'Open PDF' : isEpub ? 'Read EPUB' : 'View Photo'}
                </button>
              )}
              <a href={downloadSrc} className="btn" style={{ flex: canPreview ? undefined : 1, textDecoration: 'none' }}>
                <Download size={15} /> Download
              </a>
              {meta.kind === 'video' && (
                <a
                  href={`vlc://${new URL(streamSrc, window.location.origin).href}`}
                  className="btn btn-amber"
                  style={{ textDecoration: 'none' }}
                >
                  <ExternalLink size={14} /> VLC
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inline Viewers for Public Share */}
      {viewerOpen && meta.kind === 'video' && (
        <VideoPlayerModal
          item={meta}
          mode={mode}
          onModeChange={setMode}
          onClose={() => setViewerOpen(false)}
          customStreamUrl={streamSrc}
          customPlaylistUrl={playlistSrc}
          isPublicShare
        />
      )}
      {viewerOpen && isPdf && (
        <PdfModal
          item={meta}
          mode={mode}
          onClose={() => setViewerOpen(false)}
          customPdfUrl={streamSrc}
          customDownloadUrl={downloadSrc}
          isPublicShare
        />
      )}
      {viewerOpen && isEpub && (
        <EpubModal
          item={meta}
          mode={mode}
          onClose={() => setViewerOpen(false)}
          customEpubUrl={streamSrc}
          customDownloadUrl={downloadSrc}
          isPublicShare
        />
      )}
      {viewerOpen && meta.kind === 'photo' && (
        <PhotoModal
          item={meta}
          onClose={() => setViewerOpen(false)}
          customThumbUrl={thumbSrc}
          customFullUrl={fullThumbSrc}
          customDownloadUrl={downloadSrc}
        />
      )}
    </div>
  );
}
