import { HALLS, NODES, WORLD } from './game.js';
import { HALL_LAYOUTS, INCENSE_STATIONS, SEATS } from './templeLayout.js';

export const PLAYER_RADIUS = 0.26;
const EPSILON = 1e-7;
const WALL_EDGE = 0.08;
const colliders = [];
const box = (id, x, z, width, depth) =>
  colliders.push(
    Object.freeze({
      id,
      kind: 'box',
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    }),
  );
const circle = (id, x, z, radius) =>
  colliders.push(Object.freeze({ id, kind: 'circle', x, z, radius }));

// These footprints match the rendered architecture. Foundations have an open
// stair entrance instead of allowing a player to climb through a vertical side.
for (const hall of Object.values(HALL_LAYOUTS)) {
  const main = hall.id === 'hall-main';
  const front = hall.z + hall.depth / 2;
  const back = hall.z - hall.depth / 2;
  const halfW = hall.width / 2 + hall.platformMargin;
  const halfD = hall.depth / 2 + hall.platformMargin;
  const edgeFront = hall.z + halfD;
  const edgeBack = hall.z - halfD;
  const stairHalf = hall.stairsWidth / 2;
  const stairLength = hall.stairsDepth * hall.stairsCount;
  for (const side of [-1, 1]) {
    box(`${hall.id}-foundation-side-${side}`, hall.x + side * halfW, hall.z, WALL_EDGE, halfD * 2);
    const frontWidth = halfW - stairHalf;
    box(
      `${hall.id}-foundation-front-${side}`,
      hall.x + side * (stairHalf + frontWidth / 2),
      edgeFront,
      frontWidth,
      WALL_EDGE,
    );
    box(
      `${hall.id}-stair-side-${side}`,
      hall.x + side * stairHalf,
      edgeFront + stairLength / 2,
      WALL_EDGE,
      stairLength,
    );
    box(
      `${hall.id}-wall-${side}`,
      hall.x + side * (hall.width / 2 - 0.1),
      hall.z,
      0.42,
      hall.depth - 0.2,
    );
    box(
      `${hall.id}-front-shutter-${side}`,
      hall.x + side * (hall.width / 2 - 1.25),
      front,
      1.95,
      0.28,
    );
  }
  box(`${hall.id}-foundation-back`, hall.x, edgeBack, halfW * 2, WALL_EDGE);
  box(`${hall.id}-rear-wall`, hall.x, back + 0.25, hall.width - 0.4, 0.64);
  const pillarXs = main ? [-15.5, -10.3, -5.15, 5.15, 10.3, 15.5] : [-10.8, -5.4, 5.4, 10.8];
  for (const dx of pillarXs)
    for (const [row, zz] of [front - 0.45, back + 0.55].entries())
      circle(`${hall.id}-pillar-${dx}-${row}`, hall.x + dx, zz, 0.76 * hall.detailScale);
  const altarZ = back + (main ? 4 : 3.15);
  box(`${hall.id}-buddha-dais`, hall.x, altarZ, main ? 10.8 : 8.2, main ? 5.1 : 4.1);
  box(`${hall.id}-offering-table`, hall.x, altarZ + (main ? 2.1 : 1.75), main ? 8.95 : 6.85, 1.43);
  circle(
    `${hall.id}-outer-incense-vessel`,
    hall.x - stairHalf - 1.25,
    front + 3.15,
    (main ? 1.4 : 1.05) * 0.53,
  );
}

for (const seat of SEATS)
  box(`${seat.id}-wooden-fish-stand`, seat.moktak.x, seat.moktak.z, 0.7, 0.55);
for (const station of INCENSE_STATIONS) circle(`${station.id}-censer`, station.x, station.z, 0.76);

// The active natural-environment walls, lanterns, bridge rails and tree trunks.
// The legacy atmosphere helper is not rendered and does not create ghost walls.
for (const side of [-1, 1]) {
  box(`courtyard-wall-${side}`, side * 21.3, 20.1, 0.98, 18.2);
  box(`bridge-rail-${side}`, side * 2.15, 50.1, 0.22, 5.95);
}
for (const [i, [x, z]] of [
  [-7.5, 5.7],
  [7.5, 5.7],
  [-6, 21.8],
  [10.4, 22.2],
].entries())
  box(`stone-lantern-${i}`, x, z, 0.95, 0.95);
for (const [i, [x, z, size]] of [
  [-23.8, 13.5, 0.93],
  [12.7, 12.4, 1.02],
  [-24.4, 26.5, 1.08],
  [17, 29.2, 0.96],
].entries())
  circle(`red-pine-trunk-${i}`, x, z, 0.38 * size);
