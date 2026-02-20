const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const cors = require('cors');
const { Server: SocketIO } = require('socket.io');

const app = express();
app.use(cors({ origin: '*' }));
const server = http.createServer(app);

const ROMS_DIR = '/data/roms';
const SAVES_DIR = '/data/saves';
const COVERS_DIR = '/data/covers';

// Multer storage: saves uploaded ROMs to the correct system directory
const romStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(ROMS_DIR, req.params.system);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const uploadRom = multer({ storage: romStorage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// Multer for cover images
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(COVERS_DIR, req.params.system);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, req.params.romName + ext);
  },
});
const uploadCover = multer({ storage: coverStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const SYSTEMS = {
  nes:       { core: 'nes',       name: 'Nintendo (NES)',             ext: ['.nes', '.zip'] },
  snes:      { core: 'snes',      name: 'Super Nintendo (SNES)',      ext: ['.smc', '.sfc', '.zip'] },
  n64:       { core: 'n64',       name: 'Nintendo 64',                ext: ['.n64', '.z64', '.v64', '.zip'] },
  gb:        { core: 'gb',        name: 'Game Boy',                   ext: ['.gb', '.zip'] },
  gba:       { core: 'gba',       name: 'Game Boy Advance',           ext: ['.gba', '.zip'] },
  nds:       { core: 'nds',       name: 'Nintendo DS',                ext: ['.nds', '.zip'] },
  psp:       { core: 'psp',       name: 'PlayStation Portable (PSP)', ext: ['.iso', '.cso', '.pbp'] },
  segaMD:    { core: 'segaMD',    name: 'Sega Genesis / Mega Drive',  ext: ['.md', '.gen', '.bin', '.zip'] },
  segaMS:    { core: 'segaMS',    name: 'Sega Master System',         ext: ['.sms', '.zip'] },
  atari2600: { core: 'atari2600', name: 'Atari 2600',                 ext: ['.a26', '.bin', '.zip'] },
  arcade:    { core: 'arcade',    name: 'Arcade (FBNeo)',             ext: ['.zip'] },
};

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve ROMs
app.use('/roms', express.static(ROMS_DIR));

// Serve saves
app.use('/saves', express.static(SAVES_DIR));

// Serve cover images
app.use('/covers', express.static(COVERS_DIR));

// API: List all systems and their ROMs
app.get('/api/systems', (req, res) => {
  const result = [];
  for (const [id, sys] of Object.entries(SYSTEMS)) {
    const romDir = path.join(ROMS_DIR, id);
    let roms = [];
    try {
      roms = fs.readdirSync(romDir)
        .filter(f => {
          const lower = f.toLowerCase();
          return sys.ext.some(e => lower.endsWith(e)) && !f.startsWith('.');
        })
        .sort()
        .map(f => {
          const name = path.parse(f).name;
          const coverDir = path.join(COVERS_DIR, id);
          let cover = null;
          try {
            const coverFiles = fs.readdirSync(coverDir);
            const match = coverFiles.find(c => c.startsWith(name + '.') || c.startsWith(name));
            if (match) cover = '/covers/' + id + '/' + match;
          } catch(e) {}
          return { name, file: f, cover };
        });
    } catch (e) { /* directory may not exist yet */ }
    result.push({ id, core: sys.core, name: sys.name, romCount: roms.length, roms });
  }
  res.json(result);
});

// API: Upload ROMs
app.post('/api/roms/:system', uploadRom.array('roms', 50), (req, res) => {
  const system = req.params.system;
  if (!SYSTEMS[system]) return res.status(400).json({ error: 'Unknown system' });
  const uploaded = (req.files || []).map(f => f.originalname);
  res.json({ ok: true, system, uploaded, count: uploaded.length });
});

// API: Upload cover image for a ROM
app.post('/api/covers/:system/:romName', uploadCover.single('cover'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, path: '/covers/' + req.params.system + '/' + req.file.filename });
});

