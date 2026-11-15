import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Play,
  FileText,
  Music,
  Loader2,
  CornerUpLeft,
  Forward,
  ChevronUp,
  X,
} from 'lucide-react';
import { formatBytes, formatDate, formatDuration } from '../api';

function formatTimeOfDay(unixSec) {
  if (!unixSec) return '';
  return new Date(unixSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderTextWithLinks(text) {
  if (!text) return null;
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--cyan)', textDecoration: 'underline', wordBreak: 'break-all' }}
      >
        {part}
      </a>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
}

export default function ChatTimelineView({
  chat,
  messages,
  loading,
  hasMore,
  error,
  onRetry,
  onLoadOlder,
  onOpenMedia,
  onSendMessage,
  prefs,
  isPlayingSomething,
}) {
  const bottomRef = useRef(null);
  const prevLenRef = useRef(0);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);

  const shouldLoadThumbs = prefs.loadThumbnails && !(isPlayingSomething && prefs.suspendThumbsOnPlay);

  // Auto-scroll to bottom on initial load or when a new message is sent
  useEffect(() => {
    if (messages.length > 0 && prevLenRef.current === 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
    prevLenRef.current = messages.length;
  }, [messages.length, chat?.id]);

  useEffect(() => {
    prevLenRef.current = 0;
    setReplyTo(null);
  }, [chat?.id]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await onSendMessage(draft.trim(), replyTo?.id || null);
      setDraft('');
      setReplyTo(null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    } finally {
      setSending(false);
    }
  };

  let lastDateLabel = '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <button type="button" className="btn" style={{ fontSize: 12.5, padding: '6px 14px' }} onClick={onLoadOlder} disabled={loading}>
              {loading ? <Loader2 size={14} className="spin" /> : <ChevronUp size={14} />}
              Load Older Messages
            </button>
          </div>
        )}

        {loading && messages.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 80, gap: 12, color: 'var(--text-muted)' }}>
            <Loader2 size={28} className="spin" />
            <span>Loading Telegram chat history...</span>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', marginTop: 60, color: '#ef4444', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div>{error}</div>
            {onRetry && (
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-muted)' }}>
            No messages found in this chat.
          </div>
        ) : (
          messages.map((msg) => {
            const dateLabel = formatDate(msg.date);
            const showDateDivider = dateLabel !== lastDateLabel;
            lastDateLabel = dateLabel;
            const media = msg.media;

            return (
              <React.Fragment key={msg.id}>
                {showDateDivider && (
                  <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0 4px' }}>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: '3px 11px',
                        borderRadius: 999,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {dateLabel}
                    </span>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: msg.out ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div
                    style={{
                      maxWidth: 'min(82%, 520px)',
                      background: msg.out ? 'rgba(37, 99, 235, 0.22)' : 'var(--bg-card)',
                      border: `1px solid ${msg.out ? 'rgba(59, 130, 246, 0.35)' : 'var(--border)'}`,
                      borderRadius: msg.out ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      padding: '9px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    {/* Sender / Forwarded / Reply Header */}
                    {!msg.out && msg.senderName && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>{msg.senderName}</div>
                    )}
                    {msg.fwdFrom && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        <Forward size={12} /> Forwarded from {msg.fwdFrom}
                      </div>
                    )}
                    {msg.replyToMsgId && (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: 'var(--text-muted)',
                          borderLeft: '2.5px solid var(--cyan)',
                          paddingLeft: 8,
                        }}
                      >
                        Replying to message #{msg.replyToMsgId}
                      </div>
                    )}

                    {/* Inline Media */}
                    {media && (
                      <div
                        onClick={() => onOpenMedia(media)}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 11,
                          overflow: 'hidden',
                          border: '1px solid var(--border)',
                          background: '#050811',
                        }}
                      >
                        {(media.kind === 'photo' || media.kind === 'video') && (
                          <div style={{ position: 'relative', maxHeight: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {shouldLoadThumbs && media.hasThumb ? (
                              <img
                                src={`/api/thumb/${encodeURIComponent(media.chatId)}/${media.id}`}
                                alt={media.title}
                                loading="lazy"
                                style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }}
                              />
                            ) : media.miniThumb ? (
                              <img
                                src={media.miniThumb}
                                alt={media.title}
                                style={{ width: '100%', height: 150, objectFit: 'cover', display: 'block' }}
                              />
                            ) : (
                              <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                                {media.kind.toUpperCase()}
                              </div>
                            )}

                            {media.kind === 'video' && (
                              <>
                                <div
                                  style={{
                                    position: 'absolute',
                                    width: 44,
                                    height: 44,
                                    borderRadius: '50%',
                                    background: 'rgba(15,23,42,0.75)',
                                    border: '1px solid rgba(255,255,255,0.3)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#fff',
                                  }}
                                >
                                  <Play size={18} fill="#fff" />
                                </div>
                                {media.duration > 0 && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      right: 8,
                                      bottom: 8,
                                      background: 'rgba(0,0,0,0.78)',
                                      color: '#fff',
                                      fontSize: 11,
                                      fontWeight: 600,
                                      padding: '2px 7px',
                                      borderRadius: 6,
                                    }}
                                  >
                                    {formatDuration(media.duration)}
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {(media.kind === 'audio' || media.kind === 'document') && (
                          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elevated)' }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: 9,
                                background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              {media.kind === 'audio' ? <Music size={17} /> : <FileText size={17} />}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {media.fileName}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                                {formatBytes(media.size)}
                                {media.duration > 0 ? ` · ${formatDuration(media.duration)}` : ''}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Message Text */}
                    {msg.text && (
                      <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {renderTextWithLinks(msg.text)}
                      </div>
                    )}

                    {/* Footer: Reply button + Timestamp */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 }}>
                      <button
                        type="button"
                        onClick={() => setReplyTo(msg)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: 11,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: 0,
                        }}
                      >
                        <CornerUpLeft size={11} /> Reply
                      </button>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{formatTimeOfDay(msg.date)}</span>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer Bar */}
      <form
        onSubmit={handleSend}
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {replyTo && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              padding: '5px 10px',
              borderRadius: 8,
              background: 'var(--bg-card)',
              borderLeft: '3px solid var(--cyan)',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Replying to {replyTo.senderName || 'message'}: {replyTo.text || replyTo.media?.fileName || `#${replyTo.id}`}
            </span>
            <button type="button" className="btn btn-ghost" style={{ padding: 2 }} onClick={() => setReplyTo(null)}>
              <X size={14} />
            </button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="input"
            placeholder={`Message ${chat?.title || 'chat'}...`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ padding: '9px 13px', fontSize: 13.5 }}
          />
          <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()} style={{ padding: '9px 16px' }}>
            {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
      </form>
    </div>
  );
}
