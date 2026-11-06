import http from 'node:http';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CHANNELS,
  THEMES,
  ITEMS,
  RARITIES,
  HALLS,
  NODES,
  WORLD,
  SPAWN,
  CHANNEL_CAPACITY,
  BASE_MOVE_SPEED,
  BASE_BOW_DURATION,
  GATHER_REACH,
  computeStats,
  bowDropChance,
} from '../shared/game.js';
import { SEATS, INCENSE_STATIONS, incenseQueuePosition } from '../shared/templeLayout.js';
import { moveWithCollisions } from '../shared/worldCollision.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const seatsById = new Map(SEATS.map((seat) => [seat.id, seat]));
const SEAT_REACH = 1.8;

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const cleanText = (value, limit) =>
  [
    ...String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim(),
  ]
    .slice(0, limit)
    .join('');
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const mimeTypes = {
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createGameServer(options = {}) {
  const clock = options.clock || Date.now;
  const random = options.random || Math.random;
  const capacity = Math.min(CHANNEL_CAPACITY, options.channelCapacity || CHANNEL_CAPACITY);
  const dbPath =
    options.dbPath || process.env.GAME_DB_PATH || join(projectRoot, '.data', 'temple.sqlite');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, session_hash TEXT UNIQUE NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL);',
  );
  const selectProfile = db.prepare('SELECT id, data FROM profiles WHERE session_hash = ?');
  const saveProfile = db.prepare(
    'INSERT INTO profiles(id, session_hash, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at',
  );
  const profiles = new Map();
  const peers = new Set();
  const activeSessions = new Map();
  const connectionsByIp = new Map();
  const sessionWindows = new Map();
  const rooms = new Map(
    CHANNELS.map((def) => [
      def.id,
      {
        def,
        players: new Map(),
        halls: HALLS.map((hall) => ({ ...hall, progress: 0, goal: 108, participants: new Map() })),
        nodes: NODES.map((node) => ({ ...node, readyAt: 0 })),
        chat: [],
        incenseStations: INCENSE_STATIONS.map((station) => ({
          ...station,
          queue: [],
          activePlayerId: null,
          offeringUntil: 0,
        })),
      },
    ]),
  );

  function persist(profile) {
    const data = {
      name: profile.name,
      x: profile.x,
      z: profile.z,
      inventory: profile.inventory,
      equipped: profile.equipped,
      bows: profile.bows,
      collected: profile.collected,
      incenseOfferings: profile.incenseOfferings || 0,
    };
    saveProfile.run(profile.id, profile.sessionHash, JSON.stringify(data), clock());
    profile.dirty = false;
  }

  function newProfile(sessionHash) {
    const firstCord = { id: randomUUID(), defId: 'hemp-cord' };
    const firstBeads = Array.from({ length: 3 }, () => ({ id: randomUUID(), defId: 'pine-bead' }));
    const profile = {
      id: randomUUID(),
      sessionHash,
      name: `수행자 ${String(Math.floor(random() * 900) + 100)}`,
      ...SPAWN,
      inventory: [firstCord, ...firstBeads],
      equipped: { cord: firstCord.id, beads: firstBeads.map((item) => item.id) },
      bows: 0,
      collected: 0,
      incenseOfferings: 0,
      bowingUntil: 0,
      bowStartedAt: 0,
      bowDuration: 0,
      gassho: false,
      incenseStationId: null,
      incenseQueueIndex: null,
      incenseOfferingUntil: 0,
      bowHallId: null,
      seatId: null,
      moveAt: clock(),
      dirty: false,
    };
    profiles.set(profile.id, profile);
    persist(profile);
    return profile;
  }

  function loadSession(req) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('temple_session='))
      ?.slice(15);
    if (!cookie || !/^[A-Za-z0-9_-]{43}$/.test(cookie)) return null;
    const hash = tokenHash(cookie);
    const row = selectProfile.get(hash);
    if (!row) return null;
    if (profiles.has(row.id)) return profiles.get(row.id);
    const data = JSON.parse(row.data);
    const profile = {
      ...data,
      id: row.id,
      sessionHash: hash,
      bowingUntil: 0,
      bowStartedAt: 0,
      bowDuration: 0,
      gassho: false,
      incenseStationId: null,
      incenseQueueIndex: null,
      incenseOfferingUntil: 0,
      bowHallId: null,
      seatId: null,
      moveAt: clock(),
      dirty: false,
    };
    delete profile.gender;
    profile.incenseOfferings = Number.isFinite(profile.incenseOfferings)
      ? profile.incenseOfferings
      : 0;
    profile.inventory = profile.inventory.filter((item) => ITEMS[item.defId]);
    profiles.set(profile.id, profile);
    return profile;
  }

  function sameOrigin(req) {
    if (!req.headers.origin) return true; // Native clients still require an unguessable session cookie.
    try {
      const origin = new URL(req.headers.origin);
      return origin.host === req.headers.host && ['http:', 'https:'].includes(origin.protocol);
    } catch {
      return false;
    }
  }

  function json(res, status, body, headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    });
    res.end(JSON.stringify(body));
  }

  function publicChannels() {
    return [...rooms.values()].map((room) => ({ ...room.def, count: room.players.size, capacity }));
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return json(res, 400, { error: '잘못된 주소입니다.' });
    }
    if (req.method !== 'GET')
      return json(res, 405, { error: 'GET 요청만 지원합니다.' }, { Allow: 'GET' });
    if (url.pathname === '/api/health')
      return json(res, 200, {
        ok: true,
        channels: 10,
        capacityPerChannel: capacity,
        online: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0),
      });
    if (url.pathname === '/api/channels') return json(res, 200, { channels: publicChannels() });
    if (url.pathname === '/api/session') {
      if (!sameOrigin(req)) return json(res, 403, { error: '허용되지 않은 출처입니다.' });
      let profile = loadSession(req);
      const headers = {};
      if (!profile) {
        const ip = req.socket.remoteAddress || 'unknown';
        let window = sessionWindows.get(ip);
        if (!window || clock() - window.start > 60000) {
          window = { start: clock(), count: 0 };
          sessionWindows.set(ip, window);
        }
        // The bundled Vite proxy and a deployment reverse proxy share one socket
        // address. This bootstrap limit must permit the full 1,080-player world;
        // per-user flood control belongs at the trusted ingress proxy.
        if (++window.count > (options.maxNewSessionsPerMinute || 1200))
          return json(res, 429, { error: '잠시 후 다시 접속해 주세요.' });
        const token = randomBytes(32).toString('base64url');
        profile = newProfile(tokenHash(token));
        headers['Set-Cookie'] =
          `temple_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${(options.secureCookie ?? process.env.COOKIE_SECURE === 'true') ? '; Secure' : ''}`;
      }
      const result = { id: profile.id, name: profile.name };
      if (![...peers].some((peer) => peer.profile.id === profile.id)) profiles.delete(profile.id);
      return json(res, 200, result, headers);
    }
    if (url.pathname.startsWith('/api/'))
      return json(res, 404, { error: 'API를 찾을 수 없습니다.' });
    const dist = options.distPath || join(projectRoot, 'dist');
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: '잘못된 주소입니다.' });
    }
    const requested = resolve(dist, `.${pathname}`);
    if (requested !== resolve(dist) && !requested.startsWith(resolve(dist) + sep))
      return json(res, 403, { error: '접근할 수 없습니다.' });
    let filename = requested;
    try {
      if (!statSync(filename).isFile()) filename = join(dist, 'index.html');
    } catch {
      filename = join(dist, 'index.html');
    }
    try {
      const body = readFileSync(filename);
      res.writeHead(200, {
        'Content-Type': mimeTypes[extname(filename)] || 'application/octet-stream',
        'Cache-Control': filename.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    } catch {
      json(res, 404, { error: '클라이언트를 빌드하거나 Vite 개발 서버를 실행해 주세요.' });
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });

  function send(peer, message) {
    if (peer.ws.readyState !== WebSocket.OPEN) return;
    if (peer.ws.bufferedAmount > 256 * 1024) return peer.ws.close(4008, '연결이 너무 느립니다.');
    peer.ws.send(JSON.stringify(message));
  }
  const notice = (peer, text, kind = 'info', extra = {}) =>
    send(peer, { type: 'notice', text, kind, ...extra });
  function broadcast(room, packet) {
    for (const peer of room.players.values()) send(peer, packet);
  }

  function clearBow(profile) {
    profile.bowingUntil = 0;
    profile.bowStartedAt = 0;
    profile.bowDuration = 0;
    profile.bowHallId = null;
  }

  function syncIncenseQueue(room, station) {
    station.queue = station.queue.filter((id) => room.players.has(id));
    station.queue.forEach((id, index) => {
      const profile = room.players.get(id).profile;
      profile.incenseStationId = station.id;
      profile.incenseQueueIndex = index;
      profile.incenseOfferingUntil = station.activePlayerId === id ? station.offeringUntil : 0;
    });
    if (!station.queue.includes(station.activePlayerId)) {
      station.activePlayerId = null;
      station.offeringUntil = 0;
    }
  }

  function leaveIncense(peer) {
    if (peer.room) {
      for (const station of peer.room.incenseStations) {
        station.queue = station.queue.filter((id) => id !== peer.profile.id);
        syncIncenseQueue(peer.room, station);
      }
    }
    peer.profile.incenseStationId = null;
    peer.profile.incenseQueueIndex = null;
    peer.profile.incenseOfferingUntil = 0;
  }

  function leave(peer) {
    if (!peer.room) return;
    const room = peer.room;
    leaveIncense(peer);
    if (room.players.get(peer.profile.id) === peer) room.players.delete(peer.profile.id);
    peer.room = null;
    clearBow(peer.profile);
    peer.profile.gassho = false;
    peer.profile.seatId = null;
    persist(peer.profile);
  }

  function publicPlayer(profile) {
    const definitions = new Map(profile.inventory.map((item) => [item.id, item.defId]));
    const defId = (id) => definitions.get(id);
    return {
      id: profile.id,
      name: profile.name,
      x: profile.x,
      z: profile.z,
      bowingUntil: profile.bowingUntil,
      bowStartedAt: profile.bowStartedAt,
      bowDuration: profile.bowDuration,
      gassho: profile.gassho,
      incenseStationId: profile.incenseStationId,
      incenseQueueIndex: profile.incenseQueueIndex,
      incenseOfferingUntil: profile.incenseOfferingUntil,
      seatId: profile.seatId,
      showcase: {
        cord: defId(profile.equipped.cord),
        beads: profile.equipped.beads.map(defId).filter(Boolean),
        bows: profile.bows,
      },
    };
  }

  function state(peer, now = clock(), players = null) {
    if (!peer.room) return;
    const { profile, room } = peer;
    const self = {
      ...publicPlayer(profile),
      inventory: profile.inventory,
      equipped: profile.equipped,
      stats: computeStats(profile.inventory, profile.equipped),
      bows: profile.bows,
      collected: profile.collected,
      incenseOfferings: profile.incenseOfferings || 0,
      bowHallId: profile.bowHallId,
    };
    send(peer, {
      type: 'state',
      self,
      players: players || [...room.players.values()].map((other) => publicPlayer(other.profile)),
      channel: { ...room.def, count: room.players.size, capacity },
      halls: room.halls.map(({ id, name, x, z, radius, progress, goal }) => ({
        id,
        name,
        x,
        z,
        radius,
        progress,
        goal,
      })),
      nodes: room.nodes.map(({ id, readyAt }) => ({ id, readyAt })),
      incenseStations: room.incenseStations.map(
        ({ queue, activePlayerId, offeringUntil, ...station }) => ({
          ...station,
          queue: [...queue],
          activePlayerId,
          offeringUntil,
        }),
      ),
      serverTime: now,
    });
  }

  function award(peer, guaranteed = false) {
    const { profile, room } = peer;
    const stats = computeStats(profile.inventory, profile.equipped);
    if (!guaranteed && random() >= bowDropChance(stats)) return null;
    if (profile.inventory.length >= 500) {
      notice(peer, '소지품이 가득 찼습니다. 현재 보관 한도는 500개입니다.', 'error');
      return null;
    }
    const candidates = THEMES[room.def.theme].loot.map((id) => ITEMS[id]);
    const weights = candidates.map(
      (item) =>
        RARITIES[item.rarity].weight *
        (['rare', 'epic', 'legendary'].includes(item.rarity) ? 1 + stats.dropRate / 100 : 1),
    );
    let roll = random() * weights.reduce((a, b) => a + b, 0);
    let chosen = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        chosen = candidates[i];
        break;
      }
    }
    const item = { id: randomUUID(), defId: chosen.id };
    profile.inventory.push(item);
    profile.collected++;
    profile.dirty = true;
    notice(peer, `${chosen.name} 획득`, 'loot', { loot: item });
    return item;
  }

  function equip(peer, itemId, remove = false) {
    const { profile } = peer;
    const instance = profile.inventory.find((item) => item.id === itemId);
    if (!instance) return notice(peer, '가지고 있는 아이템만 장착할 수 있습니다.', 'error');
    const def = ITEMS[instance.defId];
    if (def.type === 'cord') {
      profile.equipped.cord = remove
        ? profile.equipped.cord === itemId
          ? null
          : profile.equipped.cord
        : itemId;
      const capacity = remove
        ? computeStats(profile.inventory, profile.equipped).capacity
        : def.capacity;
      profile.equipped.beads = profile.equipped.beads.slice(0, capacity);
    } else if (remove) {
      profile.equipped.beads = profile.equipped.beads.filter((id) => id !== itemId);
    } else {
      if (profile.equipped.beads.includes(itemId)) return;
      if (
        profile.equipped.beads.length >= computeStats(profile.inventory, profile.equipped).capacity
      )
        return notice(peer, '염주띠의 빈 자리가 없습니다. 더 긴 띠를 장착해 보세요.', 'error');
      profile.equipped.beads.push(itemId);
    }
    persist(profile);
    notice(peer, remove ? '장착을 해제했습니다.' : `${def.name} 장착`);
    state(peer);
  }

  function handle(peer, packet) {
    const now = clock();
    if (packet.type === 'join') {
      const room = rooms.get(packet.channelId);
      if (!room) return notice(peer, '채널을 찾을 수 없습니다.', 'error');
      if (room === peer.room) {
        const name = cleanText(packet.name, 16);
        if (name && name !== peer.profile.name) {
          if (name) peer.profile.name = name;
          persist(peer.profile);
        }
        return state(peer);
      }
      const occupiedByOthers = room.players.size - (room.players.has(peer.profile.id) ? 1 : 0);
      if (occupiedByOthers >= capacity)
        return notice(peer, '채널이 가득 찼습니다. 다른 채널을 선택해 주세요.', 'error', {
          code: 'CHANNEL_FULL',
        });
      leave(peer);
      const oldPeer = activeSessions.get(peer.profile.id);
      if (oldPeer && oldPeer !== peer) {
        leave(oldPeer);
        oldPeer.ws.close(4001, '다른 창에서 접속했습니다.');
      }
      activeSessions.set(peer.profile.id, peer);
      const name = cleanText(packet.name, 16);
      if (name) peer.profile.name = name;
      peer.profile.x = SPAWN.x;
      peer.profile.z = SPAWN.z;
      peer.profile.moveAt = now;
      peer.profile.seatId = null;
      peer.room = room;
      room.players.set(peer.profile.id, peer);
      persist(peer.profile);
      state(peer);
      for (const chat of room.chat) send(peer, chat);
      notice(peer, `${room.def.name}에 오신 것을 환영합니다. 천천히 둘러보세요.`);
      return;
    }
    if (!peer.room) return notice(peer, '먼저 채널에 입장해 주세요.', 'error');
    const { profile, room } = peer;
    if (packet.type === 'move') {
      if (profile.incenseOfferingUntil > now) return;
      if (!Number.isFinite(packet.x) || !Number.isFinite(packet.z)) return;
      const x = Math.max(WORLD.minX, Math.min(WORLD.maxX, packet.x));
      const z = Math.max(WORLD.minZ, Math.min(WORLD.maxZ, packet.z));
      const dx = x - profile.x,
        dz = z - profile.z,
        length = Math.hypot(dx, dz);
      const elapsed = Math.min(0.35, Math.max(0, now - profile.moveAt) / 1000);
      const maxMove =
        BASE_MOVE_SPEED *
        (1 + computeStats(profile.inventory, profile.equipped).moveSpeed / 100) *
        elapsed;
      profile.moveAt = now;
      if (length > 0.01 && maxMove > 0) {
        const ratio = Math.min(1, maxMove / length);
        const next = moveWithCollisions(profile, {
          x: profile.x + dx * ratio,
          z: profile.z + dz * ratio,
        });
        profile.x = next.x;
        profile.z = next.z;
        clearBow(profile);
        profile.gassho = false;
        profile.seatId = null;
        profile.dirty = true;
      }
    } else if (packet.type === 'sit') {
      const seat = seatsById.get(packet.seatId);
      if (!seat) return notice(peer, '방석을 찾을 수 없습니다.', 'error', { code: 'SEAT_UNKNOWN' });
      if (distance(profile, seat) > SEAT_REACH)
        return notice(peer, '방석에 조금 더 가까이 다가가 주세요.', 'error', {
          code: 'SEAT_TOO_FAR',
        });
      if (
        [...room.players.values()].some(
          (other) => other !== peer && other.profile.seatId === seat.id,
        )
      )
        return notice(peer, '다른 도반이 앉아 있는 방석입니다.', 'error', {
          code: 'SEAT_OCCUPIED',
        });
      leaveIncense(peer);
      profile.gassho = false;
      profile.x = seat.x;
      profile.z = seat.z;
      profile.moveAt = now;
      profile.seatId = seat.id;
      clearBow(profile);
      profile.dirty = true;
      state(peer);
    } else if (packet.type === 'stand') {
      profile.seatId = null;
      clearBow(profile);
      state(peer);
    } else if (packet.type === 'gassho') {
      if (profile.bowingUntil > now || profile.incenseStationId) return;
      profile.gassho = !profile.gassho;
      state(peer);
    } else if (packet.type === 'bow') {
      if (profile.bowingUntil > now) return;
      const seat = seatsById.get(profile.seatId);
      if (!seat || distance(profile, seat) > 0.3)
        return notice(peer, '방석 위에 자리를 잡은 뒤 절할 수 있습니다.', 'error', {
          code: 'SEAT_REQUIRED',
        });
      const hall = room.halls.find((entry) => entry.id === seat.hallId);
      if (!hall || (packet.hallId && packet.hallId !== hall.id))
        return notice(peer, '이 방석의 법당을 향해 절해 주세요.', 'error', {
          code: 'SEAT_REQUIRED',
        });
      profile.gassho = false;
      profile.bowStartedAt = now;
      profile.bowDuration =
        BASE_BOW_DURATION / (1 + computeStats(profile.inventory, profile.equipped).bowSpeed / 100);
      profile.bowingUntil = now + profile.bowDuration;
      profile.bowHallId = hall.id;
      state(peer);
    } else if (packet.type === 'queueIncense') {
      const station = room.incenseStations.find((entry) => entry.id === packet.stationId);
      if (!station)
        return notice(peer, '향로를 찾을 수 없습니다.', 'error', { code: 'INCENSE_UNKNOWN' });
      if (profile.incenseStationId === station.id) return state(peer);
      if (distance(profile, station.entrance) > 2)
        return notice(peer, '향 공양 대기줄 입구로 다가가 주세요.', 'error', {
          code: 'INCENSE_TOO_FAR',
        });
      if (station.queue.length >= capacity)
        return notice(peer, '향 공양 대기줄이 가득 찼습니다.', 'error', { code: 'INCENSE_FULL' });
      leaveIncense(peer);
      clearBow(profile);
      profile.gassho = false;
      profile.seatId = null;
      station.queue.push(profile.id);
      syncIncenseQueue(room, station);
      notice(peer, '향 공양 대기줄에 섰습니다. 차례가 되면 향을 올립니다.');
      state(peer);
    } else if (packet.type === 'leaveIncense') {
      leaveIncense(peer);
      state(peer);
    } else if (packet.type === 'gather') {
      const node = room.nodes.find((entry) => entry.id === packet.nodeId);
      if (!node || distance(profile, node) > GATHER_REACH)
        return notice(peer, '채집 지점에 조금 더 가까이 다가가 주세요.', 'error');
      if (node.readyAt > now) return notice(peer, '자연이 다시 선물을 준비하고 있어요.', 'error');
      if (profile.inventory.length >= 500) return notice(peer, '소지품이 가득 찼습니다.', 'error');
      node.readyAt = now + 8000;
      award(peer, true);
      persist(profile);
      state(peer);
    } else if (packet.type === 'equip') equip(peer, packet.itemId);
    else if (packet.type === 'unequip') equip(peer, packet.itemId, true);
    else if (packet.type === 'chat') {
      const text = cleanText(packet.text, 160);
      if (!text) return;
      if (now - peer.lastChat < 1000)
        return notice(peer, '대화는 잠시 간격을 두고 나누어 주세요.', 'error');
      peer.lastChat = now;
      const message = {
        type: 'chat',
        id: randomUUID(),
        playerId: profile.id,
        name: profile.name,
        text,
        at: now,
      };
      room.chat.push(message);
      if (room.chat.length > 30) room.chat.shift();
      broadcast(room, message);
    }
  }

  server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== '/ws' || !sameOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    const profile = loadSession(req);
    if (!profile) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    const ip = req.socket.remoteAddress || 'unknown';
    if (
      peers.size >= (options.maxConnections || 1200) ||
      (connectionsByIp.get(ip) || 0) >= (options.maxConnectionsPerIp || 1200)
    ) {
      if (![...peers].some((peer) => peer.profile.id === profile.id)) profiles.delete(profile.id);
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, profile, ip));
  });

  wss.on('connection', (ws, req, profile, ip) => {
    connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
    const peer = {
      ws,
      profile,
      ip,
      room: null,
      alive: true,
      rateStart: clock(),
      rateCount: 0,
      lastChat: -Infinity,
    };
    peers.add(peer);
    ws.on('pong', () => {
      peer.alive = true;
    });
    ws.on('error', () => {});
    ws.on('message', (raw) => {
      const now = clock();
      if (now - peer.rateStart >= 1000) {
        peer.rateStart = now;
        peer.rateCount = 0;
      }
      if (++peer.rateCount > 45) return ws.close(4008, '요청이 너무 많습니다.');
      let packet;
      try {
        packet = JSON.parse(raw.toString());
      } catch {
        return notice(peer, '잘못된 요청입니다.', 'error');
      }
      if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return;
      try {
        handle(peer, packet);
      } catch (error) {
        console.error('Game action failed:', error.message);
        notice(peer, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
      }
    });
    ws.on('close', () => {
      leave(peer);
      peers.delete(peer);
      connectionsByIp.set(ip, Math.max(0, (connectionsByIp.get(ip) || 1) - 1));
      if (activeSessions.get(profile.id) === peer) activeSessions.delete(profile.id);
      if (![...peers].some((other) => other.profile.id === profile.id)) profiles.delete(profile.id);
    });
    send(peer, {
      type: 'connected',
      id: profile.id,
      channels: publicChannels(),
      serverTime: clock(),
    });
  });

  function tick() {
    const now = clock();
    for (const room of rooms.values()) {
      for (const peer of room.players.values()) {
        const profile = peer.profile;
        if (profile.bowingUntil && profile.bowingUntil <= now) {
          const hall = room.halls.find((entry) => entry.id === profile.bowHallId);
          const seat = seatsById.get(profile.seatId);
          clearBow(profile);
          if (hall && seat?.hallId === hall.id && distance(profile, seat) <= 0.3) {
            profile.bows++;
            profile.dirty = true;
            hall.progress++;
            hall.participants.set(profile.id, now);
            if (!award(peer)) notice(peer, '한 번의 절, 마음이 조금 더 고요해졌습니다.');
            if (hall.progress >= hall.goal) {
              hall.progress -= hall.goal;
              for (const participant of room.players.values()) {
                if (
                  hall.participants.has(participant.profile.id) &&
                  now - hall.participants.get(participant.profile.id) < 600000 &&
                  distance(participant.profile, hall) <= hall.radius
                ) {
                  notice(
                    participant,
                    `${hall.name} 백팔배 완성! 함께한 수행에 감사드립니다.`,
                    'celebration',
                  );
                  award(participant, true);
                  persist(participant.profile);
                }
              }
              hall.participants.clear();
            }
            persist(profile);
          }
        }
      }
      for (const station of room.incenseStations) {
        syncIncenseQueue(room, station);
        const first = room.players.get(station.queue[0]);
        if (!first) continue;
        if (station.activePlayerId && station.offeringUntil <= now) {
          first.profile.incenseOfferings = (first.profile.incenseOfferings || 0) + 1;
          first.profile.dirty = true;
          notice(first, '향 공양을 마쳤습니다. 맑은 향이 산사에 머뭅니다.', 'incense-complete');
          leaveIncense(first);
          persist(first.profile);
        } else if (!station.activePlayerId) {
          const front = incenseQueuePosition(0, station.id);
          if (distance(first.profile, front) <= 1.4) {
            first.profile.x = front.x;
            first.profile.z = front.z;
            first.profile.moveAt = now;
            station.activePlayerId = first.profile.id;
            station.offeringUntil = now + station.duration;
            first.profile.incenseOfferingUntil = station.offeringUntil;
          }
        }
      }
      // Public appearance is identical for every recipient in a channel. Build it
      // once rather than repeating the inventory lookup for every pair of peers.
      const players = [...room.players.values()].map((peer) => publicPlayer(peer.profile));
      for (const peer of room.players.values()) state(peer, now, players);
    }
  }
  const tickTimer = setInterval(tick, options.tickMs || 100);
  const heartbeatTimer = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        peer.ws.terminate();
        continue;
      }
      peer.alive = false;
      peer.ws.ping();
    }
    const now = clock();
    for (const [ip, window] of sessionWindows)
      if (now - window.start > 60000) sessionWindows.delete(ip);
    for (const [ip, count] of connectionsByIp) if (!count) connectionsByIp.delete(ip);
  }, 30000);
  const saveTimer = setInterval(() => {
    for (const profile of profiles.values()) if (profile.dirty) persist(profile);
  }, 5000);
  for (const timer of [tickTimer, heartbeatTimer, saveTimer]) timer.unref();

  return {
    server,
    wss,
    rooms,
    tick,
    listen(port = options.port ?? 3001, host = options.host || '0.0.0.0') {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolveListen(server.address());
        });
      });
    },
    close() {
      for (const timer of [tickTimer, heartbeatTimer, saveTimer]) clearInterval(timer);
      for (const peer of [...peers]) {
        leave(peer);
        peer.ws.terminate();
      }
      for (const profile of profiles.values()) if (profile.dirty) persist(profile);
      return new Promise((resolveClose) => {
        wss.close(() => {
          server.close(() => {
            db.close();
            resolveClose();
          });
        });
      });
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  const address = await game.listen(Number(process.env.PORT || 3001));
  console.log(`염주 온라인 서버: http://localhost:${address.port} · 10개 채널 / 채널당 108명`);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await game.close();
      process.exit(0);
    });
}