const otherPines = [
  [-20, 22, 1],
  [22, 25, 0.95],
  [-24, -3, 1.05],
  [25, -4, 1.08],
  [-17, -37, 0.92],
  [18, -37, 1.02],
  [-60, -15, 1.08],
  [60, -14, 1.08],
  [-56, 34, 0.95],
  [55, 34, 0.96],
  [-42, 47, 1.1],
  [41, 47, 1],
  [-34, -59, 0.95],
  [35, -61, 1.05],
];
for (const [i, [x, z, size]] of otherPines.entries()) {
  if (Math.abs(x) < 6 || (Math.abs(x) < 19 && z > -13 && z < 35)) continue;
  if (NODES.some((node) => Math.hypot(node.x - x, node.z - z) < 5.5)) continue;
  if (HALLS.some((hall) => Math.abs(hall.x - x) < 15 && Math.abs(hall.z - 5 - z) < 10)) continue;
  circle(`pine-trunk-${i}`, x, z, 0.4 * size);
}
export const WORLD_COLLIDERS = Object.freeze(colliders);

// A small shared spatial index keeps each movement/route edge query local.
// Most garden cells have no solid structures and need no narrow-phase work.
const CELL_SIZE = 8;
const colliderCells = new Map();
for (const obstacle of WORLD_COLLIDERS) {
  const minX = obstacle.kind === 'circle' ? obstacle.x - obstacle.radius : obstacle.minX;
  const maxX = obstacle.kind === 'circle' ? obstacle.x + obstacle.radius : obstacle.maxX;
  const minZ = obstacle.kind === 'circle' ? obstacle.z - obstacle.radius : obstacle.minZ;
  const maxZ = obstacle.kind === 'circle' ? obstacle.z + obstacle.radius : obstacle.maxZ;
  for (let z = Math.floor(minZ / CELL_SIZE); z <= Math.floor(maxZ / CELL_SIZE); z++)
    for (let x = Math.floor(minX / CELL_SIZE); x <= Math.floor(maxX / CELL_SIZE); x++) {
      const key = `${x}:${z}`;
      if (!colliderCells.has(key)) colliderCells.set(key, []);
      colliderCells.get(key).push(obstacle);
    }
}
function candidates(minX, maxX, minZ, maxZ) {
  const found = new Set();
  for (let z = Math.floor(minZ / CELL_SIZE); z <= Math.floor(maxZ / CELL_SIZE); z++)
    for (let x = Math.floor(minX / CELL_SIZE); x <= Math.floor(maxX / CELL_SIZE); x++)
      for (const obstacle of colliderCells.get(`${x}:${z}`) || []) found.add(obstacle);
  return found;
}

const valid = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.z);
const radiusValue = (radius) =>
  Number.isFinite(radius) ? Math.max(0, Math.min(2, radius)) : PLAYER_RADIUS;
const clampPoint = (point, radius) => ({
  x: Math.max(WORLD.minX + radius, Math.min(WORLD.maxX - radius, point.x)),
  z: Math.max(WORLD.minZ + radius, Math.min(WORLD.maxZ - radius, point.z)),
});

export function isWalkable(point, radius = PLAYER_RADIUS) {
  if (!valid(point)) return false;
  const r = radiusValue(radius);
  if (
    point.x < WORLD.minX + r ||
    point.x > WORLD.maxX - r ||
    point.z < WORLD.minZ + r ||
    point.z > WORLD.maxZ - r
  )
    return false;
  for (const obstacle of candidates(point.x - r, point.x + r, point.z - r, point.z + r)) {
    if (obstacle.kind === 'circle') {
      if (
        (point.x - obstacle.x) ** 2 + (point.z - obstacle.z) ** 2 <
        (obstacle.radius + r) ** 2 - EPSILON
      )
        return false;
    } else if (
      point.x > obstacle.minX - r + EPSILON &&
      point.x < obstacle.maxX + r - EPSILON &&
      point.z > obstacle.minZ - r + EPSILON &&
      point.z < obstacle.maxZ + r - EPSILON
    )
      return false;
  }
  return true;
}

