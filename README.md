# 🎮 RetroPlay — Self-Hosted Retro Game Emulator

A self-hosted web-based retro game emulator with a built-in ROM store. Browse, download, and play classic games directly in your browser.

![EmulatorJS](https://img.shields.io/badge/EmulatorJS-CDN-e94560) ![Node.js](https://img.shields.io/badge/Node.js-20-green) ![Docker](https://img.shields.io/badge/Docker-ready-blue)

## Features

- **🕹️ Play in Browser** — Emulates NES, SNES, N64, Game Boy, GBA, DS, PSP, Genesis, Master System, and Atari 2600 using [EmulatorJS](https://emulatorjs.org/)
- **🏪 Built-in ROM Store** — Browse and download ROMs from romsgames.net directly from the UI
- **📤 ROM Upload** — Drag-and-drop upload for your own ROM files
- **🖼️ Cover Art** — Auto-downloads cover art; also supports manual upload
- **💾 Save States** — Persistent save states stored on the server
- **🔍 Search** — Search across your entire game library
- **📱 Responsive** — Works on desktop and mobile

## How It Works

### Architecture

```
┌──────────────────────────────────────────────┐
│  Browser (index.html / player.html)          │
│  ├── Game Library UI (Netflix-style grid)     │
│  ├── ROM Store Modal (browse romsgames.net)   │
│  └── EmulatorJS Player (CDN-loaded)           │
└──────────────┬───────────────────────────────┘
               │ HTTP
┌──────────────▼───────────────────────────────┐
│  Node.js / Express Server (server.js)        │
│  ├── /api/systems — List systems & ROMs       │
│  ├── /api/store/browse — Scrape ROM listings  │
│  ├── /api/store/download — Download & save    │
│  ├── /api/roms/:system — Upload ROMs          │
│  ├── /api/saves/:system/:file — Save states   │
│  └── Static: /roms, /saves, /covers           │
└──────────────┬───────────────────────────────┘
               │ File System
┌──────────────▼───────────────────────────────┐
│  /data/roms/     (organized by system)        │
│  /data/saves/    (save states)                │
│  /data/covers/   (cover art images)           │
└──────────────────────────────────────────────┘
```

### ROM Store Flow

1. **Browse**: The server scrapes romsgames.net listing pages using `cheerio`, extracting ROM names, cover images, and slugs
2. **Download**: When you click "Download & Play", the server:
   - Fetches the ROM detail page to get the `mediaId`
   - POSTs to the romsgames.net download API to get a temporary download URL
   - Downloads the ROM file and cover art to the local filesystem
3. **Play**: The ROM appears in your library and EmulatorJS loads it in the browser

### Supported Systems

| System | Core | Extensions |
|--------|------|------------|
| NES | `nes` | `.nes`, `.zip` |
| SNES | `snes` | `.smc`, `.sfc`, `.zip` |
| Nintendo 64 | `n64` | `.n64`, `.z64`, `.v64`, `.zip` |
| Game Boy | `gb` | `.gb`, `.zip` |
| Game Boy Advance | `gba` | `.gba`, `.zip` |
| Nintendo DS | `nds` | `.nds`, `.zip` |
| PSP | `psp` | `.iso`, `.cso`, `.pbp` |
| Sega Genesis | `segaMD` | `.md`, `.gen`, `.bin`, `.zip` |
| Sega Master System | `segaMS` | `.sms`, `.zip` |
| Atari 2600 | `atari2600` | `.a26`, `.bin`, `.zip` |

## Quick Start

### Docker (Recommended)

```bash
docker build -t retroplay .
docker run -d \
  --name retroplay \
  -p 3000:3000 \
  -v ./roms:/data/roms \
  -v ./saves:/data/saves \
  -v ./covers:/data/covers \
  retroplay
```

Then open http://localhost:3000

### Docker Compose

```yaml
services:
  retroplay:
    build: .
    container_name: retroplay
    ports:
      - "3000:3000"
    volumes:
      - ./roms:/data/roms
      - ./saves:/data/saves
      - ./covers:/data/covers
    restart: unless-stopped
```

### Manual

```bash
npm install
node server.js
# Server runs on http://localhost:3000
```

## Usage

1. **Upload ROMs**: Click "📤 Upload" → select system → drag & drop ROM files
2. **ROM Store**: Click "🏪 ROM Store" → pick a system → browse → click "Download & Play"
3. **Play**: Click any game card in the library to launch the emulator
4. **Manage**: Right-click (or ⋯ menu) on any game to upload cover art or delete

## License

MIT
