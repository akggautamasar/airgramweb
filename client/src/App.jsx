import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { apiFetch, loadBookmarks, loadPrefs, savePrefs, streamUrl, toggleBookmark } from './api';
import LoginView from './components/LoginView';
import ChatsSidebar from './components/ChatsSidebar';
import FilesBrowser from './components/FilesBrowser';
import VideoPlayerModal from './components/VideoPlayerModal';
import MediaDetailModal from './components/MediaDetailModal';
import PhotoModal from './components/PhotoModal';
import PdfModal from './components/PdfModal';
import EpubModal from './components/EpubModal';
import AudioMiniPlayer from './components/AudioMiniPlayer';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState(null);
  const [sessionString, setSessionString] = useState('');

  const [prefs, setPrefs] = useState(loadPrefs);
  const [bookmarks, setBookmarks] = useState(loadBookmarks);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);

  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedChat, setSelectedChat] = useState(null);
  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);

  const [tab, setTab] = useState('video');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaItems, setMediaItems] = useState([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [nextOffsetId, setNextOffsetId] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatNextOffsetId, setChatNextOffsetId] = useState(0);
  const [chatHasMore, setChatHasMore] = useState(false);
  const [chatError, setChatError] = useState('');

  const [activeVideo, setActiveVideo] = useState(null);
  const [activePhoto, setActivePhoto] = useState(null);
  const [activePdf, setActivePdf] = useState(null);
  const [activeEpub, setActiveEpub] = useState(null);
  const [inspectItem, setInspectItem] = useState(null);
  const [audioTrack, setAudioTrack] = useState(null);
  const [audioQueue, setAudioQueue] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.theme);
  }, [prefs.theme]);

  const updatePrefs = (next) => {
    setPrefs(next);
    savePrefs(next);
  };

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch('/api/auth/me');
        setUser(data.user);
        setSessionString(data.sessionString || '');
      } catch {
        setUser(null);
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    setChatsLoading(true);
    apiFetch('/api/chats?limit=100')
      .then((data) => {
        setChats(data.chats || []);
        if (!selectedChat && data.chats?.length) {
          setSelectedChat(data.chats[0]);
        }
      })
      .catch(() => {})
      .finally(() => setChatsLoading(false));
  }, [user]);

  const fetchMedia = async (chatId, currentTab, offsetId = 0, query = '', append = false) => {
    if (!chatId) return;
    setMediaLoading(true);
    try {
      const data = await apiFetch(
        `/api/chats/${encodeURIComponent(chatId)}/media?tab=${encodeURIComponent(currentTab)}&offsetId=${offsetId}&limit=40&q=${encodeURIComponent(query)}`
      );
      setMediaItems((prev) => (append ? [...prev, ...(data.items || [])] : data.items || []));
      setNextOffsetId(data.nextOffsetId || 0);
      setHasMore(Boolean(data.hasMore));
    } catch {
      if (!append) setMediaItems([]);
    } finally {
      setMediaLoading(false);
    }
  };


  const fetchChatTimeline = async (chatId, offsetId = 0, query = '', prepend = false) => {
    if (!chatId) return;
    setChatLoading(true);
    setChatError('');
    try {
      const data = await apiFetch(
        `/api/chats/${encodeURIComponent(chatId)}/messages?offsetId=${offsetId}&limit=40&q=${encodeURIComponent(query)}`
      );
      setChatMessages((prev) => (prepend ? [...(data.messages || []), ...prev] : data.messages || []));
      setChatNextOffsetId(data.nextOffsetId || 0);
      setChatHasMore(Boolean(data.hasMore));
    } catch (err) {
      setChatError(err.message || 'Failed to load messages');
      if (!prepend) setChatMessages([]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSendChatMessage = async (text, replyToMsgId) => {
    if (!selectedChat) return;
    const data = await apiFetch(`/api/chats/${encodeURIComponent(selectedChat.id)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text, replyToMsgId }),
    });
    if (data.message) {
      setChatMessages((prev) => [...prev, data.message]);
    }
  };

  useEffect(() => {
    if (selectedChat && !showBookmarksOnly) {
      if (tab === 'chats') fetchChatTimeline(selectedChat.id, 0, searchQuery, false);
      else fetchMedia(selectedChat.id, tab, 0, searchQuery, false);
    }
  }, [selectedChat?.id, tab, showBookmarksOnly]);

  const handleOpenItem = (item) => {
    if (item.kind === 'video') {
      setActiveVideo(item);
    } else if (item.kind === 'audio') {
      const queue = mediaItems.filter((m) => m.kind === 'audio');
      setAudioQueue(queue.length ? queue : [item]);
      setAudioTrack(item);
    } else if (item.kind === 'photo') {
      setActivePhoto(item);
    } else if (item.mimeType === 'application/pdf' || item.fileName?.toLowerCase().endsWith('.pdf')) {
      setActivePdf(item);
    } else if (item.mimeType === 'application/epub+zip' || item.fileName?.toLowerCase().endsWith('.epub')) {
      setActiveEpub(item);
    } else {
      window.open(streamUrl(item.chatId, item.id, prefs.streamingMode, true), '_blank');
    }
  };

  const handleStepAudio = (dir) => {
    if (!audioTrack || audioQueue.length === 0) return;
    const idx = audioQueue.findIndex((t) => t.id === audioTrack.id && t.chatId === audioTrack.chatId);
    if (idx === -1) return;
    const nextIdx = (idx + dir + audioQueue.length) % audioQueue.length;
    setAudioTrack(audioQueue[nextIdx]);
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setUser(null);
    setChats([]);
    setSelectedChat(null);
    setSettingsOpen(false);
  };

  if (checkingAuth) {
    return (
      <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Loader2 size={24} className="spin" color="#00bfd8" />
        <span>Connecting to AirGram...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onAuthenticated={(auth) => {
          setUser(auth.user);
          setSessionString(auth.sessionString || '');
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      {/* Desktop Chats Sidebar */}
      <div className="desktop-only" style={{ height: '100%' }}>
        <ChatsSidebar
          user={user}
          chats={chats}
          selectedChat={selectedChat}
          loading={chatsLoading}
          onSelectChat={(c) => {
            setShowBookmarksOnly(false);
            setSelectedChat(c);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      {/* Mobile Chats Drawer */}
      {mobileChatsOpen && (
        <div
          className="modal-backdrop"
          style={{ justifyContent: 'flex-start', padding: 0 }}
          onClick={() => setMobileChatsOpen(false)}
        >
          <div style={{ height: '100%', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn"
              style={{ position: 'absolute', right: -46, top: 12, padding: 8 }}
              onClick={() => setMobileChatsOpen(false)}
            >
              <X size={18} />
            </button>
            <ChatsSidebar
              user={user}
              chats={chats}
              selectedChat={selectedChat}
              loading={chatsLoading}
              onSelectChat={(c) => {
                setShowBookmarksOnly(false);
                setSelectedChat(c);
                setMobileChatsOpen(false);
              }}
              onOpenSettings={() => {
                setMobileChatsOpen(false);
                setSettingsOpen(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Main Media Browser */}
      <FilesBrowser
        chat={selectedChat}
        tab={tab}
        onTabChange={setTab}
        items={mediaItems}
        loading={mediaLoading}
        hasMore={hasMore}
        onLoadMore={() => fetchMedia(selectedChat?.id, tab, nextOffsetId, searchQuery, true)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSearchSubmit={() => (tab === 'chats' ? fetchChatTimeline(selectedChat?.id, 0, searchQuery, false) : fetchMedia(selectedChat?.id, tab, 0, searchQuery, false))}
        viewMode={prefs.viewMode}
        onViewModeChange={(v) => updatePrefs({ ...prefs, viewMode: v })}
        prefs={prefs}
        isPlayingSomething={Boolean(activeVideo || audioTrack)}
        bookmarks={bookmarks}
        showBookmarksOnly={showBookmarksOnly}
        onToggleBookmarksOnly={() => setShowBookmarksOnly((s) => !s)}
        onToggleBookmark={(item) => setBookmarks(toggleBookmark(item))}
        onOpenItem={handleOpenItem}
        onInspectItem={setInspectItem}
        onOpenMobileChats={() => setMobileChatsOpen(true)}
        chatMessages={chatMessages}
        chatLoading={chatLoading}
        chatHasMore={chatHasMore}
        chatError={chatError}
        onRetryChat={() => fetchChatTimeline(selectedChat?.id, 0, searchQuery, false)}
        onLoadOlderMessages={() => fetchChatTimeline(selectedChat?.id, chatNextOffsetId, searchQuery, true)}
        onSendChatMessage={handleSendChatMessage}
      />

      {/* Video Player */}
      {activeVideo && (
        <VideoPlayerModal
          item={activeVideo}
          mode={prefs.streamingMode}
          onModeChange={(m) => updatePrefs({ ...prefs, streamingMode: m })}
          defaultSpeed={prefs.playbackSpeed}
          onClose={() => setActiveVideo(null)}
        />
      )}

      {/* Technical Specs Modal */}
      {inspectItem && (
        <MediaDetailModal
          item={inspectItem}
          mode={prefs.streamingMode}
          isBookmarked={bookmarks.some((b) => `${b.chatId}_${b.id}` === `${inspectItem.chatId}_${inspectItem.id}`)}
          onToggleBookmark={(it) => setBookmarks(toggleBookmark(it))}
          onPlay={(it) => {
            setInspectItem(null);
            handleOpenItem(it);
          }}
          onClose={() => setInspectItem(null)}
        />
      )}

      {/* Photo & PDF Modals */}
      {activePhoto && <PhotoModal item={activePhoto} onClose={() => setActivePhoto(null)} />}
      {activePdf && <PdfModal item={activePdf} mode={prefs.streamingMode} onClose={() => setActivePdf(null)} />}
      {activeEpub && <EpubModal item={activeEpub} mode={prefs.streamingMode} onClose={() => setActiveEpub(null)} />}

      {/* Persistent Audio Mini-Player */}
      {audioTrack && (
        <AudioMiniPlayer
          track={audioTrack}
          mode={prefs.streamingMode}
          onPrev={() => handleStepAudio(-1)}
          onNext={() => handleStepAudio(1)}
          onClose={() => setAudioTrack(null)}
        />
      )}

      {/* Settings & Diagnostics */}
      {settingsOpen && (
        <SettingsModal
          prefs={prefs}
          onUpdatePrefs={updatePrefs}
          sessionString={sessionString}
          onLogout={handleLogout}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