function firstHit(from, dx, dz, radius) {
  let earliest = null;
  for (const obstacle of candidates(
    Math.min(from.x, from.x + dx) - radius,
    Math.max(from.x, from.x + dx) + radius,
    Math.min(from.z, from.z + dz) - radius,
    Math.max(from.z, from.z + dz) + radius,
  )) {
    let time, nx, nz;
    if (obstacle.kind === 'circle') {
      const ox = from.x - obstacle.x,
        oz = from.z - obstacle.z;
      const size = obstacle.radius + radius;
      const a = dx * dx + dz * dz;
      const b = 2 * (ox * dx + oz * dz);
      const c = ox * ox + oz * oz - size * size;
      const discriminant = b * b - 4 * a * c;
      if (a < EPSILON || discriminant < 0) continue;
      time = (-b - Math.sqrt(discriminant)) / (2 * a);
      if (time < -EPSILON || time > 1 + EPSILON) continue;
      const hx = ox + dx * time,
        hz = oz + dz * time;
      const length = Math.hypot(hx, hz) || 1;
      nx = hx / length;
      nz = hz / length;
    } else {
      let entry = -Infinity,
        exit = Infinity;
      nx = nz = 0;
      let missed = false;
      for (const [value, direction, minimum, maximum, axis] of [
        [from.x, dx, obstacle.minX - radius, obstacle.maxX + radius, 'x'],
        [from.z, dz, obstacle.minZ - radius, obstacle.maxZ + radius, 'z'],
      ]) {
        if (Math.abs(direction) < EPSILON) {
          if (value < minimum + EPSILON || value > maximum - EPSILON) {
            missed = true;
            break;
          }
          continue;
        }
        const a = (minimum - value) / direction,
          b = (maximum - value) / direction;
        const near = Math.min(a, b),
          far = Math.max(a, b);
        if (near > entry) {
          entry = near;
          nx = axis === 'x' ? -Math.sign(direction) : 0;
          nz = axis === 'z' ? -Math.sign(direction) : 0;
        }
        exit = Math.min(exit, far);
        if (entry > exit) {
          missed = true;
          break;
        }
      }
      if (missed || entry < -EPSILON || entry > 1 + EPSILON || exit < 0) continue;
      time = entry;
    }
    if (dx * nx + dz * nz >= -EPSILON) continue;
    if (!earliest || time < earliest.time) earliest = { time: Math.max(0, time), nx, nz };
  }
  return earliest;
}

/** Swept motion with sliding; a long packet cannot tunnel through a thin wall. */
export function moveWithCollisions(from, target, radius = PLAYER_RADIUS) {
  if (!valid(from)) return { x: 0, z: 20 };
  const r = radiusValue(radius);
  let position = clampPoint(from, r);
  if (!valid(target)) return position;
  const end = clampPoint(target, r);
  let dx = end.x - position.x,
    dz = end.z - position.z;
  for (let pass = 0; pass < 4 && Math.hypot(dx, dz) > EPSILON; pass++) {
    const hit = firstHit(position, dx, dz, r);
    if (!hit) {
      position.x += dx;
      position.z += dz;
      break;
    }
    const safe = Math.max(0, hit.time - 0.00001 / Math.max(0.001, Math.hypot(dx, dz)));
    position.x += dx * safe;
    position.z += dz * safe;
    const left = 1 - hit.time;
    dx *= left;
    dz *= left;
    const towardWall = Math.min(0, dx * hit.nx + dz * hit.nz);
    dx -= hit.nx * towardWall;
    dz -= hit.nz * towardWall;
  }
  return clampPoint(position, r);
}

function clearSegment(a, b, radius = PLAYER_RADIUS, endpointsKnown = false) {
  return (
    (endpointsKnown || (isWalkable(a, radius) && isWalkable(b, radius))) &&
    !firstHit(a, b.x - a.x, b.z - a.z, radius)
  );
}

function closestWalkable(point, radius) {
  const target = clampPoint(point, radius);
  if (isWalkable(target, radius)) return target;
  for (let ring = 1; ring <= 24; ring++) {
    const distance = ring * 0.2;
    for (let step = 0; step < 32; step++) {
      const angle = (step / 32) * Math.PI * 2;
      const candidate = clampPoint(
        { x: target.x + Math.cos(angle) * distance, z: target.z + Math.sin(angle) * distance },
        radius,
      );
      if (isWalkable(candidate, radius)) return candidate;
    }
  }
  return null;
}

