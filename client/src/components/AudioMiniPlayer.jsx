import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, X, Music } from 'lucide-react';
import { formatDuration, streamUrl } from '../api';

export default function AudioMiniPlayer({ track, mode, onPrev, onNext, onClose }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track?.duration || 0);

  useEffect(() => {
    if (track && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [track?.chatId, track?.id]);

  if (!track) return null;

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(760px, calc(100vw - 24px))',
        zIndex: 55,
        background: 'rgba(13, 19, 35, 0.94)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(59, 130, 246, 0.35)',
        borderRadius: 16,
        padding: '10px 16px',
        boxShadow: '0 18px 48px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        color: '#f1f5f9',
      }}
    >
      <audio
        ref={audioRef}
        src={streamUrl(track.chatId, track.id, mode, false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || track.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={onNext}
      />

      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'linear-gradient(135deg, #2563eb, #00bfd8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Music size={18} color="#fff" />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.title}
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
          {track.performer || 'Telegram Audio'} · {formatDuration(currentTime)} / {formatDuration(duration)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onPrev}>
          <SkipBack size={16} />
        </button>
        <button type="button" className="btn btn-primary" style={{ padding: 8, borderRadius: '50%' }} onClick={togglePlay}>
          {playing ? <Pause size={16} /> : <Play size={16} fill="#fff" />}
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onNext}>
          <SkipForward size={16} />
        </button>
        <button type="button" className="btn btn-ghost" style={{ padding: 7 }} onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
