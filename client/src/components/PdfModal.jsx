import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  Maximize2,
  ExternalLink,
  HardDrive,
  Search,
} from 'lucide-react';
import { apiFetch, formatBytes, getPdfPage, setPdfPage, streamUrl } from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfModal({
  item,
  mode = 'fast_web',
  onClose,
  customPdfUrl,
  customDownloadUrl,
  isPublicShare = false,
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);
  const touchRef = useRef({ x: 0, y: 0 });

  const [loading, setLoading] = useState(true);
  const [loadStatus, setLoadStatus] = useState('Streaming PDF...');
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(() => (item && !isPublicShare ? getPdfPage(item.chatId, item.id) : 1));
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.0);

  // In-document search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState([]); // page numbers
  const [matchIdx, setMatchIdx] = useState(0);

  const pdfUrl = customPdfUrl || (item ? streamUrl(item.chatId, item.id, mode, false) : '');
  const downloadUrl = customDownloadUrl || (item ? streamUrl(item.chatId, item.id, 'telegram_hq', true) : '');

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setLoadStatus('Streaming PDF via range chunks...');

    const loadWithFallback = async () => {
      try {
        const rangeTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: true,
          rangeChunkSize: 131072,
          disableAutoFetch: true,
          disableStream: false,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/cmaps/',
          cMapPacked: true,
        });
        const doc = await rangeTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        const saved = isPublicShare ? 1 : Math.max(1, Math.min(doc.numPages, getPdfPage(item.chatId, item.id)));
        setPageNum(saved);
        setPageInput(String(saved));
        setLoading(false);
        return;
      } catch {}

      if (cancelled) return;
      setLoadStatus('Loading full PDF...');

      try {
        const res = await fetch(pdfUrl, { credentials: 'include' });
        if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);

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
            if (total > 0) {
              const pct = Math.min(100, Math.round((received / total) * 100));
              setLoadStatus(`Loading PDF... ${pct}% (${formatBytes(received)})`);
            }
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
        const dataTask = pdfjsLib.getDocument({
          data: buffer,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/cmaps/',
          cMapPacked: true,
        });
        const doc = await dataTask.promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        const saved = isPublicShare ? 1 : Math.max(1, Math.min(doc.numPages, getPdfPage(item.chatId, item.id)));
        setPageNum(saved);
        setPageInput(String(saved));
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load PDF');
          setLoading(false);
        }
      }
    };

    loadWithFallback();

    return () => {
      cancelled = true;
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, [pdfUrl, item?.chatId, item?.id]);

  useEffect(() => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || loading) return;

    let cancelled = false;
    setRendering(true);
    setPageInput(String(pageNum));
    if (!isPublicShare) setPdfPage(item.chatId, item.id, pageNum, doc.numPages);

    doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const containerWidth = containerRef.current ? containerRef.current.clientWidth - 24 : 800;
      const unscaled = page.getViewport({ scale: 1 });
      const fitScale = containerWidth / unscaled.width;
      const viewport = page.getViewport({ scale: fitScale * scale });

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
      }

      const task = page.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      task.promise
        .then(() => {
          if (!cancelled) {
            setRendering(false);
            if (containerRef.current) containerRef.current.scrollTop = 0;
          }
        })
        .catch(() => {
          if (!cancelled) setRendering(false);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [pageNum, scale, loading]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setPageNum((p) => Math.min(numPages || p, p + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setPageNum((p) => Math.max(1, p - 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [numPages]);

  const handleRunSearch = async (e) => {
    e.preventDefault();
    const doc = pdfDocRef.current;
    const q = searchTerm.trim().toLowerCase();
    if (!doc || !q) return;

    setSearching(true);
    const found = [];
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map((it) => it.str).join(' ').toLowerCase();
        if (text.includes(q)) found.push(i);
      } catch {}
    }
    setMatches(found);
    setMatchIdx(0);
    if (found.length > 0) setPageNum(found[0]);
    setSearching(false);
  };

  const stepMatch = (dir) => {
    if (matches.length === 0) return;
    const next = (matchIdx + dir + matches.length) % matches.length;
    setMatchIdx(next);
    setPageNum(matches[next]);
  };

  const openExternal = async (target) => {
    try {
      let directUrl = new URL(pdfUrl, window.location.origin).href;
      if (!isPublicShare) {
        const data = await apiFetch(`/api/stream-link/${encodeURIComponent(item.chatId)}/${item.id}?mode=telegram_hq`);
        directUrl = data.directUrl;
      }
      if (target === 'chrome') {
        window.open(directUrl, '_blank', 'noopener');
      } else if (target === 'drive') {
        const driveUrl = `https://drive.google.com/viewerng/viewer?embedded=true&url=${encodeURIComponent(directUrl)}`;
        window.open(driveUrl, '_blank', 'noopener');
      }
    } catch {
      window.open(pdfUrl, '_blank', 'noopener');
    }
  };

  if (!item) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: '#070b14',
        display: 'flex',
        flexDirection: 'column',
        color: '#f1f5f9',
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span className="badge">PDF</span>
          <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.fileName}
          </div>
        </div>

        {numPages > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '6px 8px' }}
              disabled={pageNum <= 1}
              onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={16} />
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const target = Math.max(1, Math.min(numPages, Number(pageInput) || 1));
                setPageNum(target);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <input
                type="number"
                min={1}
                max={numPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                className="input"
                style={{ width: 52, padding: '5px 6px', textAlign: 'center', fontSize: 12.5 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {numPages}</span>
            </form>
            <button
              type="button"
              className="btn"
              style={{ padding: '6px 8px' }}
              disabled={pageNum >= numPages}
              onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn ${searchOpen ? 'btn-primary' : ''}`}
            style={{ padding: '6px 8px' }}
            onClick={() => setSearchOpen((o) => !o)}
            title="Search in PDF (Ctrl+F)"
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '6px 8px' }}
            onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.2).toFixed(2))))}
          >
            <ZoomOut size={15} />
          </button>
          <span style={{ fontSize: 12, minWidth: 38, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="btn"
            style={{ padding: '6px 8px' }}
            onClick={() => setScale((s) => Math.min(3, Number((s + 0.2).toFixed(2))))}
          >
            <ZoomIn size={15} />
          </button>
          <button type="button" className="btn" style={{ padding: '6px 8px' }} onClick={() => setScale(1.0)} title="Fit Width">
            <Maximize2 size={14} />
          </button>

          <button type="button" className="btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openExternal('chrome')}>
            <ExternalLink size={13} /> Chrome
          </button>
          <button type="button" className="btn" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => openExternal('drive')}>
            <HardDrive size={13} /> Drive
          </button>

          <a href={downloadUrl} className="btn btn-primary" style={{ padding: '6px 11px', fontSize: 12, textDecoration: 'none' }}>
            <Download size={14} />
          </a>
          <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* In-Document Search Bar */}
      {searchOpen && (
        <form
          onSubmit={handleRunSearch}
          style={{
            padding: '8px 14px',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <input
            type="text"
            className="input"
            placeholder="Search keyword inside PDF..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
            style={{ maxWidth: 260, padding: '6px 10px', fontSize: 13 }}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12.5 }} disabled={searching}>
            {searching ? <Loader2 size={14} className="spin" /> : 'Find'}
          </button>
          {matches.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
              <span>
                {matchIdx + 1} / {matches.length} pages (p.{matches[matchIdx]})
              </span>
              <button type="button" className="btn" style={{ padding: '4px 8px' }} onClick={() => stepMatch(-1)}>
                Prev
              </button>
              <button type="button" className="btn" style={{ padding: '4px 8px' }} onClick={() => stepMatch(1)}>
                Next
              </button>
            </div>
          )}
        </form>
      )}

      {/* Canvas Viewport */}
      <div
        ref={containerRef}
        onTouchStart={(e) => {
          touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          const dx = touchRef.current.x - e.changedTouches[0].clientX;
          const dy = touchRef.current.y - e.changedTouches[0].clientY;
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 55) {
            if (dx > 0) setPageNum((p) => Math.min(numPages || p, p + 1));
            else setPageNum((p) => Math.max(1, p - 1));
          }
        }}
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 12,
          background: '#050811',
          position: 'relative',
        }}
      >
        {loading ? (
          <div style={{ marginTop: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#94a3b8' }}>
            <Loader2 size={32} className="spin" color="#00bfd8" />
            <span>{loadStatus}</span>
          </div>
        ) : error ? (
          <div style={{ marginTop: 80, textAlign: 'center', color: '#fca5a5', maxWidth: 460 }}>
            <p>{error}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => openExternal('chrome')}>
                <ExternalLink size={14} /> Open in Chrome
              </button>
              <button type="button" className="btn" onClick={() => openExternal('drive')}>
                <HardDrive size={14} /> Open in Drive
              </button>
              <a href={downloadUrl} className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Download PDF
              </a>
            </div>
          </div>
        ) : (
          <div style={{ position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.65)' }}>
            <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 6, background: '#fff' }} />
            {rendering && (
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  right: 10,
                  background: 'rgba(15,23,42,0.85)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 11.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Loader2 size={13} className="spin" /> Rendering...
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