// API: Delete a ROM
app.delete('/api/roms/:system/:file', (req, res) => {
  const filePath = path.join(ROMS_DIR, req.params.system, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Upload save state
app.put('/api/saves/:system/:file', express.raw({ limit: '50mb', type: '*/*' }), (req, res) => {
  try {
    const dir = path.join(SAVES_DIR, req.params.system);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, req.params.file), req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// API: Download save state
app.get('/api/saves/:system/:file', (req, res) => {
  const savePath = path.join(SAVES_DIR, req.params.system, req.params.file);
  if (fs.existsSync(savePath)) return res.sendFile(savePath);
  res.status(404).json({ error: 'not found' });
});

// API: Search ROMs across all systems
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);
  const results = [];
  for (const [id, sys] of Object.entries(SYSTEMS)) {
    const romDir = path.join(ROMS_DIR, id);
    try {
      const roms = fs.readdirSync(romDir)
        .filter(f => {
          const lower = f.toLowerCase();
          return sys.ext.some(e => lower.endsWith(e)) && !f.startsWith('.') && lower.includes(q);
        })
        .map(f => {
          const name = path.parse(f).name;
          const coverDir = path.join(COVERS_DIR, id);
          let cover = null;
          try {
            const coverFiles = fs.readdirSync(coverDir);
            const match = coverFiles.find(c => c.startsWith(name + '.') || c.startsWith(name));
            if (match) cover = '/covers/' + id + '/' + match;
          } catch(e) {}
          return { name, file: f, cover, system: id, systemName: sys.name, core: sys.core };
        });
      results.push(...roms);
    } catch(e) {}
  }
  res.json(results);
});

// ── ROM Store: romsgames.net integration ──

const STORE_SYSTEMS = {
  nes:       { storeSlug: 'nintendo',              romPrefix: 'nintendo-rom-' },
  snes:      { storeSlug: 'super-nintendo',        romPrefix: 'super-nintendo-rom-' },
  n64:       { storeSlug: 'nintendo-64',            romPrefix: 'nintendo-64-rom-' },
  gb:        { storeSlug: 'gameboy',                romPrefix: 'gameboy-rom-' },
  gba:       { storeSlug: 'gameboy-advance',        romPrefix: 'gameboy-advance-rom-' },
  nds:       { storeSlug: 'nintendo-ds',            romPrefix: 'nintendo-ds-rom-' },
  psp:       { storeSlug: 'playstation-portable',   romPrefix: 'playstation-portable-rom-' },
  segaMD:    { storeSlug: 'sega-genesis',           romPrefix: 'sega-genesis-rom-' },
  segaMS:    { storeSlug: 'sega-master-system',     romPrefix: 'sega-master-system-rom-' },
  atari2600: { storeSlug: 'atari-2600',             romPrefix: 'atari-2006-rom-' },
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function postForm(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const postData = new URLSearchParams(body).toString();
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Invalid JSON: ' + data.slice(0,200))); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.romsgames.net/' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on('finish', () => ws.close(resolve));
      ws.on('error', reject);
    }).on('error', reject);
  });
}

// Browse ROMs from romsgames.net
app.get('/api/store/browse', async (req, res) => {
  const systemId = req.query.system || 'snes';
  const page = parseInt(req.query.page) || 1;
  const storeSys = STORE_SYSTEMS[systemId];
  if (!storeSys) return res.status(400).json({ error: 'Unknown system' });

  try {
    const url = `https://www.romsgames.net/roms/${storeSys.storeSlug}/?page=${page}&sort=popularity`;
    const html = await fetchUrl(url);
    const $ = cheerio.load(html);
    const roms = [];

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !href.startsWith('/') || !href.includes('-rom-')) return;
      const slug = href.replace(/^\/|\/$/g, '');
      // Only match ROMs for this system's prefix
      if (!slug.startsWith(storeSys.romPrefix)) return;
      const name = $(el).find('div').last().text().trim() || $(el).text().trim();
      if (!name) return;
      const img = $(el).find('img');
      let cover = img.attr('src') || '';
      if (cover.startsWith('//')) cover = 'https:' + cover;
      if (cover.includes('no-cover')) cover = '';
      // Avoid duplicates
      if (roms.find(r => r.slug === slug)) return;
      roms.push({ name, slug, cover, system: systemId });
    });

    // Parse total count from "Showing X to Y of Z"
    let total = 0;
    const bodyText = $('body').text();
    const showMatch = bodyText.match(/Showing\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i);
    if (showMatch) total = parseInt(showMatch[1].replace(/,/g, ''));

    res.json({ system: systemId, page, total, roms });
  } catch (e) {
    res.status(500).json({ error: 'Failed to browse store: ' + e.message });
  }
});

