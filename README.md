# AirGram Web

**Fast, zero-buffer online Telegram media player & file library** — combining the native AirGram APK experience with DemiPlay's 3-mode login, Saved Messages session backup, and instant adaptive web streaming.

## Features

- **3-Mode Telegram Authentication**:
  - **QR Scan**: Instant QR code login (`Settings → Devices → Link Desktop Device`), with automatic 2FA password prompt if enabled.
  - **Phone + OTP + 2FA**: Classic mobile number login with verification code and cloud password support.
  - **Paste Key (Session String)**: Instant one-paste login using your saved session string.
- **Automatic Saved Messages Backup**: On login via QR or Phone+2FA, AirGram automatically sends your encrypted-in-chat `AirGram Web Login Backup` session key to your Telegram **Saved Messages** so you can log in on any other device without scanning a QR code again.
- **Instant Streaming Even on Slow Internet**:
  - **HTTP 206 Partial Content Range Engine** with an in-memory LRU chunk cache and GramJS MTProto streaming.
  - **Fast Web vs Telegram HQ Mode Toggle** right inside the player:
    - **Fast Web**: Smaller initial chunk requests (`128 KB`), fast startup, bounded rebuffer backoff, and suspends background thumbnail fetches while playing.
    - **Telegram HQ**: High-throughput `512 KB`–`1 MB` chunks and larger read-ahead window for crisp 1080p/4K playback.
  - **EWMA Throughput Estimator & Diagnostics**: Real-time bitrate/speed readout, buffer health, cache hit rate, and one-click cache clear.
- **Full AirGram Media & File Experience**:
  - **Chats Sidebar**: Saved Messages pinned at top, Channels, Groups, Private Chats, type filters, and instant chat search.
  - **Media Browser**: **Videos**, **Audio**, **Photos**, and **Documents** tabs with **Grid / List** toggle, inline instant minithumbnails, lazy thumbnails, chat-wide search, and 40-item pagination.
  - **Video Player**: Custom DemiPlay-style player with `-10s / +10s` skip, playback speed (`0.5x`–`2x`), Picture-in-Picture, Fullscreen, Technical Specifications modal, **per-file resume position**, and **`Play in VLC`** (opens `vlc://` deep link, copies direct stream URL, or downloads `.m3u`).
  - **Persistent Audio Mini-Player**: Plays audio in the background as you browse chats, with Next/Previous queue controls and artwork.
  - **Photo & PDF Viewers**: Fast photo preview with **Load Full Quality** toggle + zoom; built-in PDF viewer + download.

---

## Quick Start (Local or Oracle Cloud)

### 1. Get Telegram API Credentials
1. Go to [https://my.telegram.org](https://my.telegram.org) and log in.
2. Open **API development tools** and create an app to get your `TG_API_ID` and `TG_API_HASH`.

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your TG_API_ID, TG_API_HASH, and a random APP_SECRET
```

### 3. Run with Node.js (Recommended on Oracle Cloud)
```bash
npm run setup
npm run build
npm start
```
Open `http://localhost:3000` (or your Oracle VM's public IP / domain).

### 4. One-Command Oracle Cloud Setup (Ubuntu + PM2)
```bash
chmod +x deploy-oracle.sh
./deploy-oracle.sh
```

### 5. Docker Deployment
```bash
docker compose up -d --build
```

### Oracle Cloud Networking Note
Remember to allow TCP ports `80` and `443` (or `3000`) in **both**:
1. **OCI Console → Networking → Virtual Cloud Networks → Security Lists → Ingress Rules**
2. **VM Firewall (`iptables` / `ufw`)** inside the Ubuntu/Oracle Linux instance.
Use `nginx.conf.example` as your reverse proxy so `proxy_buffering off;` keeps video seeking instantaneous.
