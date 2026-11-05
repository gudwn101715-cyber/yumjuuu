import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import { CHANNELS, ITEMS, HALLS, NODES, BASE_MOVE_SPEED, computeStats } from '../shared/game.js';
import { SEATS } from '../shared/templeLayout.js';

async function fixture(t, options = {}) {
  let time = 100000;
  const game = createGameServer({
    dbPath: ':memory:',
    clock: () => time,
    random: () => 0,
    tickMs: 15,
    ...options,
  });
  const address = await game.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => game.close());
  return {
    game,
    base,
    advance: (ms) => {
      time += ms;
    },
    now: () => time,
  };
}

async function session(base, cookie) {
  const response = await fetch(`${base}/api/session`, { headers: cookie ? { cookie } : {} });
  assert.equal(response.status, 200);
  return {
    profile: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie,
    setCookie: response.headers.get('set-cookie'),
  };
}

async function client(f, channelId = 'ch-01', existingSession) {
  const auth = existingSession || (await session(f.base));
  const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/ws', {
    headers: { Cookie: auth.cookie, Origin: f.base },
  });
  const packets = [];
  const waiters = new Set();
  ws.on('message', (raw) => {
    const packet = JSON.parse(raw.toString());
    packets.push(packet);
    for (const waiter of [...waiters])
      if (waiter.test(packet)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(packet);
      }
  });
  const wait = (predicate, since = packets.length) => {
    const existing = packets.slice(since).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolveWait, reject) => {
      const waiter = { test: predicate, resolve: resolveWait };
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`Timed out; last packets: ${JSON.stringify(packets.slice(-2))}`));
      }, 3000);
      waiters.add(waiter);
    });
  };
  await once(ws, 'open');
  await wait((packet) => packet.type === 'connected', 0);
  const result = { ws, auth, packets, wait, send: (packet) => ws.send(JSON.stringify(packet)) };
  const joined = wait((packet) => packet.type === 'state' && packet.channel.id === channelId);
  result.send({ type: 'join', channelId, name: `수행자-${auth.profile.id.slice(0, 4)}` });
  result.state = await joined;
  return result;
}

async function moveTo(f, c, x, z) {
  let last = c.packets.findLast((packet) => packet.type === 'state') || c.state;
  for (let i = 0; i < 60 && Math.hypot(last.self.x - x, last.self.z - z) > 0.1; i++) {
    f.advance(300);
    const before = { x: last.self.x, z: last.self.z };
    const changed = c.wait(
      (packet) =>
        packet.type === 'state' &&
        Math.hypot(packet.self.x - before.x, packet.self.z - before.z) > 0.01,
    );
    c.send({ type: 'move', x, z });
    last = await changed;
  }
  assert.ok(
    Math.hypot(last.self.x - x, last.self.z - z) < 0.2,
    'walked to target using server-limited steps',
  );
  return last;
}

test('session cookie, starter equipment, ten channels, and reconnect identity', async (t) => {
  const f = await fixture(t);
  const auth = await session(f.base);
  assert.match(auth.setCookie, /HttpOnly/);
  assert.match(auth.setCookie, /SameSite=Lax/);
  assert.equal(auth.profile.gender, 'male');
  const c = await client(f, 'ch-01', auth);
  assert.equal(c.state.self.gender, 'male');
  assert.equal(c.state.self.inventory.length, 4);
  assert.equal(c.state.self.equipped.beads.length, 3);
  assert.deepEqual(c.state.self.stats, { moveSpeed: 0, bowSpeed: 3, dropRate: 0, capacity: 8 });
  const health = await (await fetch(`${f.base}/api/health`)).json();
  assert.equal(health.channels, 10);
  assert.equal(health.capacityPerChannel, 108);
  const channels = await (await fetch(`${f.base}/api/channels`)).json();
  assert.equal(channels.channels.length, 10);
  assert.equal(channels.channels[0].count, 1);
  const renamed = c.wait((packet) => packet.type === 'state' && packet.self.name === '고요한 도반');
  c.send({ type: 'join', channelId: 'ch-01', name: '고요한 도반' });
  assert.equal((await renamed).self.name, '고요한 도반', 'same-room join updates profile name');
  c.ws.close();
  await once(c.ws, 'close');
  const again = await client(f, 'ch-01', auth);
  assert.equal(again.state.self.id, auth.profile.id);
  assert.deepEqual(again.state.self.inventory, c.state.self.inventory);
});

