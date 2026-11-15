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
  Folder,
  Archive,
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

  const [activeIdx, setActiveIdx] = useState(null); // index into items list when viewing

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
        <span>Loading shared content...</span>
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
  const stOnly = unlockToken ? `?st=${encodeURIComponent(unlockToken)}` : '';
  const itemsList = info.isCollection && Array.isArray(info.items) ? info.items : [info.meta];
  const totalBytes = itemsList.reduce((acc, m) => acc + Number(m.size || 0), 0);

  const getUrls = (idx) => ({
    streamSrc: `/api/share/${encodeURIComponent(shareId)}/stream?idx=${idx}&mode=${mode}${stParam}`,
    downloadSrc: `/api/share/${encodeURIComponent(shareId)}/stream?idx=${idx}&mode=telegram_hq&download=1${stParam}`,
    thumbSrc: `/api/share/${encodeURIComponent(shareId)}/thumb?idx=${idx}${stParam}`,
    fullThumbSrc: `/api/share/${encodeURIComponent(shareId)}/thumb?idx=${idx}&full=1${stParam}`,
    playlistSrc: `/api/share/${encodeURIComponent(shareId)}/playlist.m3u?idx=${idx}${stParam}`,
  });

  const activeMeta = activeIdx !== null ? itemsList[activeIdx] : null;
  const activeUrls = activeIdx !== null ? getUrls(activeIdx) : null;
  const activeIsPdf = activeMeta && (activeMeta.mimeType === 'application/pdf' || activeMeta.fileName?.toLowerCase().endsWith('.pdf'));
  const activeIsEpub = activeMeta && (activeMeta.mimeType === 'application/epub+zip' || activeMeta.fileName?.toLowerCase().endsWith('.epub'));

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
          maxWidth: info.isCollection ? 680 : 480,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 22,
          padding: 24,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/airgram-icon.svg" alt="AirGram" style={{ width: 34, height: 34, borderRadius: 9 }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>
                {info.isCollection ? info.title || 'AirGram Shared Folder' : 'AirGram Shared File'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Clock size={11} />
                {info.expiresAt ? `Expires ${new Date(info.expiresAt).toLocaleString()}` : 'Lifetime Access'}
                {info.isCollection && ` · ${itemsList.length} files (${formatBytes(totalBytes)})`}
              </div>
            </div>
          </div>

          {!locked && info.isCollection && (
            <a
              href={`/api/share/${encodeURIComponent(shareId)}/zip${stOnly}`}
              className="btn btn-primary"
              style={{ textDecoration: 'none', padding: '7px 13px', fontSize: 12.5 }}
            >
              <Archive size={14} /> Download All (.zip)
            </a>
          )}
        </div>

        {locked ? (
          <form onSubmit={handleUnlock} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13.5 }}>
              <Lock size={16} color="#38bdf8" /> This shared {info.isCollection ? 'folder' : 'file'} is password protected.
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
              {unlocking ? <Loader2 size={16} className="spin" /> : 'Unlock'}
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '70vh', overflowY: 'auto' }}>
            {itemsList.map((meta, idx) => {
              const urls = getUrls(idx);
              const isPdf = meta.mimeType === 'application/pdf' || meta.fileName?.toLowerCase().endsWith('.pdf');
              const isEpub = meta.mimeType === 'application/epub+zip' || meta.fileName?.toLowerCase().endsWith('.epub');
              const canPreview = meta.kind === 'video' || meta.kind === 'photo' || isPdf || isEpub;

              return (
                <div
                  key={`${meta.chatId}_${meta.id}_${idx}`}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 11,
                        background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      {meta.kind === 'video' ? (
                        <Film size={20} />
                      ) : meta.kind === 'audio' ? (
                        <Music size={20} />
                      ) : meta.kind === 'photo' ? (
                        <ImageIcon size={20} />
                      ) : (
                        <FileText size={20} />
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, wordBreak: 'break-word' }}>{meta.title || meta.fileName}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {formatBytes(meta.size)}
                        {meta.duration > 0 ? ` · ${formatDuration(meta.duration)}` : ''}
                      </div>
                    </div>
                  </div>

                  {meta.kind === 'audio' && <audio controls src={urls.streamSrc} style={{ width: '100%' }} />}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {canPreview && (
                      <button type="button" className="btn btn-primary" style={{ flex: 1, padding: '7px 12px', fontSize: 12.5 }} onClick={() => setActiveIdx(idx)}>
                        <Play size={14} fill="#fff" />{' '}
                        {meta.kind === 'video' ? 'Stream Video' : isPdf ? 'Open PDF' : isEpub ? 'Read EPUB' : 'View Photo'}
                      </button>
                    )}
                    <a href={urls.downloadSrc} className="btn" style={{ padding: '7px 12px', fontSize: 12.5, textDecoration: 'none' }}>
                      <Download size={14} /> Download
                    </a>
                    {meta.kind === 'video' && (
                      <a
                        href={`vlc://${new URL(urls.streamSrc, window.location.origin).href}`}
                        className="btn btn-amber"
                        style={{ padding: '7px 12px', fontSize: 12.5, textDecoration: 'none' }}
                      >
                        <ExternalLink size={13} /> VLC
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline Viewers */}
      {activeMeta && activeUrls && activeMeta.kind === 'video' && (
        <VideoPlayerModal
          item={activeMeta}
          mode={mode}
          onModeChange={setMode}
          onClose={() => setActiveIdx(null)}
          customStreamUrl={activeUrls.streamSrc}
          customPlaylistUrl={activeUrls.playlistSrc}
          isPublicShare
        />
      )}
      {activeMeta && activeUrls && activeIsPdf && (
        <PdfModal
          item={activeMeta}
          mode={mode}
          onClose={() => setActiveIdx(null)}
          customPdfUrl={activeUrls.streamSrc}
          customDownloadUrl={activeUrls.downloadSrc}
          isPublicShare
        />
      )}
      {activeMeta && activeUrls && activeIsEpub && (
        <EpubModal
          item={activeMeta}
          mode={mode}
          onClose={() => setActiveIdx(null)}
          customEpubUrl={activeUrls.streamSrc}
          customDownloadUrl={activeUrls.downloadSrc}
          isPublicShare
        />
      )}
      {activeMeta && activeUrls && activeMeta.kind === 'photo' && (
        <PhotoModal
          item={activeMeta}
          onClose={() => setActiveIdx(null)}
          customThumbUrl={activeUrls.thumbSrc}
          customFullUrl={activeUrls.fullThumbSrc}
          customDownloadUrl={activeUrls.downloadSrc}
        />
      )}
    </div>
  );
}
