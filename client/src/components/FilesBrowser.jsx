import React from 'react';
import {
  Film,
  Music,
  Image as ImageIcon,
  FileText,
  Search,
  LayoutGrid,
  List,
  Play,
  Info,
  Download,
  Bookmark,
  Loader2,
  Menu,
  MessageSquare,
} from 'lucide-react';
import { formatBytes, formatDuration, formatDate, getResumeTime, streamUrl } from '../api';
import ChatTimelineView from './ChatTimelineView';

const TABS = [
  { id: 'video', label: 'Videos', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'photo', label: 'Photos', icon: ImageIcon },
  { id: 'document', label: 'Documents', icon: FileText },
  { id: 'chats', label: 'Chats', icon: MessageSquare },
];

export default function FilesBrowser({
  chat,
  tab,
  onTabChange,
  items,
  loading,
  hasMore,
  onLoadMore,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  viewMode,
  onViewModeChange,
  prefs,
  isPlayingSomething,
  bookmarks,
  showBookmarksOnly,
  onToggleBookmarksOnly,
  onToggleBookmark,
  onOpenItem,
  onInspectItem,
  onOpenMobileChats,
  chatMessages = [],
  chatLoading = false,
  chatHasMore = false,
  chatError = '',
  onRetryChat,
  onLoadOlderMessages,
  onSendChatMessage,
}) {
  const shouldLoadThumbs = prefs.loadThumbnails && !(isPlayingSomething && prefs.suspendThumbsOnPlay);

  const displayedItems = showBookmarksOnly
    ? bookmarks
    : items;

  const isBookmarked = (item) =>
    bookmarks.some((b) => `${b.chatId}_${b.id}` === `${item.chatId}_${item.id}`);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>
      {/* Top Toolbar */}
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <button
            type="button"
            className="btn mobile-only"
            style={{ padding: 8 }}
            onClick={onOpenMobileChats}
          >
            <Menu size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <h2
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {showBookmarksOnly ? 'Saved Bookmarks' : chat?.title || 'Select a Chat'}
            </h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {prefs.streamingMode === 'fast_web' ? '🌐 Fast Web Mode' : '⚡ Telegram HQ Mode'} ·{' '}
              {displayedItems.length} items loaded
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSearchSubmit();
            }}
            style={{ position: 'relative', width: 220 }}
          >
            <Search
              size={14}
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              className="input"
              placeholder="Search files in chat..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{ paddingLeft: 32, paddingTop: 7, paddingBottom: 7, fontSize: 13 }}
            />
          </form>

          <button
            type="button"
            className={`btn ${showBookmarksOnly ? 'btn-primary' : ''}`}
            style={{ padding: '7px 11px' }}
            onClick={onToggleBookmarksOnly}
            title="Show Bookmarked Files"
          >
            <Bookmark size={15} />
            <span className="desktop-only">Bookmarks ({bookmarks.length})</span>
          </button>

          <div
            style={{
              display: 'flex',
              border: '1px solid var(--border)',
              borderRadius: 10,
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                borderRadius: 0,
                padding: '7px 10px',
                background: viewMode === 'grid' ? 'rgba(59,130,246,0.18)' : 'transparent',
              }}
              onClick={() => onViewModeChange('grid')}
              title="Grid View"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{
                borderRadius: 0,
                padding: '7px 10px',
                background: viewMode === 'list' ? 'rgba(59,130,246,0.18)' : 'transparent',
              }}
              onClick={() => onViewModeChange('list')}
              title="List View"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* Media Category Tabs */}
      {!showBookmarksOnly && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '10px 20px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg)',
            overflowX: 'auto',
          }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                className={`btn ${active ? 'btn-primary' : ''}`}
                style={{ padding: '7px 14px', fontSize: 13 }}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Telegram Chat Screen Tab */}
      {!showBookmarksOnly && tab === 'chats' ? (
        chat ? (
          <ChatTimelineView
            chat={chat}
            messages={chatMessages}
            loading={chatLoading}
            hasMore={chatHasMore}
            error={chatError}
            onRetry={onRetryChat}
            onLoadOlder={onLoadOlderMessages}
            onOpenMedia={onOpenItem}
            onSendMessage={onSendChatMessage}
            prefs={prefs}
            isPlayingSomething={isPlayingSomething}
          />
        ) : (
          <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-muted)' }}>
            Select any chat on the left to view its Telegram messages.
          </div>
        )
      ) : (
      /* Files Grid / List */
      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {!chat && !showBookmarksOnly ? (
          <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-muted)' }}>
            Select any chat or Saved Messages on the left to stream your files.
          </div>
        ) : loading && displayedItems.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 80, gap: 12, color: 'var(--text-muted)' }}>
            <Loader2 size={28} className="spin" />
            <span>Loading {tab}s from Telegram...</span>
          </div>
        ) : displayedItems.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 80, color: 'var(--text-muted)' }}>
            No {showBookmarksOnly ? 'bookmarks' : `${tab}s`} found here.
          </div>
        ) : viewMode === 'grid' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              gap: 16,
            }}
          >
            {displayedItems.map((item) => {
              const resume = getResumeTime(item.chatId, item.id);
              const pct = item.duration > 0 && resume > 0 ? Math.min(100, (resume / item.duration) * 100) : 0;
              const thumbSrc =
                shouldLoadThumbs && item.hasThumb
                  ? `/api/thumb/${encodeURIComponent(item.chatId)}/${item.id}`
                  : item.miniThumb;

              return (
                <div
                  key={`${item.chatId}_${item.id}`}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 15,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'transform 0.14s ease, border-color 0.14s ease',
                  }}
                >
                  <div
                    onClick={() => onOpenItem(item)}
                    style={{
                      position: 'relative',
                      height: 138,
                      background: '#050811',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={item.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={{ color: 'var(--text-muted)' }}>
                        {item.kind === 'audio' ? <Music size={34} /> : item.kind === 'document' ? <FileText size={34} /> : <Film size={34} />}
                      </div>
                    )}

                    {(item.kind === 'video' || item.kind === 'audio') && (
                      <div
                        style={{
                          position: 'absolute',
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          background: 'rgba(15, 23, 42, 0.72)',
                          border: '1px solid rgba(255,255,255,0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                        }}
                      >
                        <Play size={18} fill="#fff" />
                      </div>
                    )}

                    {item.duration > 0 && (
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
                        {formatDuration(item.duration)}
                      </span>
                    )}

                    {pct > 0 && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: 0,
                          height: 3.5,
                          background: 'rgba(255,255,255,0.2)',
                        }}
                      >
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--cyan)' }} />
                      </div>
                    )}
                  </div>

                  <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div
                      onClick={() => onOpenItem(item)}
                      title={item.title}
                      style={{
                        fontWeight: 600,
                        fontSize: 13.5,
                        cursor: 'pointer',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {item.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 'auto' }}>
                      {formatBytes(item.size)} · {formatDate(item.date)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 4 }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '6px 10px', fontSize: 12 }}
                        onClick={() => onOpenItem(item)}
                      >
                        <Play size={13} /> {item.streamable ? 'Stream' : 'Open'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '6px 8px' }}
                        onClick={() => onInspectItem(item)}
                        title="Technical Specifications"
                      >
                        <Info size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          padding: '6px 8px',
                          color: isBookmarked(item) ? 'var(--amber)' : 'var(--text-muted)',
                        }}
                        onClick={() => onToggleBookmark(item)}
                        title="Bookmark"
                      >
                        <Bookmark size={14} fill={isBookmarked(item) ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {displayedItems.map((item) => (
              <div
                key={`${item.chatId}_${item.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                }}
              >
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 38, height: 38, padding: 0, borderRadius: 10, flexShrink: 0 }}
                  onClick={() => onOpenItem(item)}
                >
                  <Play size={16} />
                </button>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpenItem(item)}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatBytes(item.size)}
                    {item.duration > 0 ? ` · ${formatDuration(item.duration)}` : ''} · {formatDate(item.date)}
                  </div>
                </div>
                <button type="button" className="btn" style={{ padding: 8 }} onClick={() => onInspectItem(item)}>
                  <Info size={15} />
                </button>
                <a
                  href={streamUrl(item.chatId, item.id, prefs.streamingMode, true)}
                  className="btn"
                  style={{ padding: 8, textDecoration: 'none' }}
                  title="Download"
                >
                  <Download size={15} />
                </a>
              </div>
            ))}
          </div>
        )}

        {!showBookmarksOnly && hasMore && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 22 }}>
            <button type="button" className="btn" onClick={onLoadMore} disabled={loading}>
              {loading ? <Loader2 size={15} className="spin" /> : 'Load More Files'}
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