const GRID_MIN_X = Math.ceil(WORLD.minX + PLAYER_RADIUS);
const GRID_MIN_Z = Math.ceil(WORLD.minZ + PLAYER_RADIUS);
const GRID_WIDTH = Math.floor(WORLD.maxX - PLAYER_RADIUS) - GRID_MIN_X + 1;
const GRID_HEIGHT = Math.floor(WORLD.maxZ - PLAYER_RADIUS) - GRID_MIN_Z + 1;
const GRID_COUNT = GRID_WIDTH * GRID_HEIGHT;
const PATH_RADIUS = PLAYER_RADIUS + 0.035;
const gridWalkability = new Int8Array(GRID_COUNT);
const gridPoint = (index) => ({
  x: GRID_MIN_X + (index % GRID_WIDTH),
  z: GRID_MIN_Z + Math.floor(index / GRID_WIDTH),
});
const gridIndex = (x, z) => {
  const col = x - GRID_MIN_X,
    row = z - GRID_MIN_Z;
  return col >= 0 && col < GRID_WIDTH && row >= 0 && row < GRID_HEIGHT
    ? row * GRID_WIDTH + col
    : -1;
};
function gridFree(index) {
  if (index < 0) return false;
  if (!gridWalkability[index])
    gridWalkability[index] = isWalkable(gridPoint(index), PATH_RADIUS) ? 1 : -1;
  return gridWalkability[index] === 1;
}
function nearestGrid(point) {
  let best = -1,
    distance = Infinity;
  const cx = Math.round(point.x),
    cz = Math.round(point.z);
  for (let dz = -3; dz <= 3; dz++)
    for (let dx = -3; dx <= 3; dx++) {
      const index = gridIndex(cx + dx, cz + dz);
      if (!gridFree(index)) continue;
      const position = gridPoint(index),
        candidateDistance = Math.hypot(position.x - point.x, position.z - point.z);
      if (candidateDistance < distance && clearSegment(point, position)) {
        best = index;
        distance = candidateDistance;
      }
    }
  return best;
}

/** A* with swept edges and line-of-sight smoothing; [] means unreachable. */
export function findWalkPath(from, target) {
  if (!valid(from) || !valid(target)) return [];
  const start = closestWalkable(from, PLAYER_RADIUS);
  const goal = closestWalkable(target, PLAYER_RADIUS);
  if (!start || !goal) return [];
  if (clearSegment(start, goal, PATH_RADIUS)) return [goal];
  const first = nearestGrid(start),
    last = nearestGrid(goal);
  if (first < 0 || last < 0) return [];
  const cost = new Float64Array(GRID_COUNT);
  cost.fill(Infinity);
  const parent = new Int32Array(GRID_COUNT);
  parent.fill(-1);
  const closed = new Uint8Array(GRID_COUNT);
  const heap = [];
  const heuristic = (point) => Math.hypot(point.x - goal.x, point.z - goal.z);
  function push(index, score) {
    const entry = { index, score };
    let at = heap.length;
    heap.push(entry);
    while (at > 0) {
      const previous = (at - 1) >> 1;
      if (heap[previous].score <= score) break;
      heap[at] = heap[previous];
      at = previous;
    }
    heap[at] = entry;
  }
  function pop() {
    const top = heap[0],
      end = heap.pop();
    if (heap.length) {
      let at = 0;
      while (true) {
        let next = at * 2 + 1;
        if (next >= heap.length) break;
        if (next + 1 < heap.length && heap[next + 1].score < heap[next].score) next++;
        if (heap[next].score >= end.score) break;
        heap[at] = heap[next];
        at = next;
      }
      heap[at] = end;
    }
    return top.index;
  }
  cost[first] = 0;
  push(first, heuristic(gridPoint(first)));
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  while (heap.length) {
    const current = pop();
    if (closed[current]) continue;
    if (current === last) {
      const raw = [goal];
      let cursor = last;
      while (cursor !== -1) {
        raw.push(gridPoint(cursor));
        cursor = parent[cursor];
      }
      raw.reverse();
      const smoothed = [];
      let anchor = start;
      for (let at = 0; at < raw.length;) {
        let next = raw.length - 1;
        while (next > at && !clearSegment(anchor, raw[next], PATH_RADIUS)) next--;
        if (!clearSegment(anchor, raw[next])) return [];
        if (Math.hypot(raw[next].x - anchor.x, raw[next].z - anchor.z) > 0.01)
          smoothed.push(raw[next]);
        anchor = raw[next];
        at = next + 1;
      }
      return smoothed;
    }
    closed[current] = 1;
    const position = gridPoint(current);
    for (const [dx, dz] of directions) {
      const neighbor = gridIndex(position.x + dx, position.z + dz);
      if (!gridFree(neighbor) || closed[neighbor]) continue;
      if (
        dx &&
        dz &&
        (!gridFree(gridIndex(position.x + dx, position.z)) ||
          !gridFree(gridIndex(position.x, position.z + dz)))
      )
        continue;
      const next = gridPoint(neighbor);
      if (!clearSegment(position, next, PATH_RADIUS, true)) continue;
      const alternative = cost[current] + (dx && dz ? Math.SQRT2 : 1);
      if (alternative >= cost[neighbor]) continue;
      cost[neighbor] = alternative;
      parent[neighbor] = current;
      push(neighbor, alternative + heuristic(next));
    }
  }
  return [];
}
