import React from 'react';
import { X, Play, Bookmark, Download, Film, Volume2, HardDrive, Clock, Calendar } from 'lucide-react';
import { formatBytes, formatDate, formatDuration, streamUrl } from '../api';

export default function MediaDetailModal({ item, isBookmarked, onToggleBookmark, onPlay, onClose, mode }) {
  if (!item) return null;

  const qualityLabel =
    item.height >= 2160
      ? '4K UHD'
      : item.height >= 1080
      ? '1080P FHD'
      : item.height >= 720
      ? '720P HD'
      : item.height > 0
      ? `${item.height}P`
      : item.kind.toUpperCase();

  const specs = [
    { icon: Film, label: 'Print / Quality', value: qualityLabel },
    { icon: Volume2, label: 'Format / Mime', value: item.mimeType || 'Unknown' },
    { icon: HardDrive, label: 'File Size', value: formatBytes(item.size) },
    { icon: Clock, label: 'Runtime Duration', value: item.duration ? formatDuration(item.duration) : 'N/A' },
    { icon: Calendar, label: 'Uploaded Date', value: formatDate(item.date) },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 740,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          padding: 26,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="badge">{item.kind.toUpperCase()}</span>
              <span className="badge">{qualityLabel}</span>
              {item.duration > 0 && <span className="badge">{formatDuration(item.duration)}</span>}
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, lineHeight: 1.3 }}>{item.title}</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13.5 }}>
              Stream directly from your Telegram library with zero upfront download on AirGram.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" style={{ padding: 8 }} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" style={{ padding: '11px 22px' }} onClick={() => onPlay(item)}>
            <Play size={16} fill="#fff" /> PLAY ({qualityLabel})
          </button>
          <button type="button" className="btn" onClick={() => onToggleBookmark(item)}>
            <Bookmark size={16} fill={isBookmarked ? 'currentColor' : 'none'} />
            {isBookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          <a
            href={streamUrl(item.chatId, item.id, mode, true)}
            className="btn"
            style={{ textDecoration: 'none' }}
          >
            <Download size={16} /> Download
          </a>
        </div>

        <h3 style={{ margin: '26px 0 12px', fontSize: 15, fontWeight: 700, color: 'var(--cyan)' }}>
          ✨ Technical Specifications
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
            gap: 10,
          }}
        >
          {specs.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.label}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <Icon size={14} color="#38bdf8" />
                  <span>{s.label}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13.5, wordBreak: 'break-word' }}>{s.value}</div>
              </div>
            );
          })}
        </div>

        {item.caption && (
          <div
            style={{
              marginTop: 18,
              padding: 14,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              fontSize: 13,
              color: 'var(--text-muted)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.55,
            }}
          >
            {item.caption}
          </div>
        )}
      </div>
    </div>
  );
}
