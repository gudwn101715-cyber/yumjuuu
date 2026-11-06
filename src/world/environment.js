import { HALLS, NODES } from '../../shared/game.js';
import { INCENSE_STATIONS } from '../../shared/templeLayout.js';

/** A continuous, walkable mountain-temple landscape, designed for human eye height. */
export function buildNaturalEnvironment({ THREE, root, materials = {}, world }) {
  let randomState = 729431;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const ownedMaterials = [],
    ownedTextures = [];
  const effects = new THREE.Group();
  effects.name = 'courtyard-incense-effects';
  const queueClearance = (x, z) => x > -20 && x < -7 && z > 4 && z < 28;
  const material = (name, color, options = {}) => {
    if (materials[name]) return materials[name];
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.94, ...options });
    ownedMaterials.push(m);
    return m;
  };
  const M = {
    ground: material('grass', '#667058'),
    dirt: material('dirt', '#a39479'),
    moss: material('grassDark', '#46553a'),
    stone: material('stone', '#83847b'),
    stoneLight: material('stoneLight', '#a1a093'),
    stoneDark: material('stoneDark', '#60695e'),
    path: material('path', '#99998c'),
    trunk: material('trunk', '#655243'),
    timber: material('woodDark', '#5b4b3d'),
    wood: material('woodLight', '#8b765b'),
    bamboo: material('bamboo', '#5f7149'),
    bambooDark: material('bambooDark', '#394c32'),
    foliage: material('pine', '#334f39'),
    water: material('water', '#4e7368', { roughness: 0.28 }),
  };
  const mesh = (geometry, mat, x = 0, y = 0, z = 0, casts = true) => {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = casts;
    object.receiveShadow = true;
    root.add(object);
    return object;
  };
  const box = (w, h, d, mat, x, y, z, angle = 0) => {
    const object = mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    object.rotation.y = angle;
    return object;
  };
  const branch = (points, radius, mat = M.trunk, radial = 7) =>
    mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
        8,
        radius,
        radial,
        false,
      ),
      mat,
    );
  const cylinder = (r1, r2, h, mat, x, y, z, radial = 10) =>
    mesh(new THREE.CylinderGeometry(r1, r2, h, radial), mat, x, y, z);
  const noise = (x, z) =>
    Math.sin(x * 0.034 + z * 0.019) * 0.56 +
    Math.sin(x * 0.077 - z * 0.046) * 0.27 +
    Math.cos(x * 0.131 + z * 0.089) * 0.17;

  // The complete playable rectangle stays level; ridges start outside its boundary.
  const terrain = new THREE.PlaneGeometry(1000, 1000, 110, 110);
  terrain.rotateX(-Math.PI / 2);
  const positions = terrain.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i);
    const beyond = Math.max(0, Math.abs(x) - 87, Math.abs(z + 6) - 88);
    const rise = Math.min(1, beyond / 85);
    const height =
      beyond > 0 ? (16 + noise(x, z) * 15 + Math.sin(x * 0.014 - z * 0.02) * 9) * rise : 0;
    positions.setY(i, height - 0.045);
  }
  const uv = terrain.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i) / 10, positions.getZ(i) / 10);
  terrain.computeVertexNormals();
  mesh(terrain, M.ground, 0, 0, 0, false);

  // Rounded, eroded mountain cross-sections rather than a single straight cone slope.
  function mountainRing(radius, peak, color, segments, phase) {
    const vertex = [],
      indices = [],
      uvs = [];
    const profile = [
      [-53, 0],
      [-35, 0.13],
      [-18, 0.48],
      [0, 1],
      [19, 0.79],
      [41, 0.39],
      [77, 0],
    ];
    const rows = profile.length;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const variation =
        0.64 +
        Math.sin(a * 5 + phase) * 0.17 +
        Math.sin(a * 11 + phase * 2) * 0.11 +
        Math.sin(a * 19 + 1.1) * 0.06;
      const r = radius + Math.sin(a * 7 + phase) * 11;
      for (let j = 0; j < rows; j++) {
        const [offset, height] = profile[j];
        const rr = r + offset + Math.sin(a * 17 + j * 1.9 + phase) * 3.2;
        const erosion =
          (Math.sin(a * 23 + j * 1.6 + phase) * 1.8 + Math.cos(a * 41 - j * 0.8) * 0.8) *
          Math.sin((j / (rows - 1)) * Math.PI);
        const y = Math.max(-0.2, peak * variation * height + erosion);
        vertex.push(Math.sin(a) * rr, y, Math.cos(a) * rr - 7);
        uvs.push(((i / segments) * radius) / 9, j * 0.7 + Math.sin(a * 7) * 0.1);
      }
      if (i < segments)
        for (let j = 0; j < rows - 1; j++) {
          const v = i * rows + j;
          indices.push(v, v + rows, v + 1, v + 1, v + rows, v + rows + 1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertex, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    let map = null;
    if (M.ground.map) {
      map = M.ground.map.clone();
      map.repeat.set(1, 1);
      map.needsUpdate = true;
      ownedTextures.push(map);
    }
    const mat = new THREE.MeshStandardMaterial({
      color,
      map,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    ownedMaterials.push(mat);
    mesh(geometry, mat, 0, 0, 0, false);
  }
  mountainRing(132, 30, '#71945f', 144, 3.2);
  mountainRing(164, 47, '#81a17b', 152, 5.3);
  mountainRing(205, 65, '#8daea2', 160, 1.2);
  mountainRing(280, 87, '#a2c1bf', 168, 4.1);

  // The courtyard is a worn oval of packed mineral earth, not a featureless lawn.
  const courtyardPoints = [
    [-21, -11],
    [-16, -16],
    [15, -16],
    [22, -8],
    [23, 17],
    [19, 33],
    [9, 38],
    [-12, 36],
    [-22, 25],
    [-23, 6],
  ];
  const courtyardShape = new THREE.Shape();
  courtyardShape.moveTo(...courtyardPoints[0]);
  courtyardPoints.slice(1).forEach((p) => courtyardShape.lineTo(...p));
  courtyardShape.closePath();
  const courtyard = new THREE.ShapeGeometry(courtyardShape);
  courtyard.rotateX(Math.PI / 2);
  // Shape coordinates map to x/z; rotation flips y-coordinate into +z.
  const cp = courtyard.attributes.position,
    cuv = courtyard.attributes.uv;
  for (let i = 0; i < cp.count; i++) cuv.setXY(i, cp.getX(i) / 5, cp.getZ(i) / 5);
  courtyard.computeVertexNormals();
  const courtMesh = mesh(courtyard, M.dirt, 0, -0.014, 0, false);
  courtMesh.material.side = THREE.DoubleSide;

  let ribbonLayer = 0;
  function ribbon(points, width, mat = M.dirt, elevation = null) {
    // Crossing ribbons had different UVs at exactly the same depth. Separate
    // their surfaces so the courtyard never flashes between competing texels.
    const layer = ribbonLayer++;
    const y = elevation ?? 0.002 + layer * 0.006;
    const pathMaterial = mat.clone();
    pathMaterial.side = THREE.DoubleSide;
    pathMaterial.polygonOffset = true;
    pathMaterial.polygonOffsetFactor = -0.4;
    pathMaterial.polygonOffsetUnits = -1;
    ownedMaterials.push(pathMaterial);
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, y, z)));
    const vertices = [],
      uvs = [],
      indices = [];
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const p = curve.getPoint(i / steps),
        t = curve.getTangent(i / steps);
      const half = (width * (0.93 + Math.sin(i * 0.37) * 0.07)) / 2;
      vertices.push(p.x - t.z * half, y, p.z + t.x * half, p.x + t.z * half, y, p.z - t.x * half);
      uvs.push(
        0,
        ((i / steps) * curve.getLength()) / 4,
        width / 4,
        ((i / steps) * curve.getLength()) / 4,
      );
      if (i < steps) {
        const k = i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    mesh(g, pathMaterial, 0, 0, 0, false);
  }
  ribbon(
    [
      [0, 64],
      [0.8, 48],
      [0, 31],
      [-0.35, 12],
      [0, -7],
    ],
    4.8,
    M.dirt,
  );
  ribbon(
    [
      [0, -8],
      [-18, -12],
      [-34, -18],
      [-43, -23],
    ],
    3.3,
  );
  ribbon(
    [
      [0, -8],
      [18, -13],
      [36, -18],
      [43, -23],
    ],
    3.3,
  );
  ribbon(
    [
      [-43, -28],
      [-25, -45],
      [0, -52],
      [0, -55],
    ],
    2.8,
  );
  ribbon(
    [
      [43, -28],
      [27, -43],
      [0, -52],
    ],
    2.8,
  );
  ribbon(
    [
      [-66, 21],
      [-44, 19],
      [-28, 12],
      [-15, 9],
      [0, 12],
      [19, 11],
      [35, 12],
      [63, 19],
    ],
    2.6,
  );

  // Flagstones use individually imperfect edges, with restrained exposed joints.
  const flagstone = (x, z, w, d, turn = 0, mat = M.path) => {
    const shape = new THREE.Shape();
    const pts = [
      [-0.48, -0.46],
      [0.38, -0.5],
      [0.49, -0.36],
      [0.47, 0.43],
      [0.3, 0.5],
      [-0.43, 0.47],
      [-0.51, 0.28],
      [-0.5, -0.31],
    ];
    pts.forEach(([a, b], i) => (i ? shape.lineTo(a * w, b * d) : shape.moveTo(a * w, b * d)));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.035,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 0.035,
      bevelThickness: 0.018,
    });
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position,
      u = g.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setXY(i, (p.getX(i) + x) / 2, (p.getZ(i) + z) / 2);
    const slab = mesh(g, mat, x, 0.014, z);
    slab.rotation.y = turn;
    return slab;
  };
  for (let i = 0; i < 30; i++) {
    const z = 35 - i * 1.4;
    for (const side of [-1, 1])
      flagstone(
        side * 0.92 + (random() - 0.5) * 0.12,
        z,
        1.72,
        1.22,
        (random() - 0.5) * 0.035,
        i % 7 === 0 ? M.stoneLight : M.path,
      );
  }

  // A shaded pond with natural granite banks; stepping stones reach both lotus nodes.
  const waterMeshes = [];
  for (const side of [-1, 1]) {
    const x = side * 25,
      z = 44;
    const pond = mesh(new THREE.CircleGeometry(1, 56), M.water, x, 0.017, z, false);
    pond.rotation.x = -Math.PI / 2;
    pond.scale.set(8.5, 5.9, 1);
    waterMeshes.push(pond);
    for (let i = 0; i < 23; i++) {
      const a = (i / 23) * Math.PI * 2;
      rock(x + Math.cos(a) * 8.8, z + Math.sin(a) * 6.15, 0.45 + random() * 0.35, true);
    }
    for (let i = 0; i < 4; i++)
      flagstone(side * 24, 35.7 + i * 0.85, 1.2, 0.68, (random() - 0.5) * 0.2, M.stoneLight);
    for (let i = 0; i < 7; i++) {
      const lx = x + (random() - 0.5) * 11,
        lz = z + (random() - 0.5) * 7;
      const pad = mesh(
        new THREE.CircleGeometry(0.28 + random() * 0.2, 10),
        M.moss,
        lx,
        0.037,
        lz,
        false,
      );
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = random() * 6.28;
    }
    for (let i = 0; i < 13; i++) {
      const a = (i / 13) * Math.PI * 2;
      if (Math.sin(a) < -0.4) continue;
      grassClump(x + Math.cos(a) * 9.1, z + Math.sin(a) * 6.4, 0.45 + random() * 0.3);
    }
  }
  // A shallow stream follows the garden edge. Its low bridge remains walkable at y0.
  ribbon(
    [
      [-90, 49],
      [-58, 52],
      [-30, 49],
      [0, 50],
      [30, 51],
      [57, 48],
      [90, 53],
    ],
    2.7,
    M.water,
    0.029,
  );
  for (let i = 0; i < 15; i++) {
    box(4.5, 0.09, 0.38, M.wood, 0, 0.03, 47.5 + i * 0.38, (random() - 0.5) * 0.012);
  }
  for (const side of [-1, 1]) {
    box(0.18, 0.32, 5.9, M.timber, side * 2.15, 0.11, 50.1);
    for (const z of [47.5, 50, 52.6]) cylinder(0.075, 0.09, 0.9, M.timber, side * 2.1, 0.45, z, 8);
    branch(
      [
        [side * 2.1, 0.9, 47.5],
        [side * 2.1, 1.04, 50],
        [side * 2.1, 0.9, 52.6],
      ],
      0.055,
      M.timber,
      6,
    );
  }

  function rock(x, z, s = 1, mossy = false) {
    const g = new THREE.SphereGeometry(1, 11, 8);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i),
        py = p.getY(i),
        pz = p.getZ(i);
      const distort =
        1 + Math.sin(px * 9.1 + pz * 7.6) * 0.11 + Math.sin(py * 8.6 - pz * 4.1) * 0.09;
      p.setXYZ(i, px * distort * 1.25, py * distort * 0.67, pz * distort * 0.86);
    }
    g.computeVertexNormals();
    const stone = mesh(g, M.stone, x, s * 0.28, z);
    stone.scale.setScalar(s);
    stone.rotation.y = random() * Math.PI;
    if (mossy) {
      const cap = mesh(
        new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, 0.67),
        M.moss,
        x,
        s * 0.3,
        z,
      );
      cap.scale.set(s * 1.18, s * 0.63, s * 0.8);
      cap.rotation.y = stone.rotation.y;
    }
  }

  function grassClump(x, z, s = 1) {
    const vertices = [],
      uvs = [];
    for (let j = 0; j < 9; j++) {
      const a = random() * Math.PI * 2,
        r = random() * 0.32 * s,
        h = (0.16 + random() * 0.5) * s;
      const bx = x + Math.cos(a) * r,
        bz = z + Math.sin(a) * r;
      const width = 0.018 * s;
      vertices.push(
        bx - width,
        0,
        bz,
        bx + width,
        0,
        bz,
        bx + Math.sin(a) * h * 0.4,
        h,
        bz + Math.cos(a) * h * 0.4,
      );
      uvs.push(0, 0, 1, 0, 0.5, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    const m = mesh(g, M.moss);
    m.material.side = THREE.DoubleSide;
  }

  function fern(x, z, s = 1) {
    const v = [],
      uv = [];
    for (let frond = 0; frond < 7; frond++) {
      const a = (frond / 7) * Math.PI * 2;
      for (let j = 1; j < 5; j++) {
        const t = j / 5,
          px = x + Math.cos(a) * t * 0.9 * s,
          pz = z + Math.sin(a) * t * 0.9 * s,
          py = Math.sin(t * Math.PI) * 0.43 * s;
        for (const side of [-1, 1]) {
          const angle = a + side * 0.95,
            length = (1 - t * 0.7) * 0.26 * s;
          v.push(
            px,
            py,
            pz,
            px + Math.cos(angle) * length,
            py + 0.04 * s,
            pz + Math.sin(angle) * length,
            px + Math.cos(a) * 0.17 * s,
            py + 0.055 * s,
            pz + Math.sin(a) * 0.17 * s,
          );
          uv.push(0, 0, 0.5, 1, 1, 0);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const f = mesh(g, M.moss);
    f.material.side = THREE.DoubleSide;
  }
  function stoneLantern(x, z) {
    box(0.95, 0.16, 0.95, M.stoneDark, x, 0.08, z);
    cylinder(0.43, 0.52, 0.18, M.stoneLight, x, 0.24, z, 8);
    cylinder(0.17, 0.24, 0.7, M.stone, x, 0.66, z, 8);
    cylinder(0.42, 0.3, 0.18, M.stoneLight, x, 1.1, z, 8);
    box(0.64, 0.12, 0.64, M.stone, x, 1.23, z);
    for (const dx of [-0.23, 0.23])
      for (const dz of [-0.23, 0.23]) box(0.075, 0.44, 0.075, M.stoneLight, x + dx, 1.5, z + dz);
    cylinder(0.12, 0.15, 0.32, M.stoneDark, x, 1.45, z, 8);
    const roof = mesh(new THREE.ConeGeometry(0.59, 0.28, 4), M.stoneLight, x, 1.86, z);
    roof.rotation.y = Math.PI / 4;
    cylinder(0.12, 0.2, 0.13, M.stone, x, 2.05, z, 8);
    cylinder(0.055, 0.11, 0.2, M.stoneLight, x, 2.2, z, 8);
    rock(x + 0.55, z + 0.25, 0.36, true);
    fern(x - 0.55, z + 0.15, 0.48);
  }
  stoneLantern(-7.5, 5.7);
  stoneLantern(7.5, 5.7);
  stoneLantern(-6, 21.8);
  stoneLantern(10.4, 22.2);
  for (const side of [-1, 1])
    for (let i = 0; i < 12; i++) {
      const x = side * (12.5 + random() * 5.3),
        z = -1 + i * 2.7;
      if (queueClearance(x, z)) continue;
      if (i % 3 === 0) rock(x, z, 0.45 + random() * 0.3, true);
      fern(x + side * 0.6, z, 0.5 + random() * 0.45);
      grassClump(x - side * 0.7, z + 0.4, 0.7 + random() * 0.5);
    }

  // A hand-painted alpha needle spray gives real silhouettes without heavy leaf meshes.
  function needleMap() {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.lineCap = 'round';
    for (let b = 0; b < 13; b++) {
      const by = 225 - b * 13,
        span = (1 - b / 15) * 96;
      for (const side of [-1, 1]) {
        const tipX = 128 + side * span,
          tipY = by - 31;
        ctx.strokeStyle = '#514a35';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(128, by + 10);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();
        for (let n = 0; n < 31; n++) {
          const t = n / 31,
            px = 128 + (tipX - 128) * t,
            py = by + 10 + (tipY - by - 10) * t;
          const length = 12 + random() * 19;
          ctx.strokeStyle = ['#3b653c', '#4d7746', '#62874f', '#7f9b5a'][Math.floor(random() * 4)];
          ctx.lineWidth = 1.25 + random() * 0.7;
          for (const sign of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + side * length * 0.65, py + sign * length * 0.53 - 7);
            ctx.stroke();
          }
        }
      }
    }
    ctx.strokeStyle = '#5b5039';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(128, 249);
    ctx.lineTo(128, 40);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    ownedTextures.push(texture);
    return texture;
  }
  const needles = needleMap();
  const needleMaterial = needles
    ? new THREE.MeshStandardMaterial({
        map: needles,
        alphaTest: 0.38,
        side: THREE.DoubleSide,
        roughness: 1,
        color: '#b7c2a6',
      })
    : M.foliage;
  if (needles) ownedMaterials.push(needleMaterial);
  const sprayGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  function pine(x, z, s = 1, detail = true) {
    const h = (8.5 + random() * 3.6) * s,
      leanX = (random() - 0.5) * 0.8 * s,
      leanZ = (random() - 0.5) * 0.7 * s;
    branch(
      [
        [x, 0, z],
        [x + 0.12 * s, h * 0.35, z - 0.1 * s],
        [x + leanX, h * 0.72, z + leanZ],
        [x + leanX * 0.7, h, z + leanZ * 0.7],
      ],
      0.13 * s,
      M.trunk,
      8,
    );
    const tiers = detail ? 6 : 4;
    for (let tier = 0; tier < tiers; tier++) {
      const t = tier / (tiers - 1),
        y = h * (0.42 + t * 0.51),
        radius = (2.65 - t * 1.65) * s;
      const offsetX = leanX * (0.4 + t * 0.5),
        offsetZ = leanZ * (0.4 + t * 0.5);
      for (let arm = 0; arm < 3; arm++) {
        const angle = (arm / 3) * Math.PI * 2 + tier * 0.7 + x * 0.031;
        const bx = x + offsetX + Math.cos(angle) * radius * 0.56,
          bz = z + offsetZ + Math.sin(angle) * radius * 0.56;
        if (detail && tier < 4)
          branch(
            [
              [x + offsetX, y - 0.3 * s, z + offsetZ],
              [bx, y - 0.1 * s, bz],
              [
                x + offsetX + Math.cos(angle) * radius,
                y + 0.12 * s,
                z + offsetZ + Math.sin(angle) * radius,
              ],
            ],
            0.045 * s,
            M.trunk,
            5,
          );
        for (let cross = 0; cross < 2; cross++) {
          const spray = mesh(sprayGeometry.clone(), needleMaterial, bx, y, bz);
          spray.scale.set(radius * 1.7, radius * 1.27, 1);
          spray.rotation.set(
            -0.3 + random() * 0.3,
            angle + (cross * Math.PI) / 2,
            Math.sin(tier + arm) * 0.17,
          );
        }
      }
    }
    for (let i = 0; i < (detail ? 3 : 1); i++)
      grassClump(x + (random() - 0.5) * 2, z + (random() - 0.5) * 2, 0.55 + random() * 0.4);
  }
  let treeShadowMaterial = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(17,25,15,.25)');
    gradient.addColorStop(0.34, 'rgba(17,25,15,.16)');
    gradient.addColorStop(1, 'rgba(17,25,15,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.push(texture);
    treeShadowMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    ownedMaterials.push(treeShadowMaterial);
  }
  function treeContact(x, z, s) {
    if (!treeShadowMaterial) return;
    const shadow = mesh(
      new THREE.PlaneGeometry(s * 4.1, s * 3.3),
      treeShadowMaterial,
      x,
      0.006,
      z,
      false,
    );
    shadow.rotation.x = -Math.PI / 2;
  }
  function redPine(x, z, s = 1, lean = 1) {
    const h = 8.4 * s;
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x + 0.36 * lean * s, 2.1 * s, z - 0.12 * s),
      new THREE.Vector3(x - 0.18 * lean * s, 4.1 * s, z - 0.3 * s),
      new THREE.Vector3(x + 0.86 * lean * s, 6.5 * s, z - 0.25 * s),
      new THREE.Vector3(x + 1.25 * lean * s, h, z - 0.45 * s),
    ]);
    const g = new THREE.TubeGeometry(trunkCurve, 16, 0.23 * s, 9, false),
      p = g.attributes.position;
    for (let ring = 0; ring <= 16; ring++) {
      const center = trunkCurve.getPointAt(ring / 16),
        scale = 1 - (ring / 16) * 0.72;
      for (let j = 0; j <= 9; j++) {
        const index = ring * 10 + j;
        p.setXYZ(
          index,
          center.x + (p.getX(index) - center.x) * scale,
          center.y + (p.getY(index) - center.y) * scale,
          center.z + (p.getZ(index) - center.z) * scale,
        );
      }
    }
    g.computeVertexNormals();
    mesh(g, M.trunk);
    const arms = [
      [-2.65, 4.8, 0.35, 3.3],
      [2.8, 5.6, -0.6, 3.6],
      [-1.5, 6.65, -1.0, 3.4],
      [1.5, 7.6, 0.65, 2.9],
    ];
    for (let index = 0; index < arms.length; index++) {
      const [dx, y, dz, spread] = arms[index];
      const bx = x + dx * s * lean,
        bz = z + dz * s;
      branch(
        [
          [x + 0.14 * s, y * s - 1.6 * s, z - 0.15 * s],
          [x + dx * s * 0.55 * lean, y * s - 0.8 * s, z + dz * s * 0.6],
          [bx, y * s - 0.1 * s, bz],
        ],
        0.095 * s,
        M.trunk,
        7,
      );
      for (let patch = 0; patch < 3; patch++) {
        const angle = patch * 2.1 + index * 0.65;
        const px = bx + Math.cos(angle) * 0.8 * s,
          pz = bz + Math.sin(angle) * 0.7 * s;
        for (let cross = 0; cross < 2; cross++) {
          const spray = mesh(
            sprayGeometry.clone(),
            needleMaterial,
            px,
            y * s + patch * 0.12 * s,
            pz,
          );
          spray.scale.set(spread * s, (1.25 + patch * 0.16) * s, 1);
          spray.rotation.set(-0.48 - cross * 0.52, angle + cross * 1.57, (patch - 1) * 0.13);
        }
      }
    }
    for (const sign of [-1, 1])
      branch(
        [
          [x, 0.17, z],
          [x + sign * 0.65 * s, 0.08, z + 0.23 * s],
          [x + sign * 1.0 * s, 0.015, z + 0.5 * s],
        ],
        0.045 * s,
        M.trunk,
        6,
      );
    treeContact(x, z, s * 1.2);
  }
  // Low, spreading Korean red-pine crowns frame the human-scale approach.
  redPine(-23.8, 13.5, 0.93, -1);
  redPine(12.7, 12.4, 1.02, 1);
  redPine(-24.4, 26.5, 1.08, 1);
  redPine(17.0, 29.2, 0.96, -1);

  const treeClear = (x, z) => {
    if (queueClearance(x, z)) return false;
    if (Math.abs(x) < 6) return false;
    if (Math.abs(x) < 19 && z > -13 && z < 35) return false;
    if (NODES.some((n) => Math.hypot(n.x - x, n.z - z) < 5.5)) return false;
    if (HALLS.some((h) => Math.abs(h.x - x) < 15 && Math.abs(h.z - 5 - z) < 10)) return false;
    return true;
  };
  const foregroundTrees = [
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
    [41, 47, 1.0],
    [-34, -59, 0.95],
    [35, -61, 1.05],
  ];
  for (const [x, z, s] of foregroundTrees) if (treeClear(x, z)) pine(x, z, s, true);
  for (let i = 0; i < 62; i++) {
    const a = (i / 62) * Math.PI * 2,
      r = 74 + random() * 18,
      x = Math.cos(a) * r,
      z = Math.sin(a) * r - 6;
    if (treeClear(x, z)) pine(x, z, 0.9 + random() * 0.5, i % 3 === 0);
  }

  // Bamboo leaf shapes are thin pointed blades, rather than broad polygon blobs.
  const bambooLeafMaterial = new THREE.MeshStandardMaterial({
    color: '#536a3d',
    roughness: 1,
    side: THREE.DoubleSide,
  });
  ownedMaterials.push(bambooLeafMaterial);
  function bambooGrove(cx, cz) {
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4,
        r = 0.6 + random() * 2.2,
        x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r,
        h = 4.8 + random() * 2.6;
      if (NODES.some((n) => Math.hypot(n.x - x, n.z - z) < 4)) continue;
      cylinder(0.045, 0.065, h, M.bamboo, x, h / 2, z, 8);
      for (let ring = 1; ring < 9; ring++)
        cylinder(0.069, 0.069, 0.055, M.bambooDark, x, (h * ring) / 10, z, 8);
      for (let tier = 0; tier < 3; tier++) {
        const y = h * (0.61 + tier * 0.13),
          turn = a + tier * 2;
        branch(
          [
            [x, y, z],
            [x + Math.cos(turn) * 0.6, y + 0.1, z + Math.sin(turn) * 0.6],
            [x + Math.cos(turn), y + 0.4, z + Math.sin(turn)],
          ],
          0.016,
          M.bamboo,
          4,
        );
        for (let leaf = 0; leaf < 8; leaf++) {
          const angle = turn + (leaf % 2 ? -0.65 : 0.65),
            d = 0.2 + Math.floor(leaf / 2) * 0.19;
          const lx = x + Math.cos(turn) * d,
            lz = z + Math.sin(turn) * d;
          const g = new THREE.BufferGeometry();
          const length = 0.45 + random() * 0.3,
            width = 0.055;
          g.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(
              [
                0,
                0,
                0,
                Math.cos(angle) * length * 0.5 - width,
                0.055,
                Math.sin(angle) * length * 0.5,
                Math.cos(angle) * length,
                0,
                Math.sin(angle) * length,
                0,
                0,
                0,
                Math.cos(angle) * length,
                0,
                Math.sin(angle) * length,
                Math.cos(angle) * length * 0.5 + width,
                0.055,
                Math.sin(angle) * length * 0.5,
              ],
              3,
            ),
          );
          g.setAttribute(
            'uv',
            new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0.5, 0, 0, 1, 0.5, 1, 1], 2),
          );
          g.computeVertexNormals();
          mesh(g, bambooLeafMaterial, lx, y + 0.06 + leaf * 0.014, lz);
        }
      }
    }
  }
  bambooGrove(-32, 5);
  bambooGrove(36, 5);
  bambooGrove(-43, 8);
  bambooGrove(43, -55);

  // The outer edges receive uneven boulders and low natural grasses, leaving paths unobstructed.
  for (let i = 0; i < 76; i++) {
    const a = random() * Math.PI * 2,
      r = 25 + random() * 48,
      x = Math.cos(a) * r,
      z = Math.sin(a) * r - 5;
    if (!treeClear(x, z)) continue;
    rock(x, z, 0.35 + random() * 0.85, i % 3 !== 0);
    if (i % 2 === 0) grassClump(x + 0.8, z - 0.3, 0.8);
  }
  for (const side of [-1, 1]) {
    const x = side * 21.3;
    for (let i = 0; i < 10; i++) {
      const z = 12 + i * 1.8;
      for (let row = 0; row < 2; row++)
        box(
          0.68,
          0.37,
          1.65,
          row % 2 ? M.stoneDark : M.stone,
          x,
          0.19 + row * 0.38,
          z + (row % 2) * 0.38,
          (random() - 0.5) * 0.03,
        );
      box(0.9, 0.1, 1.8, M.stoneDark, x, 0.84, z);
    }
  }

  // These eighteen soft points stay outside the static material batches. Their
  // small, translucent wisps suggest lit incense without obscuring the courtyard.
  const smokeCount = INCENSE_STATIONS.length * 18;
  const smokeGeometry = new THREE.BufferGeometry();
  const smokePositions = new Float32Array(smokeCount * 3);
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokePixels = new Uint8Array(32 * 32 * 4);
  for (let iy = 0; iy < 32; iy++)
    for (let ix = 0; ix < 32; ix++) {
      const radius = Math.hypot((ix - 15.5) / 15.5, (iy - 15.5) / 15.5);
      const alpha = Math.max(0, 1 - radius);
      smokePixels.set([255, 255, 255, Math.round(alpha * alpha * 180)], (iy * 32 + ix) * 4);
    }
  const smokeTexture = new THREE.DataTexture(smokePixels, 32, 32, THREE.RGBAFormat);
  smokeTexture.needsUpdate = true;
  smokeTexture.magFilter = THREE.LinearFilter;
  smokeTexture.minFilter = THREE.LinearFilter;
  ownedTextures.push(smokeTexture);
  const smokeMaterial = new THREE.PointsMaterial({
    color: '#e9e5d8',
    map: smokeTexture,
    transparent: true,
    opacity: 0.14,
    size: 0.26,
    depthWrite: false,
    sizeAttenuation: true,
  });
  ownedMaterials.push(smokeMaterial);
  const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
  smoke.name = 'thin-courtyard-incense-smoke';
  smoke.frustumCulled = false;
  effects.add(smoke);
  function updateSmoke(time) {
    for (let i = 0; i < smokeCount; i++) {
      const station = INCENSE_STATIONS[Math.floor(i / 18)];
      const phase = (time * 0.15 + (i % 18) / 18) % 1;
      const offset = i * 3;
      smokePositions[offset] = station.x + Math.sin(phase * 5 + i) * phase * 0.22;
      smokePositions[offset + 1] = (station.y || 0) + 1.21 + phase * 1.12;
      smokePositions[offset + 2] = station.z + Math.cos(phase * 4 + i * 0.8) * phase * 0.1;
    }
    smokeGeometry.attributes.position.needsUpdate = true;
  }
  updateSmoke(0);

  return {
    waterMeshes,
    effects,
    update({ time = 0 } = {}) {
      updateSmoke(time);
      const normal = M.water.normalMap || M.water.bumpMap;
      if (normal) {
        normal.offset.x = time * 0.004;
        normal.offset.y = time * 0.002;
      }
    },
    dispose() {
      effects.removeFromParent();
      smokeGeometry.dispose();
      ownedMaterials.forEach((m) => m.dispose());
      ownedTextures.forEach((t) => t.dispose());
      sprayGeometry.dispose();
    },
  };
}
