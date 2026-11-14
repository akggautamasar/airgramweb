import React, { useEffect, useRef, useState } from 'react';
import ePub from 'epubjs';
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
  Sun,
  Moon,
  BookOpen,
  Minus,
  Plus,
} from 'lucide-react';
import { formatBytes, getEpubCfi, setEpubCfi, streamUrl } from '../api';

const READER_THEMES = {
  dark: { bg: '#0b101d', fg: '#e2e8f0', label: 'Dark' },
  sepia: { bg: '#f4ecd8', fg: '#3b2f1e', label: 'Sepia' },
  light: { bg: '#ffffff', fg: '#0f172a', label: 'Light' },
};

export default function EpubModal({ item, mode = 'fast_web', onClose }) {
  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ loaded: 0, total: item?.size || 0 });
  const [error, setError] = useState('');
  const [toc, setToc] = useState([]);
  const [tocOpen, setTocOpen] = useState(false);
  const [readerTheme, setReaderTheme] = useState('dark');
  const [fontSize, setFontSize] = useState(110);
  const [chapterLabel, setChapterLabel] = useState('');

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const url = streamUrl(item.chatId, item.id, mode, false);

    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`Failed to load EPUB (${res.status})`);

        const total = Number(res.headers.get('Content-Length') || item.size || 0);
        const reader = res.body?.getReader();
        let buffer;

        if (reader) {
          const chunks = [];
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (cancelled) {
              reader.cancel();
              return;
            }
            chunks.push(value);
            received += value.length;
            setProgress({ loaded: received, total });
          }
          const merged = new Uint8Array(received);
          let offset = 0;
          for (const c of chunks) {
            merged.set(c, offset);
            offset += c.length;
          }
          buffer = merged.buffer;
        } else {
          buffer = await res.arrayBuffer();
        }

        if (cancelled || !viewerRef.current) return;

        const book = ePub(buffer);
        bookRef.current = book;

        const rendition = book.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
          spread: 'none',
          flow: 'paginated',
        });
        renditionRef.current = rendition;

        Object.entries(READER_THEMES).forEach(([k, v]) => {
          rendition.themes.register(k, {
            body: {
              background: `${v.bg} !important`,
              color: `${v.fg} !important`,
              'font-family': 'Inter, Georgia, serif !important',
              'line-height': '1.65 !important',
              padding: '12px 18px !important',
            },
            'a, a:link, a:visited': { color: '#38bdf8 !important' },
          });
        });

        rendition.themes.select(readerTheme);
        rendition.themes.fontSize(`${fontSize}%`);

        const savedCfi = getEpubCfi(item.chatId, item.id);
        await rendition.display(savedCfi || undefined);

        const nav = await book.loaded.navigation;
        if (!cancelled && nav?.toc) {
          setToc(nav.toc);
        }

        rendition.on('relocated', (loc) => {
          if (loc?.start?.cfi) {
            setEpubCfi(item.chatId, item.id, loc.start.cfi);
          }
        });

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not open EPUB');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        renditionRef.current?.destroy();
        bookRef.current?.destroy();
      } catch {}
    };
  }, [item?.chatId, item?.id]);

  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.select(readerTheme);
    }
  }, [readerTheme]);

  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.fontSize(`${fontSize}%`);
    }
  }, [fontSize]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') renditionRef.current?.next();
      else if (e.key === 'ArrowLeft') renditionRef.current?.prev();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!item) return null;

  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  const activeTheme = READER_THEMES[readerTheme];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: activeTheme.bg,
        color: activeTheme.fg,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <button type="button" className="btn" style={{ padding: '6px 9px' }} onClick={() => setTocOpen((o) => !o)} title="Chapters">
            <List size={16} />
          </button>
          <span className="badge">EPUB</span>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {chapterLabel || item.fileName}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn" style={{ padding: '6px 9px' }} onClick={() => setFontSize((f) => Math.max(80, f - 10))} title="Smaller text">
            <Minus size={14} />
          </button>
          <span style={{ fontSize: 12, minWidth: 38, textAlign: 'center' }}>{fontSize}%</span>
          <button type="button" className="btn" style={{ padding: '6px 9px' }} onClick={() => setFontSize((f) => Math.min(180, f + 10))} title="Larger text">
            <Plus size={14} />
          </button>

          <button
            type="button"
            className="btn"
            style={{ padding: '6px 10px', fontSize: 12 }}
            onClick={() => setReaderTheme((t) => (t === 'dark' ? 'sepia' : t === 'sepia' ? 'light' : 'dark'))}
          >
            {readerTheme === 'dark' ? <Moon size={14} /> : readerTheme === 'sepia' ? <BookOpen size={14} /> : <Sun size={14} />}
            <span>{activeTheme.label}</span>
          </button>

          <a
            href={streamUrl(item.chatId, item.id, 'telegram_hq', true)}
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none' }}
          >
            <Download size={14} />
          </a>
          <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {/* TOC Drawer */}
        {tocOpen && (
          <div
            style={{
              width: 280,
              maxWidth: '80vw',
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text)',
              overflowY: 'auto',
              padding: 12,
              zIndex: 5,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Table of Contents</div>
            {toc.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No chapters listed</div>
            ) : (
              toc.map((ch, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    textAlign: 'left',
                    padding: '8px 10px',
                    fontSize: 13,
                    fontWeight: 500,
                  }}
                  onClick={() => {
                    renditionRef.current?.display(ch.href);
                    setChapterLabel(ch.label?.trim() || '');
                    setTocOpen(false);
                  }}
                >
                  {ch.label?.trim() || `Chapter ${idx + 1}`}
                </button>
              ))
            )}
          </div>
        )}

        {/* Reader Canvas */}
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          <div ref={viewerRef} style={{ width: '100%', height: '100%' }} />

          {loading && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                background: activeTheme.bg,
              }}
            >
              <Loader2 size={32} className="spin" color="#00bfd8" />
              <div style={{ fontSize: 13.5 }}>
                Loading EPUB... {pct > 0 ? `${pct}% (${formatBytes(progress.loaded)})` : ''}
              </div>
              {pct > 0 && (
                <div style={{ width: 220, height: 5, borderRadius: 999, background: 'rgba(148,163,184,0.25)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#00bfd8', transition: 'width 0.15s' }} />
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                color: '#fca5a5',
              }}
            >
              <div>{error}</div>
              <a href={streamUrl(item.chatId, item.id, 'telegram_hq', true)} className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Download EPUB instead
              </a>
            </div>
          )}

          {/* Prev / Next Floating Buttons */}
          {!loading && !error && (
            <>
              <button
                type="button"
                onClick={() => renditionRef.current?.prev()}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 38,
                  height: 54,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(15,23,42,0.55)',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Previous Page"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={() => renditionRef.current?.next()}
                style={{
                  position: 'absolute',
                  right: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 38,
                  height: 54,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'rgba(15,23,42,0.55)',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Next Page"
              >
                <ChevronRight size={20} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