// Download a ROM from romsgames.net
app.post('/api/store/download', express.json(), async (req, res) => {
  const { slug, system } = req.body;
  if (!slug || !system) return res.status(400).json({ error: 'slug and system are required' });
  if (!SYSTEMS[system]) return res.status(400).json({ error: 'Unknown system' });

  try {
    // Step 1: Fetch the ROM page to get the mediaId
    const pageUrl = `https://www.romsgames.net/${slug}/`;
    const html = await fetchUrl(pageUrl);
    const $ = cheerio.load(html);
    const mediaId = $('button[data-media-id]').attr('data-media-id');
    if (!mediaId) return res.status(404).json({ error: 'ROM not found or no download available' });

    // Step 2: POST to get the download URL
    const dlInfo = await postForm(`https://www.romsgames.net/${slug}/?download`, { mediaId });
    if (!dlInfo || !dlInfo.downloadUrl) {
      return res.status(404).json({ error: 'Download URL not available' });
    }

    // Step 3: Download the file
    const fileName = decodeURIComponent(dlInfo.downloadName || (slug + '.zip'));
    const romDir = path.join(ROMS_DIR, system);
    fs.mkdirSync(romDir, { recursive: true });
    const destPath = path.join(romDir, fileName);

    // Check if already downloaded
    if (fs.existsSync(destPath)) {
      return res.json({ ok: true, file: fileName, system, alreadyExists: true });
    }

    // The download URL requires mediaId and attach query params
    const dlUrl = dlInfo.downloadUrl + '?mediaId=' + mediaId + '&attach=' + (dlInfo.downloadName || 'file.zip');
    await downloadFile(dlUrl, destPath);

    // Step 4: Also save the cover image if available
    const coverUrl = dlInfo.asset?.thumbnailUrl || '';
    if (coverUrl) {
      try {
        const coverDir = path.join(COVERS_DIR, system);
        fs.mkdirSync(coverDir, { recursive: true });
        const romName = path.parse(fileName).name;
        const coverExt = coverUrl.match(/\.(jpe?g|png|webp)/i)?.[0] || '.jpg';
        const coverPath = path.join(coverDir, romName + coverExt);
        let fullCoverUrl = coverUrl;
        if (fullCoverUrl.startsWith('//')) fullCoverUrl = 'https:' + fullCoverUrl;
        await downloadFile(fullCoverUrl, coverPath);
      } catch(e) { /* cover download is best-effort */ }
    }

    res.json({ ok: true, file: fileName, system, alreadyExists: false });
  } catch (e) {
    res.status(500).json({ error: 'Download failed: ' + e.message });
  }
});

// ── Netplay signaling server (socket.io) ──

const io = new SocketIO(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
});

let netplayRooms = {};

// Clean up empty rooms periodically
setInterval(() => {
  for (const sessionId in netplayRooms) {
    if (Object.keys(netplayRooms[sessionId].players).length === 0) {
      delete netplayRooms[sessionId];
    }
  }
}, 60000);

// List open rooms for a game
app.get('/list', (req, res) => {
  const gameId = req.query.game_id;
  const openRooms = {};
  for (const sessionId in netplayRooms) {
    const room = netplayRooms[sessionId];
    if (room && Object.keys(room.players).length < room.maxPlayers && String(room.gameId) === gameId) {
      const ownerPlayerId = Object.keys(room.players).find(
        pid => room.players[pid].socketId === room.owner
      );
      openRooms[sessionId] = {
        room_name: room.roomName,
        current: Object.keys(room.players).length,
        max: room.maxPlayers,
        player_name: ownerPlayerId ? room.players[ownerPlayerId].player_name : 'Unknown',
        hasPassword: !!room.password,
      };
    }
  }
  res.json(openRooms);
});

