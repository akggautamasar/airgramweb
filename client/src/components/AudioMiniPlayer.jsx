import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Music,
  ChevronDown,
  Maximize2,
  Shuffle,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Gauge,
  ListMusic,
  Download,
  Moon,
} from 'lucide-react';
import { formatBytes, formatDuration, streamUrl } from '../api';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export default function AudioMiniPlayer({
  track,
  queue = [],
  mode = 'fast_web',
  onPrev,
  onNext,
  onSelectTrack,
  onClose,
}) {
  const audioRef = useRef(null);
  const sleepTimerRef = useRef(null);

  const [expanded, setExpanded] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track?.duration || 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // 'off' | 'all' | 'one'
  const [queueOpen, setQueueOpen] = useState(false);
  const [sleepMin, setSleepMin] = useState(0);

  // Auto-play when track changes
  useEffect(() => {
    if (!track || !audioRef.current) return;
    setCurrentTime(0);
    setDuration(track.duration || 0);
    const a = audioRef.current;
    a.playbackRate = speed;
    a.play().catch(() => {});
  }, [track?.chatId, track?.id]);

  // MediaSession lock-screen controls
  useEffect(() => {
    if (!track || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title || track.fileName || 'Audio',
        artist: track.performer || 'AirGram Audio',
        album: 'AirGram Telegram Library',
      });
      navigator.mediaSession.setActionHandler('play', () => audioRef.current?.play().catch(() => {}));
      navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler('previoustrack', onPrev);
      navigator.mediaSession.setActionHandler('nexttrack', handleEndedOrNext);
    } catch {}
  }, [track?.chatId, track?.id, shuffle, repeat]);

  // Sleep timer
  useEffect(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    if (sleepMin > 0) {
      sleepTimerRef.current = setTimeout(() => {
        audioRef.current?.pause();
        setSleepMin(0);
      }, sleepMin * 60 * 1000);
    }
    return () => {
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    };
  }, [sleepMin]);

  if (!track) return null;

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const seekBy = (delta) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || duration || 0, a.currentTime + delta));
  };

  const handleEndedOrNext = () => {
    if (repeat === 'one' && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
      return;
    }
    if (shuffle && queue.length > 1 && onSelectTrack) {
      const rand = queue[Math.floor(Math.random() * queue.length)];
      onSelectTrack(rand);
      return;
    }
    onNext();
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const cycleRepeat = () => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
  };

  const cycleSleep = () => {
    const opts = [0, 15, 30, 60];
    setSleepMin((m) => opts[(opts.indexOf(m) + 1) % opts.length]);
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;
  const artSrc = track.hasThumb
    ? `/api/thumb/${encodeURIComponent(track.chatId)}/${track.id}`
    : track.miniThumb || '';

  return (
    <>
      {/* Single Persistent Audio Element */}
      <audio
        ref={audioRef}
        src={streamUrl(track.chatId, track.id, mode, false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration || track.duration || 0);
          e.currentTarget.playbackRate = speed;
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setCurrentTime(a.currentTime);
          if (a.buffered && a.buffered.length > 0) {
            setBufferedEnd(a.buffered.end(a.buffered.length - 1));
          }
        }}
        onEnded={handleEndedOrNext}
      />

      {/* FULL-SCREEN AUDIO PLAYER */}
      {expanded && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 85,
            background:
              'radial-gradient(circle at 50% 20%, rgba(37, 99, 235, 0.34), rgba(7, 11, 20, 0.98) 65%)',
            backdropFilter: 'blur(24px)',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            padding: '16px 20px 24px',
            overflowY: 'auto',
          }}
        >
          {/* Top Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.16)',
                color: '#fff',
                borderRadius: 999,
                padding: '7px 14px',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Minimize to Mini-Player"
            >
              <ChevronDown size={17} /> Minimize
            </button>

            <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
              {mode === 'fast_web' ? '🌐 Fast Web' : '⚡ Telegram HQ'}
              {queue.length > 1 ? ` · ${queue.length} in queue` : ''}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setQueueOpen((q) => !q)}
                style={{
                  background: queueOpen ? '#00bfd8' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.16)',
                  color: queueOpen ? '#07111f' : '#fff',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Queue"
              >
                <ListMusic size={17} />
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.16)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Close Player"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          {/* Center: Queue Drawer OR Artwork + Controls */}
          {queueOpen ? (
            <div style={{ maxWidth: 520, width: '100%', margin: '24px auto', flex: 1, overflowY: 'auto' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700 }}>Up Next ({queue.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queue.map((qItem) => {
                  const isCurrent = qItem.id === track.id && qItem.chatId === track.chatId;
                  return (
                    <button
                      key={`${qItem.chatId}_${qItem.id}`}
                      type="button"
                      onClick={() => {
                        onSelectTrack?.(qItem);
                        setQueueOpen(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '10px 14px',
                        borderRadius: 12,
                        border: `1px solid ${isCurrent ? '#00bfd8' : 'rgba(255,255,255,0.12)'}`,
                        background: isCurrent ? 'rgba(0,191,216,0.16)' : 'rgba(255,255,255,0.05)',
                        color: '#fff',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {qItem.title || qItem.fileName}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                          {qItem.performer || 'Audio'} · {formatDuration(qItem.duration)}
                        </div>
                      </div>
                      {isCurrent && <span className="badge">Playing</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                maxWidth: 460,
                width: '100%',
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                gap: 24,
              }}
            >
              {/* Artwork */}
              <div
                style={{
                  width: 'min(260px, 64vw)',
                  height: 'min(260px, 64vw)',
                  margin: '10px auto 0',
                  borderRadius: 28,
                  overflow: 'hidden',
                  background: 'linear-gradient(135deg, #1e3a8a, #00bfd8)',
                  boxShadow: playing
                    ? '0 24px 70px rgba(0, 191, 216, 0.35)'
                    : '0 18px 50px rgba(0, 0, 0, 0.55)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.18)',
                  transition: 'box-shadow 0.3s ease',
                }}
              >
                {artSrc ? (
                  <img src={artSrc} alt={track.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Music size={78} color="rgba(255,255,255,0.9)" />
                )}
              </div>

              {/* Title & Artist */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, wordBreak: 'break-word' }}>
                  {track.title || track.fileName}
                </div>
                <div style={{ fontSize: 13.5, color: '#94a3b8', marginTop: 4 }}>
                  {track.performer || 'Telegram Audio'} · {formatBytes(track.size)}
                </div>
              </div>

              {/* Seekbar */}
              <div>
                <div
                  style={{ height: 22, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    if (audioRef.current && duration > 0) {
                      audioRef.current.currentTime = pct * duration;
                    }
                  }}
                >
                  <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.18)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bufferedPct}%`, background: 'rgba(255,255,255,0.35)' }} />
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progressPct}%`, background: '#00bfd8' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  <span>{formatDuration(currentTime)}</span>
                  <span>{formatDuration(duration)}</span>
                </div>
              </div>

              {/* Primary Transport Controls */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShuffle((s) => !s)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: shuffle ? '#00bfd8' : '#94a3b8',
                    cursor: 'pointer',
                    padding: 8,
                  }}
                  title="Shuffle"
                >
                  <Shuffle size={19} />
                </button>

                <button
                  type="button"
                  onClick={onPrev}
                  style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 8 }}
                  title="Previous"
                >
                  <SkipBack size={24} />
                </button>

                <button
                  type="button"
                  onClick={() => seekBy(-10)}
                  style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 8 }}
                  title="-10s"
                >
                  <RotateCcw size={20} />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    border: 'none',
                    background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 10px 30px rgba(0,191,216,0.4)',
                  }}
                >
                  {playing ? <Pause size={28} /> : <Play size={28} fill="#fff" style={{ marginLeft: 3 }} />}
                </button>

                <button
                  type="button"
                  onClick={() => seekBy(10)}
                  style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 8 }}
                  title="+10s"
                >
                  <RotateCw size={20} />
                </button>

                <button
                  type="button"
                  onClick={handleEndedOrNext}
                  style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: 8 }}
                  title="Next"
                >
                  <SkipForward size={24} />
                </button>

                <button
                  type="button"
                  onClick={cycleRepeat}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: repeat !== 'off' ? '#00bfd8' : '#94a3b8',
                    cursor: 'pointer',
                    padding: 8,
                  }}
                  title={`Repeat: ${repeat}`}
                >
                  {repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
                </button>
              </div>

              {/* Secondary Controls: Volume, Speed, Sleep Timer, Download */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !muted;
                      setMuted(next);
                      if (audioRef.current) audioRef.current.muted = next;
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 4 }}
                  >
                    {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      setMuted(v === 0);
                      if (audioRef.current) {
                        audioRef.current.volume = v;
                        audioRef.current.muted = v === 0;
                      }
                    }}
                    style={{ width: 85, accentColor: '#00bfd8' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={cycleSpeed}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.16)',
                      color: '#fff',
                      borderRadius: 999,
                      padding: '6px 11px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Gauge size={13} /> {speed}x
                  </button>

                  <button
                    type="button"
                    onClick={cycleSleep}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      background: sleepMin > 0 ? 'rgba(0,191,216,0.2)' : 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.16)',
                      color: sleepMin > 0 ? '#38bdf8' : '#fff',
                      borderRadius: 999,
                      padding: '6px 11px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    title="Sleep Timer"
                  >
                    <Moon size={13} /> {sleepMin > 0 ? `${sleepMin}m` : 'Sleep'}
                  </button>

                  <a
                    href={streamUrl(track.chatId, track.id, 'telegram_hq', true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.16)',
                      color: '#fff',
                      borderRadius: '50%',
                      width: 32,
                      height: 32,
                      textDecoration: 'none',
                    }}
                    title="Download Audio"
                  >
                    <Download size={14} />
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MINIMIZED MINI-PLAYER BAR */}
      {!expanded && (
        <div
          style={{
            position: 'fixed',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(740px, calc(100vw - 20px))',
            zIndex: 55,
            background: 'rgba(13, 19, 35, 0.96)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 18px 48px rgba(0, 0, 0, 0.5)',
            color: '#f1f5f9',
          }}
        >
          {/* Thin top progress line */}
          <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.12)' }}>
            <div style={{ width: `${progressPct}%`, height: '100%', background: '#00bfd8' }} />
          </div>

          <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              onClick={() => setExpanded(true)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                overflow: 'hidden',
                cursor: 'pointer',
              }}
            >
              {artSrc ? (
                <img src={artSrc} alt={track.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Music size={18} color="#fff" />
              )}
            </div>

            <div onClick={() => setExpanded(true)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {track.title || track.fileName}
              </div>
              <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                {track.performer || 'Telegram Audio'} · {formatDuration(currentTime)} / {formatDuration(duration)}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={togglePlay}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                {playing ? <Pause size={15} /> : <Play size={15} fill="#fff" />}
              </button>
              <button
                type="button"
                onClick={handleEndedOrNext}
                style={{ background: 'transparent', border: 'none', color: '#e2e8f0', padding: 6, cursor: 'pointer' }}
                title="Next"
              >
                <SkipForward size={16} />
              </button>
              <button
                type="button"
                onClick={() => setExpanded(true)}
                style={{ background: 'transparent', border: 'none', color: '#e2e8f0', padding: 6, cursor: 'pointer' }}
                title="Expand Full Player"
              >
                <Maximize2 size={15} />
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: 6, cursor: 'pointer' }}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