test('gender customization updates same-channel presence and survives optional joins and reconnects', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const customized = a.wait((packet) => packet.type === 'state' && packet.self.gender === 'female');
  const visibleToOther = b.wait(
    (packet) =>
      packet.type === 'state' &&
      packet.players.some(
        (player) => player.id === a.auth.profile.id && player.gender === 'female',
      ),
  );
  a.send({ type: 'join', channelId: 'ch-01', gender: 'female' });
  assert.equal((await customized).self.gender, 'female');
  await visibleToOther;
  assert.equal((await session(f.base, a.auth.cookie)).profile.gender, 'female');

  for (const gender of ['invalid', null, { value: 'male' }]) {
    const invalid = a.wait((packet) => packet.code === 'INVALID_GENDER');
    const unchanged = a.wait(
      (packet) => packet.type === 'state' && packet.self.gender === 'female',
    );
    a.send({ type: 'join', channelId: 'ch-01', gender });
    await invalid;
    assert.equal(
      (await unchanged).self.gender,
      'female',
      'invalid enum values preserve appearance',
    );
  }
  const renamed = a.wait(
    (packet) => packet.type === 'state' && packet.self.name === '고요한 수행자',
  );
  a.send({ type: 'join', channelId: 'ch-01', name: '고요한 수행자' });
  assert.equal((await renamed).self.gender, 'female', 'omitting gender preserves the saved choice');
  const switched = b.wait((packet) => packet.type === 'state' && packet.channel.id === 'ch-02');
  b.send({ type: 'join', channelId: 'ch-02', gender: 'female' });
  assert.equal(
    (await switched).self.gender,
    'female',
    'a channel join also accepts a valid choice',
  );

  a.ws.close();
  await once(a.ws, 'close');
  const again = await client(f, 'ch-01', a.auth);
  assert.equal(again.state.self.gender, 'female');
  const optionalSwitch = again.wait(
    (packet) => packet.type === 'state' && packet.channel.id === 'ch-03',
  );
  again.send({ type: 'join', channelId: 'ch-03' });
  assert.equal((await optionalSwitch).self.gender, 'female');
});

test('multiplayer presence and chat stay in their channel; teleport attempts are clamped', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const c = await client(f, 'ch-02');
  const aState = await a.wait((packet) => packet.type === 'state' && packet.players.length === 2);
  assert.equal(
    aState.players.some((player) => player.id === b.auth.profile.id),
    true,
  );
  assert.equal(c.state.players.length, 1);
  const chatA = a.wait((packet) => packet.type === 'chat' && packet.text === '함께 쉬어가요');
  const chatB = b.wait((packet) => packet.type === 'chat' && packet.text === '함께 쉬어가요');
  a.send({ type: 'chat', text: '함께 쉬어가요' });
  assert.equal((await chatA).playerId, a.auth.profile.id);
  assert.equal((await chatB).name, aState.self.name);
  assert.equal(
    c.packets.some((packet) => packet.type === 'chat'),
    false,
  );
  f.advance(1000);
  const moved = a.wait((packet) => packet.type === 'state' && packet.self.x > 0);
  a.send({ type: 'move', x: 1000000, z: -1000000 });
  const next = await moved;
  assert.ok(
    Math.hypot(next.self.x, next.self.z - 20) <= BASE_MOVE_SPEED * 0.35 + 0.001,
    'single movement limited to 350 ms speed budget',
  );
  const seenByOther = await b.wait(
    (packet) =>
      packet.type === 'state' &&
      packet.players.some((player) => player.id === a.auth.profile.id && player.x > 0),
  );
  assert.ok(seenByOther.players.find((player) => player.id === a.auth.profile.id).x < 5);
});

