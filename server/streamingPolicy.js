/**
 * AirGram Adaptive Streaming Policy
 * Ported & adapted from AirGram Android (Streaming.kt) for HTTP 206 Range web streaming.
 */

const STREAMING_MODES = {
  FAST_WEB: 'fast_web',
  TELEGRAM_HQ: 'telegram_hq',
};

const MODE_CONFIG = {
  [STREAMING_MODES.FAST_WEB]: {
    label: 'Fast Web',
    // Smaller MTProto requestSize starts playback immediately on slow links
    mtprotoChunkSize: 128 * 1024, // 128 KB
    // Cap each HTTP 206 response so browser receives first bytes quickly
    maxRangeBytes: 1024 * 1024, // 1 MB
    readAheadCapBytes: 4 * 1024 * 1024, // 4 MB
    initialRetryDelayMs: 400,
    maxRetryDelayMs: 4000,
    maxRetries: 4,
  },
  [STREAMING_MODES.TELEGRAM_HQ]: {
    label: 'Telegram HQ',
    mtprotoChunkSize: 512 * 1024, // 512 KB
    maxRangeBytes: 4 * 1024 * 1024, // 4 MB
    readAheadCapBytes: 32 * 1024 * 1024, // 32 MB
    initialRetryDelayMs: 300,
    maxRetryDelayMs: 3000,
    maxRetries: 5,
  },
};

class ThroughputEstimator {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.ewmaBps = 0;
    this.samples = 0;
  }

  record(bytes, durationMs) {
    if (!bytes || durationMs <= 0) return;
    const rawBps = (bytes * 8 * 1000) / durationMs;
    // Clamp samples between 50 kbps and 200 Mbps to ignore cache/timer spikes
    const clamped = Math.max(50_000, Math.min(200_000_000, rawBps));
    if (this.samples === 0) {
      this.ewmaBps = clamped;
    } else {
      this.ewmaBps = this.alpha * clamped + (1 - this.alpha) * this.ewmaBps;
    }
    this.samples += 1;
  }

  getKbps() {
    return Math.round(this.ewmaBps / 1000);
  }

  getMbps() {
    return Number((this.ewmaBps / 1_000_000).toFixed(2));
  }
}

function getModeConfig(mode) {
  return MODE_CONFIG[mode] || MODE_CONFIG[STREAMING_MODES.FAST_WEB];
}

function computeBackoffMs(attempt, mode) {
  const cfg = getModeConfig(mode);
  const exp = cfg.initialRetryDelayMs * Math.pow(2, Math.max(0, attempt));
  return Math.min(cfg.maxRetryDelayMs, exp);
}

module.exports = {
  STREAMING_MODES,
  ThroughputEstimator,
  getModeConfig,
  computeBackoffMs,
};
