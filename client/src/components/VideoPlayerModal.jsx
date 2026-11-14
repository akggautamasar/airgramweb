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
} from 'lucide-react';
import { apiFetch, formatDuration, getResumeTime, setResumeTime, streamUrl } from '../api';

export default function VideoPlayerModal({ item, mode, onModeChange, defaultSpeed = 1, onClose }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item?.duration || 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(defaultSpeed);
  const [vlcInfo, setVlcInfo] = useState(null);
  const [copied, setCopied] = useState(false);
  const [diagSpeed, setDiagSpeed] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [objectFit, setObjectFit] = useState('contain'); // 'contain' | 'cover'

  const src = item ? streamUrl(item.chatId, item.id, mode, false) : '';

  const scheduleHideControls = (currentlyPlaying = playing) => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
    if (currentlyPlaying) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (fs && playing) {
        // Hide controls quickly when entering fullscreen so only video is visible
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setControlsVisible(false), 1500);
      } else {
        scheduleHideControls(playing);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [playing]);

  useEffect(() => {
    scheduleHideControls(playing);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing]);

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
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const handleVideoSurfaceClick = () => {
    if (!controlsVisible) {
      scheduleHideControls(playing);
    } else {
      togglePlay();
      scheduleHideControls(!playing);
    }
  };

  const seekBy = (delta) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    scheduleHideControls(playing);
  };

  const handleSpeedChange = () => {
    const speeds = [0.75, 1, 1.25, 1.5, 2];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
    scheduleHideControls(playing);
  };

  const handlePlayInVlc = async () => {
    try {
      const data = await apiFetch(`/api/stream-link/${encodeURIComponent(item.chatId)}/${item.id}?mode=${mode}`);
      setVlcInfo(data);
      window.location.href = data.vlcDeepLink;
    } catch {}
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
  };

  if (!item) return null;

  const qualityBadge = item.height ? `${item.height}P` : 'STREAM';
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (bufferedEnd / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={() => scheduleHideControls(playing)}
      onTouchStart={() => {
        if (!controlsVisible) scheduleHideControls(playing);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: '#000000',
        color: '#fff',
        overflow: 'hidden',
        cursor: controlsVisible ? 'default' : 'none',
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
              }}
            >
              {mode === 'fast_web' ? 'Fast Web Stream...' : 'Telegram HQ Stream...'}
            </div>
          </div>
        )}
      </div>

      {/* Floating Auto-Hiding Top Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 18px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.88), rgba(0,0,0,0))',
          zIndex: 3,
          flexWrap: 'wrap',
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
          <button type="button" className="btn" style={{ padding: 8, borderRadius: '50%' }} onClick={onClose}>
            <ChevronLeft size={18} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 14.5,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: '#94a3b8' }}>
              <span className="badge" style={{ padding: '1px 7px', fontSize: 10.5 }}>{qualityBadge}</span>
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
              border: '1px solid rgba(148,163,184,0.2)',
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
                padding: '6px 12px',
                borderRadius: 999,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: mode === 'telegram_hq' ? '#f59e0b' : 'transparent',
                color: mode === 'telegram_hq' ? '#111827' : '#cbd5e1',
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
                padding: '6px 12px',
                borderRadius: 999,
                border: 'none',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                background: mode === 'fast_web' ? '#2563eb' : 'transparent',
                color: mode === 'fast_web' ? '#ffffff' : '#cbd5e1',
              }}
            >
              <Globe size={13} /> Fast Web
            </button>
          </div>

          <button type="button" className="btn btn-amber" style={{ borderRadius: 999, padding: '7px 14px', fontSize: 12 }} onClick={handlePlayInVlc}>
            <ExternalLink size={13} /> Play in VLC
          </button>

          <button type="button" className="btn" style={{ padding: 8, borderRadius: '50%' }} onClick={onClose}>
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
              border: '1px solid rgba(245, 158, 11, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap',
              fontSize: 12.5,
            }}
          >
            <span>VLC external stream ready (valid 12h):</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={copyDirectLink}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied URL' : 'Copy Stream URL'}
              </button>
              <a
                href={`/api/playlist/${encodeURIComponent(item.chatId)}/${item.id}.m3u`}
                className="btn"
                style={{ padding: '5px 10px', fontSize: 12, textDecoration: 'none' }}
              >
                Download .M3U
              </a>
              <button type="button" className="btn btn-ghost" style={{ padding: 4 }} onClick={() => setVlcInfo(null)}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Auto-Hiding Bottom Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '18px 18px 16px',
          background: 'linear-gradient(to top, rgba(0,0,0,0.92), rgba(0,0,0,0))',
          zIndex: 3,
          opacity: controlsVisible ? 1 : 0,
          pointerEvents: controlsVisible ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      >
        <div
          style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 8 }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (videoRef.current && duration > 0) {
              videoRef.current.currentTime = pct * duration;
            }
            scheduleHideControls(playing);
          }}
        >
          <div style={{ width: '100%', height: 5, borderRadius: 999, background: 'rgba(255,255,255,0.22)', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${bufferedPct}%`, background: 'rgba(255,255,255,0.4)' }} />
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progressPct}%`, background: '#00bfd8' }} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={togglePlay}>
              {playing ? <Pause size={18} /> : <Play size={18} fill="#fff" />}
            </button>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={() => seekBy(-10)} title="-10s">
              <RotateCcw size={16} />
            </button>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={() => seekBy(10)} title="+10s">
              <RotateCw size={16} />
            </button>

            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: 7 }}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (videoRef.current) videoRef.current.muted = next;
              }}
            >
              {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
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
              }}
              style={{ width: 70, accentColor: '#00bfd8' }}
            />

            <span style={{ fontSize: 12.5, color: '#cbd5e1', marginLeft: 6, fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => {
                setObjectFit((f) => (f === 'contain' ? 'cover' : 'contain'));
                scheduleHideControls(playing);
              }}
              title="Toggle Fit / Fill Screen"
            >
              <Scaling size={13} /> {objectFit === 'contain' ? 'Fit' : 'Fill'}
            </button>
            <button type="button" className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={handleSpeedChange}>
              <Gauge size={13} /> {speed}x
            </button>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={togglePiP} title="Picture-in-Picture">
              <PictureInPicture2 size={17} />
            </button>
            <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={toggleFullscreen} title="Fullscreen">
              {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
