import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
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
import { formatBytes, getPdfPage, setPdfPage, streamUrl } from '../api';

const READER_THEMES = {
  dark: { outer: '#0a0a0a', card: '#141720', fg: '#e2e8f0', heading: '#ffffff', link: '#38bdf8', label: 'Dark' },
  sepia: { outer: '#1c1813', card: '#f4ecd8', fg: '#2f2416', heading: '#1a1209', link: '#1d4ed8', label: 'Sepia' },
  light: { outer: '#e2e8f0', card: '#faf9f7', fg: '#111827', heading: '#0a0a0a', link: '#1d4ed8', label: 'Light' },
};

function sanitizeCSS(css) {
  return css
    .replace(/@font-face\s*\{[^}]*\}/gi, '')
    .replace(/(body|html|\*)\s*\{[^}]*(background(-color)?:\s*(#[0-9a-f]{3,6}|rgb[^)]+\)|black|dark|white|#fff)[^}]*)\}/gi, '')
    .replace(/color\s*:\s*(white|#fff|#ffffff|rgba?\([^)]*255[^)]*\))/gi, '');
}

export default function EpubModal({ item, mode = 'fast_web', onClose }) {
  const scrollRef = useRef(null);
  const zipRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState({ loaded: 0, total: item?.size || 0 });
  const [error, setError] = useState('');
  const [spine, setSpine] = useState([]); // [{ path, title }]
  const [chapterIdx, setChapterIdx] = useState(0);
  const [chapterHtml, setChapterHtml] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const [readerTheme, setReaderTheme] = useState('light');
  const [fontSize, setFontSize] = useState(17);

  // Remember chapter using pdfPage storage helper keyed with epub prefix
  const epubStorageId = item ? `epub_${item.id}` : '';

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setChapterHtml('');

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

        if (cancelled) return;

        const zip = await JSZip.loadAsync(buffer);
        zipRef.current = zip;

        const parser = new DOMParser();
        const contFile = zip.file('META-INF/container.xml');
        if (!contFile) throw new Error('Invalid EPUB: missing container.xml');
        const contXml = await contFile.async('string');
        const contDoc = parser.parseFromString(contXml, 'text/xml');
        const opfPath = contDoc.querySelector('rootfile')?.getAttribute('full-path');
        if (!opfPath) throw new Error('Invalid EPUB: missing OPF rootfile');

        const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
        const opfXml = await zip.file(opfPath).async('string');
        const opfDoc = parser.parseFromString(opfXml, 'text/xml');

        const manifest = {};
        opfDoc.querySelectorAll('manifest item').forEach((el) => {
          manifest[el.getAttribute('id')] = el.getAttribute('href');
        });

        const spineList = [];
        opfDoc.querySelectorAll('spine itemref').forEach((ref, idx) => {
          const href = manifest[ref.getAttribute('idref')];
          if (href) {
            const fullPath = opfDir + href.split('#')[0];
            const cleanName = href.split('/').pop().replace(/\.(x?html?|xml)$/i, '');
            spineList.push({ path: fullPath, title: cleanName || `Chapter ${idx + 1}` });
          }
        });

        if (spineList.length === 0) throw new Error('No readable chapters found in EPUB');

        if (!cancelled) {
          setSpine(spineList);
          const savedIdx = Math.max(0, Math.min(spineList.length - 1, (getPdfPage(item.chatId, epubStorageId) || 1) - 1));
          setChapterIdx(savedIdx);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Could not open EPUB');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [item?.chatId, item?.id]);

  // Render current chapter into clean HTML (BeyondDrive style: no broken iframe)
  useEffect(() => {
    const zip = zipRef.current;
    if (!zip || spine.length === 0 || loading) return;

    let cancelled = false;
    setRendering(true);
    setPdfPage(item.chatId, epubStorageId, chapterIdx + 1);

    (async () => {
      try {
        const chapterPath = spine[chapterIdx].path;
        const file = zip.file(chapterPath) || zip.file(decodeURIComponent(chapterPath));
        if (!file) throw new Error('Chapter file not found in EPUB');

        let html = await file.async('string');
        const dir = chapterPath.includes('/') ? chapterPath.slice(0, chapterPath.lastIndexOf('/') + 1) : '';

        // Inline images as base64 in parallel
        const imgMatches = [...html.matchAll(/src=["']([^"'#?]+)["']/g)];
        await Promise.all(
          imgMatches
            .filter((m) => !m[1].startsWith('data:') && !m[1].startsWith('http'))
            .map(async (m) => {
              const rel = m[1].replace(/^\.\//, '');
              const candidates = [dir + rel, rel];
              let imgFile = null;
              for (const c of candidates) {
                imgFile = zip.file(c) || zip.file(decodeURIComponent(c));
                if (imgFile) break;
              }
              if (!imgFile) return;
              const b64 = await imgFile.async('base64');
              const mt = /\.png$/i.test(rel)
                ? 'image/png'
                : /\.gif$/i.test(rel)
                ? 'image/gif'
                : /\.svg$/i.test(rel)
                ? 'image/svg+xml'
                : 'image/jpeg';
              html = html.replace(m[0], `src="data:${mt};base64,${b64}"`);
            })
        );

        const parser = new DOMParser();
        const parsed = parser.parseFromString(html, 'text/html');
        parsed.querySelectorAll('link[rel="stylesheet"], script').forEach((el) => el.remove());
        parsed.querySelectorAll('style').forEach((el) => {
          el.textContent = sanitizeCSS(el.textContent || '');
        });

        const bodyHtml = parsed.body ? parsed.body.innerHTML : html;
        if (!cancelled) {
          setChapterHtml(bodyHtml);
          setRendering(false);
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Error rendering chapter');
          setRendering(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chapterIdx, spine, loading]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setChapterIdx((i) => Math.min(spine.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') setChapterIdx((i) => Math.max(0, i - 1));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spine.length]);

  if (!item) return null;

  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  const theme = READER_THEMES[readerTheme];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: theme.outer,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          color: 'var(--text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <button type="button" className="btn" style={{ padding: '6px 9px' }} onClick={() => setTocOpen((o) => !o)} title="Chapters">
            <List size={16} />
          </button>
          <span className="badge">EPUB</span>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.fileName}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn" style={{ padding: '6px 8px' }} onClick={() => setFontSize((f) => Math.max(13, f - 1))}>
            <Minus size={14} />
          </button>
          <span style={{ fontSize: 12, minWidth: 34, textAlign: 'center' }}>{fontSize}px</span>
          <button type="button" className="btn" style={{ padding: '6px 8px' }} onClick={() => setFontSize((f) => Math.min(26, f + 1))}>
            <Plus size={14} />
          </button>

          <button
            type="button"
            className="btn"
            style={{ padding: '6px 10px', fontSize: 12 }}
            onClick={() => setReaderTheme((t) => (t === 'light' ? 'sepia' : t === 'sepia' ? 'dark' : 'light'))}
          >
            {readerTheme === 'dark' ? <Moon size={14} /> : readerTheme === 'sepia' ? <BookOpen size={14} /> : <Sun size={14} />}
            <span>{theme.label}</span>
          </button>

          <a
            href={streamUrl(item.chatId, item.id, 'telegram_hq', true)}
            className="btn btn-primary"
            style={{ padding: '6px 11px', fontSize: 12, textDecoration: 'none' }}
          >
            <Download size={14} />
          </a>
          <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Reader Area */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', overflow: 'hidden' }}>
        {tocOpen && (
          <div
            style={{
              width: 260,
              maxWidth: '78vw',
              borderRight: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text)',
              overflowY: 'auto',
              padding: 12,
              zIndex: 5,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>
              Chapters ({spine.length})
            </div>
            {spine.map((ch, idx) => (
              <button
                key={idx}
                type="button"
                className={`btn ${idx === chapterIdx ? 'btn-primary' : 'btn-ghost'}`}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  padding: '8px 10px',
                  fontSize: 12.5,
                  marginBottom: 3,
                }}
                onClick={() => {
                  setChapterIdx(idx);
                  setTocOpen(false);
                }}
              >
                {idx + 1}. {ch.title}
              </button>
            ))}
          </div>
        )}

        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: '16px 12px 40px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          {loading ? (
            <div style={{ marginTop: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: theme.fg }}>
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
          ) : error ? (
            <div style={{ marginTop: 80, textAlign: 'center', color: '#fca5a5' }}>
              <p>{error}</p>
              <a href={streamUrl(item.chatId, item.id, 'telegram_hq', true)} className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Download EPUB instead
              </a>
            </div>
          ) : (
            <>
              <style>{`
                .airgram-epub-card * { max-width: 100% !important; box-sizing: border-box !important; }
                .airgram-epub-card { background: ${theme.card}; color: ${theme.fg}; }
                .airgram-epub-card p, .airgram-epub-card div, .airgram-epub-card span, .airgram-epub-card li {
                  color: ${theme.fg} !important;
                  background: transparent !important;
                }
                .airgram-epub-card h1, .airgram-epub-card h2, .airgram-epub-card h3, .airgram-epub-card h4 {
                  color: ${theme.heading} !important;
                  line-height: 1.3;
                  margin: 1.2em 0 0.5em;
                }
                .airgram-epub-card a { color: ${theme.link} !important; }
                .airgram-epub-card img { max-width: 100% !important; height: auto !important; display: block; margin: 1.2em auto; border-radius: 6px; }
              `}</style>

              <article
                className="airgram-epub-card"
                style={{
                  width: '100%',
                  maxWidth: 760,
                  borderRadius: 10,
                  padding: '28px 24px',
                  boxShadow: '0 10px 45px rgba(0,0,0,0.35)',
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: `${fontSize}px`,
                  lineHeight: 1.8,
                  wordBreak: 'break-word',
                  opacity: rendering ? 0.5 : 1,
                }}
                dangerouslySetInnerHTML={{ __html: chapterHtml }}
              />

              {/* Bottom Chapter Nav */}
              <div
                style={{
                  width: '100%',
                  maxWidth: 760,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 18,
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  className="btn"
                  disabled={chapterIdx <= 0}
                  onClick={() => setChapterIdx((i) => Math.max(0, i - 1))}
                >
                  <ChevronLeft size={16} /> Prev Chapter
                </button>
                <span style={{ fontSize: 12.5, color: theme.fg, opacity: 0.75 }}>
                  {chapterIdx + 1} / {spine.length}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={chapterIdx >= spine.length - 1}
                  onClick={() => setChapterIdx((i) => Math.min(spine.length - 1, i + 1))}
                >
                  Next Chapter <ChevronRight size={16} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
