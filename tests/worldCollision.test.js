import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, SPAWN } from '../shared/game.js';
import { SEATS, INCENSE_STATIONS, incenseQueuePosition } from '../shared/templeLayout.js';
import { isWalkable, moveWithCollisions, findWalkPath } from '../shared/worldCollision.js';

test('swept movement blocks walls, altar, furniture and foundations without tunneling', () => {
  const west = moveWithCollisions({ x: -15, z: -11 }, { x: -60, z: -11 });
  assert.ok(west.x > -17 && west.x < -16.9);
  assert.equal(west.z, -11);
  const rear = moveWithCollisions({ x: 12, z: -15 }, { x: 12, z: -60 });
  assert.ok(rear.z > -31 && rear.z < -30);
  const altar = moveWithCollisions({ x: 0, z: -22 }, { x: 0, z: -30 });
  assert.ok(altar.z > -24.6 && altar.z < -24);
  const foundation = moveWithCollisions({ x: 12, z: 2 }, { x: 12, z: -10 });
  assert.ok(foundation.z > -6.7 && foundation.z < -6.5);
  const censer = moveWithCollisions({ x: -9, z: 8 }, { x: -9, z: 0 });
  assert.ok(censer.z > 6 && censer.z < 6.1);
  const stand = moveWithCollisions({ x: -12.45, z: -10 }, { x: -12.45, z: -14 });
  assert.ok(stand.z > -11.2 && stand.z < -11.1);
  for (const point of [west, rear, altar, foundation, censer, stand]) assert.ok(isWalkable(point));
});

test('wall contact slides, while the open front and centered stairs remain traversable', () => {
  const slide = moveWithCollisions({ x: -15, z: -11 }, { x: -30, z: -15 });
  assert.ok(slide.x > -17 && slide.x < -16.9);
  assert.ok(Math.abs(slide.z + 15) < 0.0001, 'moving along the wall remains possible');
  const doorway = moveWithCollisions(SPAWN, { x: 0, z: -22 });
  assert.deepEqual(doorway, { x: 0, z: -22 });
  const stairsSide = moveWithCollisions({ x: 0, z: -3 }, { x: 12, z: -3 });
  assert.ok(stairsSide.x > 4.9 && stairsSide.x < 5);
  const exit = moveWithCollisions({ x: 0, z: -22 }, SPAWN);
  assert.deepEqual(exit, SPAWN);
});

test('auto-walk routes every cushion and incense queue slot through physical openings', () => {
  const targets = [
    ...SEATS.map((seat) => ({ start: SPAWN, target: seat })),
    ...Array.from({ length: 108 }, (_, index) => ({
      start: INCENSE_STATIONS[0].entrance,
      target: incenseQueuePosition(index),
    })),
  ];
  for (const { start, target } of targets) {
    assert.ok(isWalkable(target), `target ${target.id || JSON.stringify(target)} is clear`);
    const path = findWalkPath(start, target);
    assert.ok(path.length, 'there is a route around walls rather than through them');
    let previous = start;
    for (const point of path) {
      const reached = moveWithCollisions(previous, point);
      assert.ok(Math.hypot(reached.x - point.x, reached.z - point.z) < 0.001);
      previous = point;
    }
    assert.ok(Math.hypot(previous.x - target.x, previous.z - target.z) < 0.001);
  }
});

test('movement and path inputs are finite and constrained to the world', () => {
  assert.deepEqual(moveWithCollisions(null, { x: 1, z: 1 }), SPAWN);
  assert.equal(isWalkable({ x: NaN, z: 1 }), false);
  assert.deepEqual(findWalkPath(SPAWN, { x: NaN, z: 1 }), []);
  const far = moveWithCollisions({ x: 70, z: 60 }, { x: 10000, z: 10000 });
  assert.ok(far.x < WORLD.maxX && far.z < WORLD.maxZ && isWalkable(far));
});
