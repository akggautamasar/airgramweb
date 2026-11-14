import React from 'react';
import { X, Download } from 'lucide-react';
import { streamUrl } from '../api';

export default function PdfModal({ item, onClose }) {
  if (!item) return null;
  const pdfUrl = streamUrl(item.chatId, item.id, 'telegram_hq', false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 1020,
          height: '90vh',
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
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.fileName}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={streamUrl(item.chatId, item.id, 'telegram_hq', true)}
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none' }}
            >
              <Download size={14} /> Download PDF
            </a>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>
        <iframe
          title={item.fileName}
          src={pdfUrl}
          style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }}
        />
      </div>
    </div>
  );
}
