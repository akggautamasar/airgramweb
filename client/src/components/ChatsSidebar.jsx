import React, { useMemo, useState } from 'react';
import { Bookmark, Search, Radio, Users, User, Bot, Settings } from 'lucide-react';

export default function ChatsSidebar({
  user,
  chats,
  selectedChat,
  onSelectChat,
  onOpenSettings,
  loading,
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // all | saved | channel | group | user

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (filter !== 'all' && c.type !== filter) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [chats, query, filter]);

  const initials = `${(user?.firstName || 'A')[0]}${(user?.lastName || '')[0] || ''}`.toUpperCase();

  const typeIcon = (type) => {
    switch (type) {
      case 'saved':
        return <Bookmark size={16} />;
      case 'channel':
        return <Radio size={16} />;
      case 'group':
        return <Users size={16} />;
      case 'bot':
        return <Bot size={16} />;
      default:
        return <User size={16} />;
    }
  };

  return (
    <aside
      style={{
        width: 310,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-elevated)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Brand + User Header */}
      <div
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/airgram-icon.svg" alt="AirGram" style={{ width: 32, height: 32, borderRadius: 9 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em' }}>AirGram</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {user?.firstName} {user?.lastName}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            title={user?.username ? `@${user.username}` : user?.firstName}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {initials}
          </div>
          <button className="btn btn-ghost" style={{ padding: 7 }} onClick={onOpenSettings} title="Settings & Diagnostics">
            <Settings size={18} />
          </button>
        </div>
      </div>

      {/* Search + Type Filter */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            className="input"
            placeholder="Search chats..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 34, paddingTop: 8, paddingBottom: 8, fontSize: 13 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'saved', label: 'Saved' },
            { id: 'channel', label: 'Channels' },
            { id: 'group', label: 'Groups' },
            { id: 'user', label: 'Users' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              style={{
                padding: '4px 9px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 600,
                border: '1px solid var(--border)',
                cursor: 'pointer',
                background: filter === f.id ? 'var(--primary)' : 'transparent',
                color: filter === f.id ? '#fff' : 'var(--text-muted)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading && chats.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            Loading your Telegram chats...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No chats match "{query}"
          </div>
        ) : (
          filtered.map((chat) => {
            const active = selectedChat?.id === chat.id;
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelectChat(chat)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '10px 11px',
                  borderRadius: 12,
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: active ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
                  color: 'var(--text)',
                  marginBottom: 2,
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background:
                      chat.type === 'saved'
                        ? 'linear-gradient(135deg, #2563eb, #00bfd8)'
                        : 'var(--bg-card)',
                    color: chat.type === 'saved' ? '#fff' : 'var(--cyan)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {typeIcon(chat.type)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 13.5,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {chat.title}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {chat.lastMessageText || chat.type}
                  </div>
                </div>
                {chat.unreadCount > 0 && (
                  <span className="badge" style={{ fontSize: 10.5 }}>
                    {chat.unreadCount}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