test('seating validates reach, reserves each cushion per channel, and retains seated bows', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const isolated = await client(f, 'ch-02');
  const seat = SEATS.find((entry) => entry.hallId === 'hall-main' && entry.column === 3);
  assert.equal(a.state.self.seatId, null);

  const unknown = a.wait((packet) => packet.code === 'SEAT_UNKNOWN');
  a.send({ type: 'sit', seatId: 'invented-cushion' });
  assert.match((await unknown).text, /방석/);
  const far = a.wait((packet) => packet.code === 'SEAT_TOO_FAR');
  a.send({ type: 'sit', seatId: seat.id });
  assert.match((await far).text, /가까이/);
  await moveTo(f, a, seat.x + 1, seat.z);
  await moveTo(f, b, seat.x, seat.z);
  await moveTo(f, isolated, seat.x, seat.z);

  const seated = a.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  a.send({ type: 'sit', seatId: seat.id });
  const sitting = await seated;
  assert.equal(sitting.self.x, seat.x, 'a nearby player snaps to the cushion center');
  assert.equal(sitting.self.z, seat.z);
  assert.equal(sitting.players.find((player) => player.id === a.auth.profile.id).seatId, seat.id);
  await b.wait(
    (packet) =>
      packet.type === 'state' &&
      packet.players.some((player) => player.id === a.auth.profile.id && player.seatId === seat.id),
  );
  const occupied = b.wait((packet) => packet.code === 'SEAT_OCCUPIED');
  b.send({ type: 'sit', seatId: seat.id });
  assert.match((await occupied).text, /다른 도반/);
  assert.equal(b.packets.findLast((packet) => packet.type === 'state').self.seatId, null);
  const separateSeat = isolated.wait(
    (packet) => packet.type === 'state' && packet.self.seatId === seat.id,
  );
  isolated.send({ type: 'sit', seatId: seat.id });
  assert.equal(
    (await separateSeat).channel.id,
    'ch-02',
    'other channels reserve seats independently',
  );

  const bowing = a.wait((packet) => packet.type === 'state' && packet.self.bowingUntil > f.now());
  a.send({ type: 'bow', hallId: seat.hallId });
  assert.equal((await bowing).self.seatId, seat.id);
  const completed = a.wait((packet) => packet.type === 'state' && packet.self.bows === 1);
  f.advance(3100);
  const bowed = await completed;
  assert.equal(bowed.self.seatId, seat.id);
  assert.equal(bowed.halls.find((hall) => hall.id === seat.hallId).progress, 1);

  const standing = a.wait((packet) => packet.type === 'state' && packet.self.seatId === null);
  a.send({ type: 'stand' });
  await standing;
  const bSeated = b.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  b.send({ type: 'sit', seatId: seat.id });
  await bSeated;
  f.advance(300);
  const moved = b.wait(
    (packet) => packet.type === 'state' && packet.self.seatId === null && packet.self.x > seat.x,
  );
  b.send({ type: 'move', x: seat.x + 1, z: seat.z });
  await moved;
  const reclaimed = a.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  a.send({ type: 'sit', seatId: seat.id });
  await reclaimed;
});

test('disconnects, channel changes, and session handoffs release ephemeral seats', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const seat = SEATS.find((entry) => entry.hallId === 'hall-main' && entry.column === 3);
  await moveTo(f, a, seat.x, seat.z);
  await moveTo(f, b, seat.x, seat.z);
  const aSeated = a.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  a.send({ type: 'sit', seatId: seat.id });
  await aSeated;
  a.ws.close();
  await once(a.ws, 'close');
  await b.wait(
    (packet) =>
      packet.type === 'state' && !packet.players.some((player) => player.id === a.auth.profile.id),
  );
  const bSeated = b.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  b.send({ type: 'sit', seatId: seat.id });
  await bSeated;

  const reconnected = await client(f, 'ch-01', a.auth);
  assert.equal(reconnected.state.self.seatId, null, 'reconnect starts without a seat reservation');
  const switched = b.wait((packet) => packet.type === 'state' && packet.channel.id === 'ch-03');
  b.send({ type: 'join', channelId: 'ch-03' });
  assert.equal((await switched).self.seatId, null);
  await moveTo(f, reconnected, seat.x, seat.z);
  const reclaimed = reconnected.wait(
    (packet) => packet.type === 'state' && packet.self.seatId === seat.id,
  );
  reconnected.send({ type: 'sit', seatId: seat.id });
  await reclaimed;
  const replacement = await client(f, 'ch-01', a.auth);
  assert.equal(replacement.state.self.seatId, null, 'a same-session handoff releases the old seat');
  const joinedBack = b.wait((packet) => packet.type === 'state' && packet.channel.id === 'ch-01');
  b.send({ type: 'join', channelId: 'ch-01' });
  await joinedBack;
  await moveTo(f, b, seat.x, seat.z);
  const freeAgain = b.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  b.send({ type: 'sit', seatId: seat.id });
  await freeAgain;
});

