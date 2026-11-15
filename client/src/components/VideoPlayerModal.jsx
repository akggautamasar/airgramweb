import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  X,
  Zap,
  Globe,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  Gauge,
  Scaling,
  FastForward,
  Rewind,
} from 'lucide-react';
import { apiFetch, formatDuration, getResumeTime, setResumeTime, streamUrl } from '../api';

const SPEED_OPTIONS = [
  0.25, 0.5, 0.75, 1,
  1.25, 1.5, 1.75, 2,
  2.25, 2.5, 2.75, 3,
  3.25, 3.5, 3.75, 4,
];

const iconBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  background: 'rgba(255, 255, 255, 0.14)',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  color: '#ffffff',
  borderRadius: 10,
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 12.5,
  fontWeight: 600,
  backdropFilter: 'blur(8px)',
};

const roundBtnStyle = {
  ...iconBtnStyle,
  borderRadius: '50%',
  width: 36,
  height: 36,
  padding: 0,
};

export default function VideoPlayerModal({ item, mode, onModeChange, defaultSpeed = 1, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const tapTimerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, side: null });
  const seekFeedbackTimerRef = useRef(null);
  const lastTouchTimeRef = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item?.duration || 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(defaultSpeed);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [vlcInfo, setVlcInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [diagSpeed, setDiagSpeed] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [objectFit, setObjectFit] = useState('contain'); // 'contain' | 'cover'
  const [seekOverlay, setSeekOverlay] = useState(null); // { side: 'left'|'right', delta: number }

  const src = item ? streamUrl(item.chatId, item.id, mode, false) : '';

  const startHideTimer = (isPlaying = playing, menuOpen = speedMenuOpen) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isPlaying && !menuOpen) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
        setSpeedMenuOpen(false);
      }, 3500);
    }
  };

  const revealControls = (isPlaying = playing) => {
    setControlsVisible(true);
    startHideTimer(isPlaying, speedMenuOpen);
  };

  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (fs && playing) {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => {
          setControlsVisible(false);
          setSpeedMenuOpen(false);
        }, 3000);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [playing]);

  useEffect(() => {
    startHideTimer(playing, speedMenuOpen);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
    };
  }, [playing, speedMenuOpen]);

  useEffect(() => {
    if (!item) return;
    const savedPos = getResumeTime(item.chatId, item.id);
    const v = videoRef.current;
    if (v && savedPos > 5) {
      const handleLoaded = () => {
        if (v.duration && savedPos < v.duration - 5) {
          v.currentTime = savedPos;
        }
      };
      v.addEventListener('loadedmetadata', handleLoaded, { once: true });
    }
  }, [item?.chatId, item?.id]);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await apiFetch('/api/diagnostics');
        if (d.estimatedMbps > 0) setDiagSpeed(`${d.estimatedMbps} Mbps`);
        else if (d.estimatedKbps > 0) setDiagSpeed(`${d.estimatedKbps} kbps`);
      } catch {}
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const handleSwitchMode = (nextMode) => {
    if (nextMode === mode) return;
    const v = videoRef.current;
    const pos = v ? v.currentTime : 0;
    const wasPlaying = v ? !v.paused : true;
    onModeChange(nextMode);
    setTimeout(() => {
      const nv = videoRef.current;
      if (nv) {
        nv.addEventListener(
          'loadedmetadata',
          () => {
            nv.currentTime = pos;
            nv.playbackRate = speed;
            if (wasPlaying) nv.play().catch(() => {});
          },
          { once: true }
        );
      }
    }, 30);
    revealControls(playing);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      revealControls(true);
    } else {
      v.pause();
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  };

  const seekBy = (delta) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  };

  // Single tap -> toggle controls (stay >=3.5s, tap again to hide)
  // Double tap left/right -> -10s / +10s
  const handleVideoSurfaceClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    const isDoubleTap = now - lastTapRef.current.time < 280 && lastTapRef.current.side === side;

    if (isDoubleTap) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      lastTapRef.current = { time: now, side };
      const delta = side === 'right' ? 10 : -10;
      seekBy(delta);

      setSeekOverlay((prev) => ({
        side,
        delta: prev && prev.side === side ? prev.delta + delta : delta,
      }));
      if (seekFeedbackTimerRef.current) clearTimeout(seekFeedbackTimerRef.current);
      seekFeedbackTimerRef.current = setTimeout(() => setSeekOverlay(null), 650);
    } else {
      lastTapRef.current = { time: now, side };
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapTimerRef.current = setTimeout(() => {
        if (speedMenuOpen) {
          setSpeedMenuOpen(false);
          revealControls(playing);
          return;
        }
        setControlsVisible((vis) => {
          const next = !vis;
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          if (next && playing) {
            hideTimerRef.current = setTimeout(() => {
              setControlsVisible(false);
              setSpeedMenuOpen(false);
            }, 3500);
          }
          return next;
        });
      }, 240);
    }
  };

  const selectSpeed = (nextSpeed) => {
    setSpeed(nextSpeed);
    if (videoRef.current) videoRef.current.playbackRate = nextSpeed;
    setSpeedMenuOpen(false);
    revealControls(playing);
  };

  const handlePlayInVlc = async () => {
    try {
      const data = await apiFetch(`/api/stream-link/${encodeURIComponent(item.chatId)}/${item.id}?mode=${mode}`);
      setVlcInfo(data);
      window.location.href = data.vlcDeepLink;
    } catch {}
    revealControls(playing);
  };

  const copyDirectLink = async () => {
    if (!vlcInfo?.directUrl) return;
    await navigator.clipboard.writeText(vlcInfo.directUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (videoRef.current) await videoRef.current.requestPictureInPicture();
    } catch {}
    revealControls(playing);
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
        if (videoRef.current && videoRef.current.videoWidth > videoRef.current.videoHeight) {
          window.screen?.orientation?.lock?.('landscape').catch(() => {});
        }
      } else {
        await document.exitFullscreen();
        window.screen?.orientation?.unlock?.();
      }
    } catch {}
    revealControls(playing);
  };

  if (!item) return null;

  const qualityBadge = item.height ? `${item.height}P` : 'STREAM';
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onTouchStart={() => {
        lastTouchTimeRef.current = Date.now();
      }}
      onMouseMove={() => {
        // Ignore synthetic mousemove fired right after a touch tap on mobile
        if (Date.now() - lastTouchTimeRef.current < 600) return;
        revealControls(playing);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: '#000000',
        color: '#ffffff',
        overflow: 'hidden',
        cursor: controlsVisible ? 'default' : 'none',
        userSelect: 'none',
      }}
    >
      {/* 100% Fullscreen Video Layer */}
      <div
        onClick={handleVideoSurfaceClick}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <video
          ref={videoRef}
          src={src}
          autoPlay
          playsInline
          preload="auto"
          style={{
            width: '100%',
            height: '100%',
            objectFit,
            background: '#000',
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || item.duration || 0);
            e.currentTarget.playbackRate = speed;
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            setCurrentTime(v.currentTime);
            setResumeTime(item.chatId, item.id, v.currentTime);
            if (v.buffered && v.buffered.length > 0) {
              setBufferedEnd(v.buffered.end(v.buffered.length - 1));
            }
          }}
        />

        {/* Double-Tap Seek Feedback Overlay */}
        {seekOverlay && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              [seekOverlay.side === 'left' ? 'left' : 'right']: '12%',
              transform: 'translateY(-50%)',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(255,255,255,0.28)',
              borderRadius: 999,
              padding: '14px 22px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 16,
              fontWeight: 800,
              color: '#ffffff',
              pointerEvents: 'none',
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            }}
          >
            {seekOverlay.side === 'left' ? (
              <>
                <Rewind size={20} /> {seekOverlay.delta}s
              </>
            ) : (
              <>
                +{seekOverlay.delta}s <FastForward size={20} />
              </>
            )}
          </div>
        )}

        {buffering && (
          <div
            style={{
              position: 'absolute',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
              pointerEvents: 'none',
            }}
          >
            <Loader2 size={42} className="spin" color="#38bdf8" />
            <div
              style={{
                padding: '5px 14px',
                borderRadius: 999,
                background: 'rgba(15, 23, 42, 0.85)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                fontSize: 12.5,
                color: '#ffffff',
              }}
            >
              {mode === 'fast_web' ? 'Fast Web Stream...' : 'Telegram HQ Stream...'}
            </div>
          </div>
        )}
      </div>

      {/* Floating Auto-Hiding Top Bar */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          revealControls(playing);
        }}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 16px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.9), rgba(0,0,0,0))',
          zIndex: 3,
          flexWrap: 'wrap',
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <button type="button" style={roundBtnStyle} onClick={onClose} title="Back">
            <ChevronLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#cbd5e1' }}>
              <span
                style={{
                  padding: '1px 7px',
                  fontSize: 10.5,
                  borderRadius: 999,
                  fontWeight: 700,
                  background: 'rgba(59, 130, 246, 0.28)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.45)',
                }}
              >
                {qualityBadge}
              </span>
              <span>Default Audio</span>
              {diagSpeed && <span>· {diagSpeed}</span>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'flex',
              background: 'rgba(15, 23, 42, 0.85)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 999,
              padding: 3,
            }}
          >
            <button
              type="button"
              onClick={() => handleSwitchMode('telegram_hq')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 11px',
                borderRadius: 999,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: mode === 'telegram_hq' ? '#f59e0b' : 'transparent',
                color: mode === 'telegram_hq' ? '#111827' : '#e2e8f0',
              }}
            >
              <Zap size={13} /> Telegram HQ
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('fast_web')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 11px',
                borderRadius: 999,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: mode === 'fast_web' ? '#2563eb' : 'transparent',
                color: mode === 'fast_web' ? '#ffffff' : '#e2e8f0',
              }}
            >
              <Globe size={13} /> Fast Web
            </button>
          </div>

          <button
            type="button"
            onClick={handlePlayInVlc}
            style={{
              ...iconBtnStyle,
              borderRadius: 999,
              padding: '7px 13px',
              fontSize: 12,
              background: 'rgba(245, 158, 11, 0.22)',
              borderColor: 'rgba(245, 158, 11, 0.5)',
              color: '#fcd34d',
            }}
          >
            <ExternalLink size={13} /> Play in VLC
          </button>

          <button type="button" style={roundBtnStyle} onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {vlcInfo && (
          <div
            style={{
              width: '100%',
              marginTop: 6,
              padding: '8px 14px',
              borderRadius: 12,
              background: 'rgba(15, 23, 42, 0.94)',
              border: '1px solid rgba(245, 158, 11, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 12.5,
              color: '#ffffff',
            }}
          >
            <span>VLC external stream ready (valid 12h):</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" style={iconBtnStyle} onClick={copyDirectLink}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied URL' : 'Copy Stream URL'}
              </button>
              <a
                href={`/api/playlist/${encodeURIComponent(item.chatId)}/${item.id}.m3u`}
                style={{ ...iconBtnStyle, textDecoration: 'none' }}
              >
                Download .M3U
              </a>
              <button type="button" style={iconBtnStyle} onClick={() => setVlcInfo(null)}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Auto-Hiding Bottom Controls */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          revealControls(playing);
        }}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '22px 16px 16px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0))',
          zIndex: 3,
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      >
        {/* Speed Picker Popover (0.25x to 4.0x in 0.25x steps) */}
        {speedMenuOpen && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              borderRadius: 14,
              background: 'rgba(15, 23, 42, 0.96)',
              border: '1px solid rgba(255,255,255,0.2)',
              backdropFilter: 'blur(12px)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
              maxWidth: 320,
              marginLeft: 'auto',
            }}
          >
            {SPEED_OPTIONS.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => selectSpeed(sp)}
                style={{
                  padding: '7px 4px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.15)',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: 700,
                  background: speed === sp ? '#00bfd8' : 'rgba(255,255,255,0.08)',
                  color: speed === sp ? '#07111f' : '#ffffff',
                }}
              >
                {sp}x
              </button>
            ))}
          </div>
        )}

        {/* Seekbar */}
        <div
          style={{ position: 'relative', height: 22, display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 10 }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (videoRef.current && duration > 0) {
              videoRef.current.currentTime = pct * duration;
            }
            revealControls(playing);
          }}
        >
          <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.24)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bufferedPct}%`, background: 'rgba(255,255,255,0.45)' }} />
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progressPct}%`, background: '#00bfd8' }} />
          </div>
        </div>

        {/* High-Contrast Player Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" style={roundBtnStyle} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={17} /> : <Play size={17} fill="#ffffff" />}
            </button>
            <button type="button" style={roundBtnStyle} onClick={() => { seekBy(-10); revealControls(playing); }} title="-10s">
              <RotateCcw size={16} />
            </button>
            <button type="button" style={roundBtnStyle} onClick={() => { seekBy(10); revealControls(playing); }} title="+10s">
              <RotateCw size={16} />
            </button>

            <button
              type="button"
              style={roundBtnStyle}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (videoRef.current) videoRef.current.muted = next;
                revealControls(playing);
              }}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => {
                const val = Number(e.target.value);
                setVolume(val);
                setMuted(val === 0);
                if (videoRef.current) {
                  videoRef.current.volume = val;
                  videoRef.current.muted = val === 0;
                }
                revealControls(playing);
              }}
              style={{ width: 64, accentColor: '#00bfd8' }}
            />

            <span style={{ fontSize: 12.5, color: '#f1f5f9', fontWeight: 600, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              style={iconBtnStyle}
              onClick={() => {
                setObjectFit((f) => (f === 'contain' ? 'cover' : 'contain'));
                revealControls(playing);
              }}
              title="Toggle Fit / Fill Screen"
            >
              <Scaling size={14} /> {objectFit === 'contain' ? 'Fit' : 'Fill'}
            </button>
            <button
              type="button"
              style={{
                ...iconBtnStyle,
                background: speedMenuOpen ? '#00bfd8' : iconBtnStyle.background,
                color: speedMenuOpen ? '#07111f' : '#ffffff',
              }}
              onClick={() => {
                setSpeedMenuOpen((o) => !o);
                setControlsVisible(true);
              }}
              title="Playback Speed (0.25x - 4x)"
            >
              <Gauge size={14} /> {speed}x
            </button>
            <button type="button" style={roundBtnStyle} onClick={togglePiP} title="Picture-in-Picture">
              <PictureInPicture2 size={16} />
            </button>
            <button type="button" style={roundBtnStyle} onClick={toggleFullscreen} title="Fullscreen">
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
