import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.js';
import {
  CHANNELS,
  ITEMS,
  HALLS,
  NODES,
  BASE_MOVE_SPEED,
  BASE_BOW_DURATION,
  bowDropChance,
  computeStats,
} from '../shared/game.js';
import { SEATS, INCENSE_STATIONS, incenseQueuePosition } from '../shared/templeLayout.js';
import { findWalkPath } from '../shared/worldCollision.js';

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
  const route = findWalkPath(last.self, { x, z });
  assert.ok(route.length, 'target is reachable through open doors and stairs');
  for (const waypoint of route) {
    for (
      let i = 0;
      i < 120 && Math.hypot(last.self.x - waypoint.x, last.self.z - waypoint.z) > 0.08;
      i++
    ) {
      f.advance(300);
      const before = { x: last.self.x, z: last.self.z };
      const changed = c.wait(
        (packet) =>
          packet.type === 'state' &&
          packet.serverTime === f.now() &&
          Math.hypot(packet.self.x - before.x, packet.self.z - before.z) > 0.01,
      );
      c.send({ type: 'move', ...waypoint });
      last = await changed;
    }
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
  assert.equal('gender' in auth.profile, false);
  const c = await client(f, 'ch-01', auth);
  assert.equal('gender' in c.state.self, false);
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

test('gassho is a separate synchronized pose without bow progress or rewards', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const initial = a.state.self.inventory.length;
  const joined = a.wait((packet) => packet.type === 'state' && packet.self.gassho === true);
  a.send({ type: 'gassho' });
  const posing = await joined;
  assert.equal(posing.self.bowingUntil, 0);
  assert.equal(posing.self.bows, 0);
  assert.equal(posing.self.inventory.length, initial);
  await b.wait(
    (packet) =>
      packet.type === 'state' &&
      packet.players.some((player) => player.id === a.auth.profile.id && player.gassho),
  );
  f.advance(10000);
  const unchanged = await a.wait(
    (packet) => packet.type === 'state' && packet.serverTime === f.now(),
  );
  assert.equal(unchanged.self.bows, 0);
  assert.equal(unchanged.self.inventory.length, initial);
  assert.equal(
    unchanged.halls.every((hall) => hall.progress === 0),
    true,
  );
  const released = a.wait((packet) => packet.type === 'state' && packet.self.gassho === false);
  a.send({ type: 'gassho' });
  await released;
  const renamed = a.wait((packet) => packet.type === 'state' && packet.self.name === '둥근 수행자');
  a.send({ type: 'join', channelId: 'ch-01', name: '둥근 수행자', gender: 'female' });
  assert.equal('gender' in (await renamed).self, false, 'legacy client gender packets are ignored');
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
  f.advance(4300);
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

test('bows require cushions, cancel on movement, and cooperative rewards stay in their channel', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const isolated = await client(f, 'ch-02');
  const hall = HALLS[0];
  const seats = SEATS.filter((entry) => entry.hallId === hall.id);
  const seatA = seats[3];
  const seatB = seats[4];
  const denied = a.wait((packet) => packet.code === 'SEAT_REQUIRED');
  a.send({ type: 'bow', hallId: hall.id });
  assert.match((await denied).text, /방석/);
  await moveTo(f, a, seatA.x, seatA.z);
  const seatedA = a.wait((packet) => packet.type === 'state' && packet.self.seatId === seatA.id);
  a.send({ type: 'sit', seatId: seatA.id });
  await seatedA;
  const bowing = a.wait((packet) => packet.type === 'state' && packet.self.bowingUntil > f.now());
  a.send({ type: 'bow', hallId: hall.id });
  const started = await bowing;
  assert.equal(started.self.bows, 0);
  assert.equal(started.self.bowStartedAt, f.now());
  assert.equal(started.self.bowDuration, BASE_BOW_DURATION / 1.03);
  f.advance(100);
  const cancelled = a.wait(
    (packet) => packet.type === 'state' && packet.self.bowingUntil === 0 && packet.self.x > seatA.x,
  );
  a.send({ type: 'move', x: seatA.x + 1, z: seatA.z });
  assert.equal((await cancelled).self.bows, 0);
  const reseated = a.wait((packet) => packet.type === 'state' && packet.self.seatId === seatA.id);
  a.send({ type: 'sit', seatId: seatA.id });
  await reseated;
  await moveTo(f, b, seatB.x, seatB.z);
  const seatedB = b.wait((packet) => packet.type === 'state' && packet.self.seatId === seatB.id);
  b.send({ type: 'sit', seatId: seatB.id });
  await seatedB;
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
  f.advance(4300);
  const completed = await Promise.all([rewardA, rewardB]);
  assert.equal(completed[0].halls[0].progress, 0);
  assert.equal(completed[1].halls[0].progress, 0);
  assert.equal(isolated.packets.findLast((packet) => packet.type === 'state').halls[0].progress, 0);
  assert.equal(
    isolated.packets.findLast((packet) => packet.type === 'state').self.inventory.length,
    4,
  );
});

test('individual bows use an uncommon drop roll rather than a guaranteed item', async (t) => {
  const f = await fixture(t, { random: () => 0.5 });
  const c = await client(f);
  const seat = SEATS[3];
  await moveTo(f, c, seat.x, seat.z);
  const seated = c.wait((packet) => packet.type === 'state' && packet.self.seatId === seat.id);
  c.send({ type: 'sit', seatId: seat.id });
  await seated;
  for (let count = 1; count <= 3; count++) {
    const started = c.wait(
      (packet) => packet.type === 'state' && packet.self.bowingUntil > f.now(),
    );
    c.send({ type: 'bow', hallId: seat.hallId });
    await started;
    const completed = c.wait((packet) => packet.type === 'state' && packet.self.bows === count);
    f.advance(4300);
    assert.equal((await completed).self.inventory.length, 4);
  }
  assert.equal(bowDropChance(), 0.08);
  assert.equal(bowDropChance({ dropRate: 25 }), 0.11);
  assert.equal(bowDropChance({ dropRate: 100 }), 0.2);
  assert.equal(bowDropChance({ dropRate: 10000 }), 0.2);
  assert.equal(bowDropChance({ dropRate: -100 }), 0.08);
});

test('incense queues are FIFO, channel-local, and only serve the player at the front', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const isolated = await client(f, 'ch-02');
  const station = INCENSE_STATIONS[0];
  const denied = a.wait((packet) => packet.code === 'INCENSE_TOO_FAR');
  a.send({ type: 'queueIncense', stationId: station.id });
  await denied;
  await moveTo(f, a, station.entrance.x, station.entrance.z);
  const joinedA = a.wait(
    (packet) => packet.type === 'state' && packet.self.incenseQueueIndex === 0,
  );
  a.send({ type: 'queueIncense', stationId: station.id });
  await joinedA;
  await moveTo(f, b, station.entrance.x, station.entrance.z);
  const joinedB = b.wait(
    (packet) => packet.type === 'state' && packet.self.incenseQueueIndex === 1,
  );
  b.send({ type: 'queueIncense', stationId: station.id });
  const queuedB = await joinedB;
  assert.deepEqual(queuedB.incenseStations[0].queue, [a.auth.profile.id, b.auth.profile.id]);
  assert.equal(queuedB.self.incenseOfferingUntil, 0);
  assert.deepEqual(
    isolated.packets.findLast((packet) => packet.type === 'state').incenseStations[0].queue,
    [],
  );
  const front = incenseQueuePosition(0, station.id);
  await moveTo(f, a, front.x, front.z);
  const serving = await a.wait(
    (packet) => packet.type === 'state' && packet.self.incenseOfferingUntil > f.now(),
    0,
  );
  const inventory = serving.self.inventory.length;
  const completed = a.wait(
    (packet) => packet.type === 'notice' && packet.kind === 'incense-complete',
  );
  const promoted = b.wait(
    (packet) => packet.type === 'state' && packet.self.incenseQueueIndex === 0,
  );
  f.advance(station.duration + 1);
  await completed;
  const first = await promoted;
  assert.equal(first.self.incenseOfferingUntil, 0, 'promotion alone does not start the offering');
  const after = await a.wait(
    (packet) => packet.type === 'state' && packet.self.incenseStationId === null,
  );
  assert.equal(after.self.inventory.length, inventory, 'incense does not grant a guaranteed item');
  assert.equal(after.self.incenseOfferings, 1);
  const left = b.wait((packet) => packet.type === 'state' && packet.self.incenseStationId === null);
  b.send({ type: 'leaveIncense' });
  assert.deepEqual((await left).incenseStations[0].queue, []);
  for (let index = 0; index < 108; index++) {
    const position = incenseQueuePosition(index);
    assert.ok(position.x >= -76 && position.x <= 76 && position.z >= -76 && position.z <= 64);
  }
});

