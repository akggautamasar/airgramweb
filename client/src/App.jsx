import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  apiFetch,
  loadBookmarks,
  loadPrefs,
  loadRecentItems,
  recordRecentItem,
  savePrefs,
  streamUrl,
  toggleBookmark,
} from './api';
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
import ShareModal from './components/ShareModal';
import PublicShareView from './components/PublicShareView';
import CloudDriveView from './components/CloudDriveView';

export default function App() {
  // Handle public share route /s/:shareId without requiring Telegram login
  const pathMatch = window.location.pathname.match(/^\/s\/([^/]+)/);
  if (pathMatch) {
    return <PublicShareView shareId={decodeURIComponent(pathMatch[1])} />;
  }

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [user, setUser] = useState(null);
  const [sessionString, setSessionString] = useState('');

  const [prefs, setPrefs] = useState(loadPrefs);
  const [bookmarks, setBookmarks] = useState(loadBookmarks);
  const [recentItems, setRecentItems] = useState(loadRecentItems);
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);

  const [chats, setChats] = useState([]);
  const [folders, setFolders] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedChat, setSelectedChat] = useState(null);
  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);

  const [tab, setTab] = useState('video');
  const [searchQuery, setSearchQuery] = useState('');
  const [globalSearch, setGlobalSearch] = useState(false);
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
  const [shareItem, setShareItem] = useState(null);
  const [audioTrack, setAudioTrack] = useState(null);
  const [audioQueue, setAudioQueue] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloudDriveOpen, setCloudDriveOpen] = useState(false);

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
    apiFetch('/api/chats?limit=150')
      .then((data) => {
        setChats(data.chats || []);
        setFolders(data.folders || []);
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

  const fetchGlobalSearch = async (query, currentTab) => {
    if (!query.trim()) {
      setMediaItems([]);
      return;
    }
    setMediaLoading(true);
    try {
      const data = await apiFetch(
        `/api/search?q=${encodeURIComponent(query)}&tab=${encodeURIComponent(currentTab)}&limit=40`
      );
      setMediaItems(data.items || []);
      setHasMore(false);
    } catch {
      setMediaItems([]);
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


  const handleUploadChatFile = (file, caption, replyToMsgId, onProgress) => {
    if (!selectedChat) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      if (caption) form.append('caption', caption);
      if (replyToMsgId) form.append('replyToMsgId', String(replyToMsgId));

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/chats/${encodeURIComponent(selectedChat.id)}/upload`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) {
          onProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) {
            if (data.message) setChatMessages((prev) => [...prev, data.message]);
            resolve(data);
          } else {
            reject(new Error(data.error || `Upload failed (${xhr.status})`));
          }
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(form);
    });
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
    if (showBookmarksOnly) return;
    if (globalSearch) {
      if (tab === 'chats') setTab('video');
      else if (searchQuery.trim()) fetchGlobalSearch(searchQuery, tab);
      else setMediaItems([]);
      return;
    }
    if (selectedChat) {
      if (tab === 'chats') fetchChatTimeline(selectedChat.id, 0, searchQuery, false);
      else fetchMedia(selectedChat.id, tab, 0, searchQuery, false);
    }
  }, [selectedChat?.id, tab, showBookmarksOnly, globalSearch]);

  const handleOpenItem = (item) => {
    const isPdf = item.mimeType === 'application/pdf' || item.fileName?.toLowerCase().endsWith('.pdf');
    const isEpub = item.mimeType === 'application/epub+zip' || item.fileName?.toLowerCase().endsWith('.epub');

    if (item.kind === 'video' || isPdf || isEpub) {
      setRecentItems(recordRecentItem(item));
    }

    if (item.kind === 'video') {
      setActiveVideo(item);
    } else if (item.kind === 'audio') {
      const queue = mediaItems.filter((m) => m.kind === 'audio');
      setAudioQueue(queue.length ? queue : [item]);
      setAudioTrack(item);
    } else if (item.kind === 'photo') {
      setActivePhoto(item);
    } else if (isPdf) {
      setActivePdf(item);
    } else if (isEpub) {
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
          folders={folders}
          selectedChat={selectedChat}
          loading={chatsLoading}
          onSelectChat={(c) => {
            setShowBookmarksOnly(false);
            setGlobalSearch(false);
            setCloudDriveOpen(false);
            setSelectedChat(c);
          }}
          cloudDriveOpen={cloudDriveOpen}
          onOpenCloudDrive={() => setCloudDriveOpen(true)}
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
              folders={folders}
              selectedChat={selectedChat}
              loading={chatsLoading}
              onSelectChat={(c) => {
                setShowBookmarksOnly(false);
                setGlobalSearch(false);
                setCloudDriveOpen(false);
                setSelectedChat(c);
                setMobileChatsOpen(false);
              }}
              cloudDriveOpen={cloudDriveOpen}
              onOpenCloudDrive={() => {
                setCloudDriveOpen(true);
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

      {/* Main Media Browser or 7-Channel Cloud Drive */}
      {cloudDriveOpen ? (
        <CloudDriveView
          chats={chats}
          prefs={prefs}
          onOpenItem={handleOpenItem}
          onShareItem={setShareItem}
          onOpenMobileChats={() => setMobileChatsOpen(true)}
        />
      ) : (
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
        onSearchSubmit={() => {
          if (globalSearch) fetchGlobalSearch(searchQuery, tab);
          else if (tab === 'chats') fetchChatTimeline(selectedChat?.id, 0, searchQuery, false);
          else fetchMedia(selectedChat?.id, tab, 0, searchQuery, false);
        }}
        globalSearch={globalSearch}
        onToggleGlobalSearch={() => {
          setShowBookmarksOnly(false);
          setGlobalSearch((g) => !g);
        }}
        viewMode={prefs.viewMode}
        onViewModeChange={(v) => updatePrefs({ ...prefs, viewMode: v })}
        prefs={prefs}
        isPlayingSomething={Boolean(activeVideo || audioTrack)}
        bookmarks={bookmarks}
        recentItems={recentItems}
        showBookmarksOnly={showBookmarksOnly}
        onToggleBookmarksOnly={() => setShowBookmarksOnly((s) => !s)}
        onToggleBookmark={(item) => setBookmarks(toggleBookmark(item))}
        onOpenItem={handleOpenItem}
        onInspectItem={setInspectItem}
        onShareItem={setShareItem}
        onOpenMobileChats={() => setMobileChatsOpen(true)}
        chatMessages={chatMessages}
        chatLoading={chatLoading}
        chatHasMore={chatHasMore}
        chatError={chatError}
        onRetryChat={() => fetchChatTimeline(selectedChat?.id, 0, searchQuery, false)}
        onLoadOlderMessages={() => fetchChatTimeline(selectedChat?.id, chatNextOffsetId, searchQuery, true)}
        onSendChatMessage={handleSendChatMessage}
        onUploadChatFile={handleUploadChatFile}
      />
      )}

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
          onShare={(it) => {
            setInspectItem(null);
            setShareItem(it);
          }}
          onClose={() => setInspectItem(null)}
        />
      )}

      {/* Share Modal */}
      {shareItem && <ShareModal item={shareItem} onClose={() => setShareItem(null)} />}

      {/* Photo, PDF & EPUB Modals */}
      {activePhoto && <PhotoModal item={activePhoto} onClose={() => setActivePhoto(null)} />}
      {activePdf && <PdfModal item={activePdf} mode={prefs.streamingMode} onClose={() => setActivePdf(null)} />}
      {activeEpub && <EpubModal item={activeEpub} mode={prefs.streamingMode} onClose={() => setActiveEpub(null)} />}

      {/* Persistent Audio Mini-Player */}
      {audioTrack && (
        <AudioMiniPlayer
          track={audioTrack}
          queue={audioQueue}
          mode={prefs.streamingMode}
          onPrev={() => handleStepAudio(-1)}
          onNext={() => handleStepAudio(1)}
          onSelectTrack={(t) => setAudioTrack(t)}
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
