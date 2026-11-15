import React, { useState } from 'react';
import { X, Download, Sparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { streamUrl } from '../api';

export default function PhotoModal({ item, onClose, customThumbUrl, customFullUrl, customDownloadUrl }) {
  const [fullQuality, setFullQuality] = useState(false);
  const [zoom, setZoom] = useState(1);

  if (!item) return null;

  const imgSrc = fullQuality
    ? customFullUrl || `/api/thumb/${encodeURIComponent(item.chatId)}/${item.id}?full=1`
    : customThumbUrl || `/api/thumb/${encodeURIComponent(item.chatId)}/${item.id}`;

  const dlUrl = customDownloadUrl || streamUrl(item.chatId, item.id, 'telegram_hq', true);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 960,
          height: '88vh',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!fullQuality && (
              <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setFullQuality(true)}>
                <Sparkles size={14} /> Load Full Quality
              </button>
            )}
            <button type="button" className="btn" style={{ padding: 7 }} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              <ZoomOut size={15} />
            </button>
            <button type="button" className="btn" style={{ padding: 7 }} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              <ZoomIn size={15} />
            </button>
            <a href={dlUrl} className="btn" style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none' }}>
              <Download size={14} /> Download
            </a>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            background: '#050811',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'auto',
            padding: 16,
          }}
        >
          <img
            src={imgSrc}
            alt={item.title}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              transform: `scale(${zoom})`,
              transition: 'transform 0.15s ease',
              borderRadius: 8,
            }}
          />
        </div>
      </div>
    </div>
  );
}