test('incense queues release places on disconnects and channel switches', async (t) => {
  const f = await fixture(t);
  const a = await client(f);
  const b = await client(f);
  const station = INCENSE_STATIONS[0];
  for (const c of [a, b]) {
    await moveTo(f, c, station.entrance.x, station.entrance.z);
    const queued = c.wait(
      (packet) => packet.type === 'state' && packet.self.incenseStationId === station.id,
    );
    c.send({ type: 'queueIncense', stationId: station.id });
    await queued;
  }
  a.ws.close();
  await once(a.ws, 'close');
  await b.wait((packet) => packet.type === 'state' && packet.self.incenseQueueIndex === 0);
  const switched = b.wait((packet) => packet.type === 'state' && packet.channel.id === 'ch-02');
  b.send({ type: 'join', channelId: 'ch-02' });
  assert.equal((await switched).self.incenseStationId, null);
  assert.deepEqual(f.game.rooms.get('ch-01').incenseStations[0].queue, []);
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

test('server movement blocks thin structures even when clients send coordinates beyond them', async (t) => {
  const f = await fixture(t);
  const c = await client(f);
  await moveTo(f, c, -15, -11);
  let last;
  for (let attempt = 0; attempt < 10; attempt++) {
    f.advance(300);
    const next = c.wait((packet) => packet.type === 'state' && packet.serverTime === f.now());
    c.send({ type: 'move', x: -50, z: -11 });
    last = await next;
  }
  assert.ok(last.self.x > -17 && last.self.x < -16.9, 'west wall stops an untrusted client');
  assert.equal(last.self.z, -11);
  for (let attempt = 0; attempt < 10; attempt++) {
    f.advance(300);
    const next = c.wait((packet) => packet.type === 'state' && packet.serverTime === f.now());
    c.send({ type: 'move', x: -50, z: -16 });
    last = await next;
  }
  assert.ok(last.self.x > -17, 'diagonal attempts cannot slip through the wall');
  assert.ok(last.self.z < -12, 'the same input can still slide along the structure');
  await moveTo(f, c, 0, 3);
  const reached = await moveTo(f, c, 0, -15);
  assert.ok(Math.hypot(reached.self.x, reached.self.z + 15) < 0.2, 'centered stairs remain open');
});

test('SQLite preserves inventory and equipment while ignoring legacy gender fields', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'temple-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let time = 100000;
  const dbPath = join(dir, 'save.sqlite');
  const game = createGameServer({ dbPath, clock: () => time, random: () => 0, tickMs: 15 });
  const addr = await game.listen(0, '127.0.0.1');
  const f = {
    game,
    base: `http://127.0.0.1:${addr.port}`,
    now: () => time,
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
  const legacy = await session(f.base);
  await game.close();
  const saved = new DatabaseSync(dbPath);
  const row = saved.prepare('SELECT data FROM profiles WHERE id = ?').get(legacy.profile.id);
  const legacyData = JSON.parse(row.data);
  legacyData.gender = 'female';
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
  assert.equal('gender' in again.state.self, false);
  assert.equal(again.state.self.seatId, null, 'seat reservations are not restored from SQLite');
  const base = `http://127.0.0.1:${newAddr.port}`;
  assert.equal('gender' in (await session(base, c.auth.cookie)).profile, false);
  const restoredLegacy = await session(base, legacy.cookie);
  assert.equal('gender' in restoredLegacy.profile, false);
  const legacyClient = await client({ base }, 'ch-01', restoredLegacy);
  assert.equal('gender' in legacyClient.state.self, false);
  assert.equal(
    'gender' in legacyClient.state.players.find((player) => player.id === c.auth.profile.id),
    false,
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