test('gather requires reach, has shared cooldown, awards theme loot, and equips real stats', async (t) => {
  const f = await fixture(t);
  const c = await client(f);
  const node = NODES[0];
  const denied = c.wait((packet) => packet.type === 'notice' && packet.kind === 'error');
  c.send({ type: 'gather', nodeId: node.id });
  assert.match((await denied).text, /가까이/);
  await moveTo(f, c, node.x, node.z);
  const gained = c.wait((packet) => packet.type === 'state' && packet.self.inventory.length === 5);
  c.send({ type: 'gather', nodeId: node.id });
  const gathered = await gained;
  const item = gathered.self.inventory.at(-1);
  assert.equal(item.defId, 'bamboo-bead');
  assert.ok(gathered.nodes.find((entry) => entry.id === node.id).readyAt > f.now());
  const cooldown = c.wait((packet) => packet.type === 'notice' && packet.kind === 'error');
  c.send({ type: 'gather', nodeId: node.id });
  assert.match((await cooldown).text, /다시/);
  const equipped = c.wait(
    (packet) => packet.type === 'state' && packet.self.equipped.beads.includes(item.id),
  );
  c.send({ type: 'equip', itemId: item.id });
  assert.equal((await equipped).self.stats.moveSpeed, 2);
  const forged = c.wait((packet) => packet.type === 'notice' && packet.kind === 'error');
  c.send({ type: 'equip', itemId: 'not-owned' });
  assert.match((await forged).text, /가지고/);
  const unequipped = c.wait(
    (packet) => packet.type === 'state' && !packet.self.equipped.beads.includes(item.id),
  );
  c.send({ type: 'unequip', itemId: item.id });
  assert.equal((await unequipped).self.stats.moveSpeed, 0);
});

test('timed bows are cancellable and 108 shared bows reward only contributors in that hall/channel', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const isolated = await client(f, 'ch-02');
  const hall = HALLS[0];
  const denied = a.wait((packet) => packet.type === 'notice' && packet.kind === 'error');
  a.send({ type: 'bow', hallId: hall.id });
  assert.match((await denied).text, /법당/);
  await moveTo(f, a, hall.x, hall.z);
  const bowing = a.wait((packet) => packet.type === 'state' && packet.self.bowingUntil > f.now());
  a.send({ type: 'bow', hallId: hall.id });
  const started = await bowing;
  assert.equal(started.self.bows, 0);
  f.advance(100);
  const cancelled = a.wait(
    (packet) => packet.type === 'state' && packet.self.bowingUntil === 0 && packet.self.x > 0,
  );
  a.send({ type: 'move', x: 1, z: hall.z });
  assert.equal((await cancelled).self.bows, 0);
  await moveTo(f, b, hall.x, hall.z);
  f.game.rooms.get('ch-01').halls[0].progress = 106;
  const first = a.wait((packet) => packet.type === 'state' && packet.self.bowingUntil > f.now());
  const second = b.wait((packet) => packet.type === 'state' && packet.self.bowingUntil > f.now());
  a.send({ type: 'bow', hallId: hall.id });
  b.send({ type: 'bow', hallId: hall.id });
  await Promise.all([first, second]);
  const rewardA = a.wait(
    (packet) =>
      packet.type === 'state' && packet.self.bows === 1 && packet.self.inventory.length === 6,
  );
  const rewardB = b.wait(
    (packet) =>
      packet.type === 'state' && packet.self.bows === 1 && packet.self.inventory.length === 6,
  );
  f.advance(3100);
  const completed = await Promise.all([rewardA, rewardB]);
  assert.equal(completed[0].halls[0].progress, 0);
  assert.equal(completed[1].halls[0].progress, 0);
  assert.equal(isolated.packets.findLast((packet) => packet.type === 'state').halls[0].progress, 0);
  assert.equal(
    isolated.packets.findLast((packet) => packet.type === 'state').self.inventory.length,
    4,
  );
});

test('channel capacity rejects extra clients; cross-origin websocket upgrades are forbidden', async (t) => {
  const f = await fixture(t, { channelCapacity: 2 });
  const original = await client(f);
  await client(f);
  const replacement = await client(f, 'ch-01', original.auth);
  assert.equal(
    replacement.state.self.id,
    original.state.self.id,
    'same-session reconnect replaces its occupied slot in a full channel',
  );
  assert.equal(f.game.rooms.get('ch-01').players.size, 2);
  const c = await client(f, 'ch-02');
  const full = c.wait((packet) => packet.type === 'notice' && packet.code === 'CHANNEL_FULL');
  c.send({ type: 'join', channelId: 'ch-01' });
  assert.match((await full).text, /가득/);
  assert.equal(f.game.rooms.get('ch-01').players.size, 2);
  assert.equal(
    f.game.rooms.get('ch-02').players.size,
    1,
    'failed channel switch preserves original room',
  );
  const denied = new WebSocket(f.base.replace('http:', 'ws:') + '/ws', {
    headers: { Cookie: c.auth.cookie, Origin: 'https://untrusted.example' },
  });
  const error = await once(denied, 'error');
  assert.match(error[0].message, /403/);
});

