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
} from 'lucide-react';
import { getPdfPage, setPdfPage, streamUrl } from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfModal({ item, mode = 'fast_web', onClose }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(() => (item ? getPdfPage(item.chatId, item.id) : 1));
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.25);

  const pdfUrl = item ? streamUrl(item.chatId, item.id, mode, false) : '';

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: true,
      rangeChunkSize: 131072, // 128 KB range chunks for instant Page 1 load
      disableAutoFetch: true,
      disableStream: false,
    });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        const saved = Math.max(1, Math.min(doc.numPages, getPdfPage(item.chatId, item.id)));
        setPageNum(saved);
        setPageInput(String(saved));
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load PDF');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
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
    setPdfPage(item.chatId, item.id, pageNum);

    doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const containerWidth = containerRef.current ? containerRef.current.clientWidth - 32 : 800;
      const unscaled = page.getViewport({ scale: 1 });
      const baseScale = Math.min(scale, Math.max(0.6, (containerWidth / unscaled.width) * (scale / 1.25)));
      const viewport = page.getViewport({ scale: baseScale });

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
          if (!cancelled) setRendering(false);
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
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span className="badge">PDF</span>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.fileName}
          </div>
        </div>

        {/* Page Controls */}
        {numPages > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '6px 9px' }}
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
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <input
                type="number"
                min={1}
                max={numPages}
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                className="input"
                style={{ width: 58, padding: '5px 8px', textAlign: 'center', fontSize: 13 }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>/ {numPages}</span>
            </form>
            <button
              type="button"
              className="btn"
              style={{ padding: '6px 9px' }}
              disabled={pageNum >= numPages}
              onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Zoom & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: '6px 9px' }}
            onClick={() => setScale((s) => Math.max(0.6, Number((s - 0.2).toFixed(2))))}
            title="Zoom Out"
          >
            <ZoomOut size={15} />
          </button>
          <span style={{ fontSize: 12, minWidth: 42, textAlign: 'center' }}>{Math.round((scale / 1.25) * 100)}%</span>
          <button
            type="button"
            className="btn"
            style={{ padding: '6px 9px' }}
            onClick={() => setScale((s) => Math.min(3, Number((s + 0.2).toFixed(2))))}
            title="Zoom In"
          >
            <ZoomIn size={15} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: '6px 9px' }}
            onClick={() => setScale(1.25)}
            title="Fit Width"
          >
            <Maximize2 size={14} />
          </button>
          <a
            href={streamUrl(item.chatId, item.id, 'telegram_hq', true)}
            className="btn btn-primary"
            style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none' }}
          >
            <Download size={14} />
            <span className="desktop-only">Download</span>
          </a>
          <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 16,
          background: '#050811',
          position: 'relative',
        }}
      >
        {loading ? (
          <div style={{ marginTop: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#94a3b8' }}>
            <Loader2 size={32} className="spin" color="#00bfd8" />
            <span>Streaming PDF page via range chunks...</span>
          </div>
        ) : error ? (
          <div style={{ marginTop: 80, textAlign: 'center', color: '#fca5a5' }}>
            <p>{error}</p>
            <a href={streamUrl(item.chatId, item.id, 'telegram_hq', true)} className="btn btn-primary" style={{ textDecoration: 'none' }}>
              Download PDF instead
            </a>
          </div>
        ) : (
          <div style={{ position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.65)' }}>
            <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 6, background: '#fff' }} />
            {rendering && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  background: 'rgba(15,23,42,0.85)',
                  padding: '5px 10px',
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