io.on('connection', (socket) => {
  socket.on('open-room', (data, callback) => {
    const extra = data.extra || {};
    const sessionId = extra.sessionid;
    const playerId = extra.userid || extra.playerId;
    if (!sessionId || !playerId) return callback('Invalid data');
    if (netplayRooms[sessionId]) return callback('Room already exists');

    netplayRooms[sessionId] = {
      owner: socket.id,
      players: { [playerId]: { ...extra, socketId: socket.id } },
      peers: [],
      roomName: extra.room_name || `Room ${sessionId}`,
      gameId: extra.game_id || 'default',
      domain: extra.domain || 'unknown',
      password: data.password || null,
      maxPlayers: data.maxPlayers || 4,
    };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerId = playerId;
    io.to(sessionId).emit('users-updated', netplayRooms[sessionId].players);
    callback(null);
  });

  socket.on('join-room', (data, callback) => {
    const extra = data.extra || {};
    const sessionId = extra.sessionid;
    const playerId = extra.userid || extra.playerId;
    if (!sessionId || !playerId) return typeof callback === 'function' && callback('Invalid data');

    const room = netplayRooms[sessionId];
    if (!room) return typeof callback === 'function' && callback('Room not found');
    if (room.password && room.password !== (data.password || null)) return typeof callback === 'function' && callback('Incorrect password');
    if (Object.keys(room.players).length >= room.maxPlayers) return typeof callback === 'function' && callback('Room full');

    room.players[playerId] = { ...extra, socketId: socket.id };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerId = playerId;
    io.to(sessionId).emit('users-updated', room.players);
    if (typeof callback === 'function') callback(null, room.players);
  });

  function handleLeave() {
    const sessionId = socket.sessionId;
    const playerId = socket.playerId;
    if (!sessionId || !playerId || !netplayRooms[sessionId]) return;

    delete netplayRooms[sessionId].players[playerId];
    netplayRooms[sessionId].peers = netplayRooms[sessionId].peers.filter(
      p => p.source !== socket.id && p.target !== socket.id
    );
    io.to(sessionId).emit('users-updated', netplayRooms[sessionId].players);

    if (Object.keys(netplayRooms[sessionId].players).length === 0) {
      delete netplayRooms[sessionId];
    } else if (socket.id === netplayRooms[sessionId].owner) {
      const remaining = Object.keys(netplayRooms[sessionId].players);
      if (remaining.length > 0) {
        netplayRooms[sessionId].owner = netplayRooms[sessionId].players[remaining[0]].socketId;
      }
    }
    socket.leave(sessionId);
    delete socket.sessionId;
    delete socket.playerId;
  }

  socket.on('leave-room', handleLeave);

  socket.on('webrtc-signal', (data) => {
    const { target, candidate, offer, answer, requestRenegotiate } = data || {};
    if (requestRenegotiate && target) {
      const targetSocket = io.sockets.sockets.get(target);
      if (targetSocket) targetSocket.emit('webrtc-signal', { sender: socket.id, requestRenegotiate: true });
    } else if (target) {
      io.to(target).emit('webrtc-signal', { sender: socket.id, candidate, offer, answer });
    }
  });

  socket.on('data-message', (data) => { if (socket.sessionId) socket.to(socket.sessionId).emit('data-message', data); });
  socket.on('snapshot', (data) => { if (socket.sessionId) socket.to(socket.sessionId).emit('snapshot', data); });
  socket.on('input', (data) => { if (socket.sessionId) socket.to(socket.sessionId).emit('input', data); });
  socket.on('disconnect', handleLeave);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`EmulatorJS server running on http://0.0.0.0:${PORT}`);
  console.log(`Netplay signaling server active on same port`);
});