test('default channel accepts 108 simultaneous sockets and rejects a 109th player', async (t) => {
  const f = await fixture(t, { tickMs: 1000 });
  const connected = [];
  for (let i = 0; i < 108; i++) connected.push(await client(f));
  assert.equal(f.game.rooms.get('ch-01').players.size, 108);
  assert.equal(
    connected.every((c) => c.ws.readyState === WebSocket.OPEN),
    true,
  );
  const overflow = await client(f, 'ch-02');
  const rejected = overflow.wait(
    (packet) => packet.type === 'notice' && packet.code === 'CHANNEL_FULL',
  );
  overflow.send({ type: 'join', channelId: 'ch-01' });
  await rejected;
  assert.equal(f.game.rooms.get('ch-01').players.size, 108);
  const health = await (await fetch(`${f.base}/api/health`)).json();
  assert.equal(health.online, 109, 'overflow player remains in the other channel');
});

test('SQLite preserves inventory, equipment, and gender; legacy profiles default to male', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'temple-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let time = 100000;
  const dbPath = join(dir, 'save.sqlite');
  const game = createGameServer({ dbPath, clock: () => time, random: () => 0, tickMs: 15 });
  const addr = await game.listen(0, '127.0.0.1');
  const f = {
    game,
    base: `http://127.0.0.1:${addr.port}`,
    advance: (ms) => {
      time += ms;
    },
  };
  const c = await client(f);
  await moveTo(f, c, NODES[0].x, NODES[0].z);
  const gained = c.wait((packet) => packet.type === 'state' && packet.self.inventory.length === 5);
  c.send({ type: 'gather', nodeId: NODES[0].id });
  const before = await gained;
  const seat = SEATS.find((entry) => entry.hallId === 'hall-main' && entry.column === 3);
  await moveTo(f, c, seat.x, seat.z);
  const seated = c.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  c.send({ type: 'sit', seatId: seat.id });
  await seated;
  const customized = c.wait((packet) => packet.type === 'state' && packet.self.gender === 'female');
  c.send({ type: 'join', channelId: 'ch-01', gender: 'female' });
  await customized;
  const legacy = await session(f.base);
  await game.close();
  const saved = new DatabaseSync(dbPath);
  const row = saved.prepare('SELECT data FROM profiles WHERE id = ?').get(legacy.profile.id);
  const legacyData = JSON.parse(row.data);
  delete legacyData.gender;
  saved
    .prepare('UPDATE profiles SET data = ? WHERE id = ?')
    .run(JSON.stringify(legacyData), legacy.profile.id);
  saved.close();
  const restarted = createGameServer({ dbPath, tickMs: 15 });
  t.after(() => restarted.close());
  const newAddr = await restarted.listen(0, '127.0.0.1');
  const again = await client({ base: `http://127.0.0.1:${newAddr.port}` }, 'ch-01', c.auth);
  assert.equal(again.state.self.id, before.self.id);
  assert.deepEqual(again.state.self.inventory, before.self.inventory);
  assert.deepEqual(again.state.self.equipped, before.self.equipped);
  assert.equal(again.state.self.gender, 'female');
  assert.equal(again.state.self.seatId, null, 'seat reservations are not restored from SQLite');
  const base = `http://127.0.0.1:${newAddr.port}`;
  assert.equal((await session(base, c.auth.cookie)).profile.gender, 'female');
  const restoredLegacy = await session(base, legacy.cookie);
  assert.equal(restoredLegacy.profile.gender, 'male');
  const legacyClient = await client({ base }, 'ch-01', restoredLegacy);
  assert.equal(legacyClient.state.self.gender, 'male');
  assert.equal(
    legacyClient.state.players.find((player) => player.id === c.auth.profile.id).gender,
    'female',
  );
});

test('stat calculation enforces cord capacity, deduplicates beads, and bounds multipliers', () => {
  assert.equal(CHANNELS.length, 10);
  assert.equal(new Set(CHANNELS.map((channel) => channel.theme)).size, 10);
  const inventory = [
    { id: 'cord', defId: 'hemp-cord' },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, defId: 'ebony-bead' })),
  ];
  const result = computeStats(inventory, {
    cord: 'cord',
    beads: inventory.slice(1).map((item) => item.id),
  });
  assert.deepEqual(result, { capacity: 8, moveSpeed: 40, bowSpeed: 64, dropRate: 96 });
  assert.equal(
    computeStats(inventory, { cord: 'cord', beads: ['b0', 'b0'] }).dropRate,
    ITEMS['ebony-bead'].stats.dropRate,
  );
  assert.equal(computeStats(inventory, { cord: null, beads: ['b0'] }).dropRate, 0);
});
