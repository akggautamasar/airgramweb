const bigInt = require('big-integer');
const { getModeConfig, computeBackoffMs, ThroughputEstimator, STREAMING_MODES } = require('./streamingPolicy');

/**
 * In-memory LRU Chunk Cache + HTTP 206 Range Streaming Engine
 */
class StreamEngine {
  constructor(maxCacheMb = 256) {
    this.maxCacheBytes = Math.max(32, Number(maxCacheMb) || 256) * 1024 * 1024;
    this.cache = new Map(); // key -> { buffer, size }
    this.currentCacheBytes = 0;
    this.throughput = new ThroughputEstimator();
    this.stats = {
      cacheHits: 0,
      cacheMisses: 0,
      totalBytesServed: 0,
      activeStreams: 0,
      lastError: null,
    };
  }

  getCacheItem(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    // Refresh LRU position
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.buffer;
  }

  setCacheItem(key, buffer) {
    if (!buffer || buffer.length === 0 || buffer.length > this.maxCacheBytes / 4) return;
    if (this.cache.has(key)) {
      const prev = this.cache.get(key);
      this.currentCacheBytes -= prev.size;
      this.cache.delete(key);
    }
    while (this.currentCacheBytes + buffer.length > this.maxCacheBytes && this.cache.size > 0) {
      const oldestKey = this.cache.keys().next().value;
      const oldest = this.cache.get(oldestKey);
      this.currentCacheBytes -= oldest.size;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { buffer, size: buffer.length });
    this.currentCacheBytes += buffer.length;
  }

  clearCache() {
    this.cache.clear();
    this.currentCacheBytes = 0;
  }

  getDiagnostics() {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    return {
      cacheUsedMb: Number((this.currentCacheBytes / (1024 * 1024)).toFixed(2)),
      cacheMaxMb: Math.round(this.maxCacheBytes / (1024 * 1024)),
      cacheEntries: this.cache.size,
      cacheHitRate: total > 0 ? Math.round((this.stats.cacheHits / total) * 100) : 0,
      totalServedMb: Number((this.stats.totalBytesServed / (1024 * 1024)).toFixed(2)),
      activeStreams: this.stats.activeStreams,
      estimatedKbps: this.throughput.getKbps(),
      estimatedMbps: this.throughput.getMbps(),
      lastError: this.stats.lastError,
    };
  }

  /**
   * Parses HTTP Range header: "bytes=start-end"
   */
  parseRange(rangeHeader, fileSize) {
    if (!rangeHeader || !rangeHeader.startsWith('bytes=')) {
      return null;
    }
    const [rawStart, rawEnd] = rangeHeader.replace('bytes=', '').split('-');
    let start = rawStart ? parseInt(rawStart, 10) : 0;
    let end = rawEnd ? parseInt(rawEnd, 10) : fileSize - 1;

    if (Number.isNaN(start) && !Number.isNaN(end)) {
      // suffix-byte-range-spec: bytes=-500
      start = Math.max(0, fileSize - end);
      end = fileSize - 1;
    }
    if (Number.isNaN(start) || start < 0) start = 0;
    if (Number.isNaN(end) || end >= fileSize) end = fileSize - 1;
    if (start > end || start >= fileSize) return { invalid: true };

    return { start, end, invalid: false };
  }

  /**
   * Streams a Telegram message's media over HTTP 206 Partial Content or 200 OK.
   */
  async handleStreamRequest({ req, res, client, message, meta, mode = STREAMING_MODES.FAST_WEB, download = false }) {
    const fileSize = Number(meta.size || 0);
    const mimeType = meta.mimeType || 'application/octet-stream';
    const fileName = (meta.fileName || `airgram_${message.id}`).replace(/["\r\n]/g, '_');

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    }

    if (req.method === 'HEAD') {
      if (fileSize > 0) res.setHeader('Content-Length', String(fileSize));
      return res.status(200).end();
    }

    if (!fileSize || !message.media) {
      return res.status(404).json({ error: 'Media not found or empty file size' });
    }

    const cfg = getModeConfig(mode);
    const range = this.parseRange(req.headers.range, fileSize);

    if (range && range.invalid) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    let start = range ? range.start : 0;
    let end = range ? range.end : fileSize - 1;

    // For non-download streaming, cap each 206 chunk window for instant startup & responsive seeking
    if (!download && range) {
      const requestedLen = end - start + 1;
      if (requestedLen > cfg.maxRangeBytes) {
        end = start + cfg.maxRangeBytes - 1;
      }
    }

    const contentLength = end - start + 1;

    if (range) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(contentLength));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(fileSize));
    }

    const cacheKey = `${meta.cacheId || `${meta.chatId}_${message.id}`}:${start}:${contentLength}`;
    const cached = !download ? this.getCacheItem(cacheKey) : null;
    if (cached) {
      this.stats.cacheHits += 1;
      this.stats.totalBytesServed += cached.length;
      res.end(cached);
      return;
    }

    this.stats.cacheMisses += 1;
    this.stats.activeStreams += 1;

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    const startedAt = Date.now();
    const collectedChunks = !download && contentLength <= cfg.maxRangeBytes ? [] : null;
    let bytesSent = 0;

    try {
      let attempt = 0;
      while (bytesSent < contentLength && !aborted) {
        try {
          const currentOffset = start + bytesSent;
          const remaining = contentLength - bytesSent;
          const iterator = client.iterDownload({
            file: message.media,
            offset: bigInt(currentOffset),
            limit: remaining,
            requestSize: cfg.mtprotoChunkSize,
            precise: true,
          });

          for await (const chunk of iterator) {
            if (aborted) break;
            if (!chunk || chunk.length === 0) continue;

            const slice = chunk.length > contentLength - bytesSent
              ? chunk.subarray(0, contentLength - bytesSent)
              : chunk;

            bytesSent += slice.length;
            this.stats.totalBytesServed += slice.length;

            if (collectedChunks) collectedChunks.push(slice);
            const canContinue = res.write(slice);
            if (!canContinue) {
              await new Promise((resolve) => res.once('drain', resolve));
            }
            if (bytesSent >= contentLength) break;
          }
          break; // Completed successfully
        } catch (err) {
          if (aborted) break;
          attempt += 1;
          this.stats.lastError = err.message || String(err);
          if (attempt > cfg.maxRetries) throw err;
          const delay = computeBackoffMs(attempt, mode);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (!aborted) {
        const elapsed = Date.now() - startedAt;
        this.throughput.record(bytesSent, elapsed);
        if (collectedChunks && bytesSent === contentLength) {
          this.setCacheItem(cacheKey, Buffer.concat(collectedChunks));
        }
        res.end();
      }
    } catch (err) {
      this.stats.lastError = err.message || String(err);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Stream interrupted: ' + (err.message || 'Unknown error') });
      } else {
        res.end();
      }
    } finally {
      this.stats.activeStreams = Math.max(0, this.stats.activeStreams - 1);
    }
  }
}

module.exports = { StreamEngine };
