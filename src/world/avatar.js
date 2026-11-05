import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared meshes keep the rounded pilgrim inexpensive for remote peers.
// Geometry is built once per shape; the six muted palettes share the same weave.
const geometryCache = new Map();
const materialCache = new Map();
let weave = null;
let liveAvatars = 0;

function wovenTextures(THREE) {
  if (weave || typeof document === 'undefined') return weave;
  const size = 128;
  const canvas = document.createElement('canvas');
  const relief = document.createElement('canvas');
  canvas.width = canvas.height = relief.width = relief.height = size;
  const context = canvas.getContext('2d');
  const reliefContext = relief.getContext('2d');
  if (!context || !reliefContext) return null;
  const pixels = context.createImageData(size, size);
  const bumps = reliefContext.createImageData(size, size);
  let seed = 29573;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const thread = (x % 4 === 0 ? -7 : 0) + (y % 3 === 0 ? -4 : 0);
      const noise = (random() - 0.5) * 13;
      const value = 244 + thread + noise;
      pixels.data.set([value, value - 1, value - 3, 255], index);
      const height = 128 + thread * 2 + noise * 0.5;
      bumps.data.set([height, height, height, 255], index);
    }
  }
  context.putImageData(pixels, 0, 0);
  reliefContext.putImageData(bumps, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const bumpMap = new THREE.CanvasTexture(relief);
  for (const texture of [map, bumpMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 3);
    texture.anisotropy = 4;
  }
  weave = { map, bumpMap };
  return weave;
}

function geometry(key, build) {
  if (!geometryCache.has(key)) geometryCache.set(key, build());
  return geometryCache.get(key);
}

function palette(THREE, isSelf, seed, gender) {
  const index = isSelf ? 0 : 1 + (Math.abs(seed) % 5);
  const cacheKey = `${gender}:${index}`;
  if (materialCache.has(cacheKey)) return materialCache.get(cacheKey);
  const tones = [
    ['#a2a59f', '#858a83', '#a58a65'],
    ['#a9aaa3', '#8b8d84', '#a68a6d'],
    ['#9fa6a2', '#7e8882', '#a28b6c'],
    ['#acaaa2', '#8d8b82', '#ad9070'],
    ['#a4aaa9', '#848d8c', '#a38c6d'],
    ['#aaa99f', '#8d8c81', '#a9916a'],
  ][index];
  const textures = wovenTextures(THREE) || {};
  const cloth = (color) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.98,
      ...textures,
      bumpScale: 0.0014,
      side: THREE.DoubleSide,
    });
  const materials = {
    shirt: cloth(tones[0]),
    trousers: cloth(tones[1]),
    drape: cloth(tones[2]),
    trim: cloth('#eee2c5'),
    sash: cloth('#92978e'),
    stitching: cloth('#b9a382'),
    shoe: cloth('#797e75'),
    skin: new THREE.MeshStandardMaterial({
      color: gender === 'female' ? '#f2cbb1' : '#f2c9a8',
      roughness: 0.85,
    }),
    features: new THREE.MeshStandardMaterial({ color: '#3f3029', roughness: 0.82 }),
    catchlight: new THREE.MeshStandardMaterial({ color: '#fff5df', roughness: 0.55 }),
    cheeks: new THREE.MeshStandardMaterial({ color: '#e6a68e', roughness: 0.95 }),
    sole: new THREE.MeshStandardMaterial({ color: '#5f6251', roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: '#76513b', roughness: 0.59 }),
  };
  materialCache.set(cacheKey, materials);
  return materials;
}

/** A closed, smoothly shaded, elliptical cloth surface with sculpted fabric folds. */
function clothTube(THREE, sections, fold = 0.0025, radial = 24, vertical = 20) {
  const vertices = [];
  const uv = [];
  const indices = [];
  const bottom = sections[0][0];
  const top = sections.at(-1)[0];
  for (let row = 0; row <= vertical; row++) {
    const v = row / vertical;
    const y = bottom + (top - bottom) * v;
    let left = sections[0];
    let right = sections.at(-1);
    for (let i = 1; i < sections.length; i++) {
      if (y <= sections[i][0]) {
        left = sections[i - 1];
        right = sections[i];
        break;
      }
    }
    const blend = Math.max(0, Math.min(1, (y - left[0]) / (right[0] - left[0])));
    const eased = blend * blend * (3 - 2 * blend);
    const rx = left[1] + (right[1] - left[1]) * eased;
    const rz = left[2] + (right[2] - left[2]) * eased;
    for (let col = 0; col <= radial; col++) {
      const u = col / radial;
      const angle = u * Math.PI * 2;
      const wrinkle =
        (Math.sin(angle * 7 + v * 4) * fold + Math.sin(v * 28 + angle * 3) * fold * 0.4) *
        Math.sin(v * Math.PI);
      vertices.push(Math.cos(angle) * (rx + wrinkle), y, Math.sin(angle) * (rz + wrinkle));
      uv.push(u, v);
      if (row < vertical && col < radial) {
        const a = row * (radial + 1) + col;
        const b = a + radial + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

// A wrapped rectangular 가사 rises over the left shoulder. Its entire
// elliptical surface stays outside the gray robe, including the lower belly.
function kasaPoint(angle, v, extra = 0) {
  const rx = 0.254 + Math.sin(v * Math.PI) * 0.004;
  const rz = 0.174 + Math.sin(v * Math.PI) * 0.004;
  const x = Math.cos(angle) * rx;
  const top = 0.3 - x * 0.48;
  const y = -0.23 + (top + 0.23) * v;
  const fold = Math.sin(angle * 11 + v * 2) * 0.0015 * Math.sin(v * Math.PI);
  return [Math.cos(angle) * (rx + extra + fold), y, Math.sin(angle) * (rz + extra + fold)];
}

function monasticKasa(THREE) {
  const radial = 48,
    rows = 24;
  const positions = [],
    uv = [],
    indices = [];
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let col = 0; col <= radial; col++) {
      const u = col / radial;
      positions.push(...kasaPoint(u * Math.PI * 2, v));
      uv.push(u, v);
      if (row < rows && col < radial) {
        const a = row * (radial + 1) + col,
          b = a + radial + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

function kasaShoulder(THREE) {
  const positions = [],
    uv = [],
    indices = [];
  const across = 8,
    around = 16;
  for (let row = 0; row <= around; row++) {
    const v = row / around;
    for (let col = 0; col <= across; col++) {
      const u = col / across,
        x = -0.213 + u * 0.106;
      const edge = 0.3 - x * 0.48;
      const z = Math.sqrt(1 - (x / 0.254) ** 2) * 0.174 * Math.cos(v * Math.PI);
      const y = edge + Math.sin(v * Math.PI) * (0.467 - edge);
      positions.push(x, y, z);
      uv.push(u, v);
      if (row < around && col < across) {
        const a = row * (across + 1) + col,
          b = a + across + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

function bake(THREE, key, pieces) {
  return geometry(key, () => {
    const transformed = pieces.map((piece) => {
      const source = piece.geometry;
      const copy = source.index ? source.toNonIndexed() : source.clone();
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...(piece.position || [0, 0, 0])),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...(piece.rotation || [0, 0, 0]))),
        new THREE.Vector3(...(piece.scale || [1, 1, 1])),
      );
      copy.applyMatrix4(matrix);
      return copy;
    });
    const result = mergeGeometries(transformed);
    transformed.forEach((item) => item.dispose());
    pieces.forEach((piece) => piece.geometry.dispose());
    return result;
  });
}

function roundedBag(THREE, width, height, depth, radius = 0.012) {
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const result = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.007,
    bevelSize: 0.006,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 4,
  });
  result.translate(0, 0, -depth / 2);
  return result;
}

/**
 * A soft, four-head-tall temple pilgrim. Local +Z is the face direction and the
 * foot sole rests at y≈0.03. Call animate once per rendered frame; the parent
 * owns world translation/yaw and should not apply the old whole-body bow.
 */
export function createPilgrimAvatar({ THREE, isSelf = false, seed = 0, gender = 'male' }) {
  if (!THREE) throw new Error('createPilgrimAvatar requires the Three.js namespace.');
  liveAvatars++;
  const bodyGender = gender === 'female' ? 'female' : 'male';
  const feminine = bodyGender === 'female';
  const M = palette(THREE, isSelf, seed, bodyGender);
  const baked = (key, pieces) => bake(THREE, `${bodyGender}:${key}`, pieces);
  const group = new THREE.Group();
  group.name = 'gentle-pilgrim';
  group.userData.gender = bodyGender;
  const hips = new THREE.Group();
  hips.position.y = 0.74;
  group.add(hips);
  const torso = new THREE.Group();
  torso.position.y = 0.04;
  hips.add(torso);

  const mesh = (key, build, material, parent = torso, position = [0, 0, 0]) => {
    const object = new THREE.Mesh(geometry(`${bodyGender}:${key}`, build), material);
    object.name = key;
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const tube = (key, sections, material, parent, position, folds = 0.0025) =>
    mesh(key, () => clothTube(THREE, sections, folds), material, parent, position);
  const line = (key, points, radius, material, parent = torso) =>
    mesh(
      key,
      () =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
          Math.max(8, points.length * 4),
          radius,
          6,
          false,
        ),
      material,
      parent,
    );

  tube(
    'pilgrim-shirt',
    [
      [-0.135, 0.215, 0.132],
      [-0.06, 0.238, 0.15],
      [0.12, 0.24, 0.152],
      [0.3, 0.23, 0.14],
      [0.395, feminine ? 0.231 : 0.246, 0.13],
      [0.44, 0.19, 0.112],
      [0.455, 0.115, 0.075],
    ],
    M.shirt,
    torso,
    [0, 0, 0],
    0.002,
  );
  mesh('pilgrim-kasa', () => monasticKasa(THREE), M.drape);
  mesh('pilgrim-kasa-shoulder', () => kasaShoulder(THREE), M.drape);
  mesh(
    'pilgrim-kasa-patchwork',
    () => {
      const pieces = [];
      const seam = (points) =>
        pieces.push({
          geometry: new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
            points.length * 2,
            0.00095,
            4,
            false,
          ),
        });
      for (const v of [0.035, 0.35, 0.68, 0.97])
        seam(Array.from({ length: 49 }, (_, i) => kasaPoint((i / 48) * Math.PI * 2, v, 0.0012)));
      for (let i = 0; i < 8; i++)
        seam(
          Array.from({ length: 17 }, (_, j) => kasaPoint((i / 8) * Math.PI * 2, j / 16, 0.0012)),
        );
      return baked('baked-kasa-patchwork', pieces);
    },
    M.stitching,
  );
  line(
    'pilgrim-collar-left',
    [
      [-0.112, 0.451, 0.07],
      [-0.08, 0.395, 0.13],
      [0.0, 0.315, 0.151],
      [0.1, 0.24, 0.153],
    ],
    0.014,
    M.trim,
  );
  line(
    'pilgrim-collar-right',
    [
      [0.112, 0.451, 0.07],
      [0.08, 0.395, 0.13],
      [0.0, 0.315, 0.151],
    ],
    0.012,
    M.trim,
  );
  tube(
    'pilgrim-waist-sash',
    [
      [0.0, 0.244, 0.159],
      [0.055, 0.244, 0.159],
    ],
    M.sash,
    torso,
    [0, 0, 0],
    0.001,
  );

  // A clean shaved head keeps the same soft, friendly face for both genders.
  const head = new THREE.Group();
  head.position.set(0, 0.53, -0.003);
  torso.add(head);
  mesh(
    'pilgrim-head-skin',
    () =>
      baked('baked-pilgrim-head', [
        {
          geometry: new THREE.SphereGeometry(1, 32, 24),
          position: [0, 0.102, 0],
          scale: [feminine ? 0.201 : 0.207, 0.207, 0.187],
        },
        {
          geometry: new THREE.CylinderGeometry(0.07, 0.08, 0.075, 20),
          position: [0, -0.077, -0.003],
        },
        {
          geometry: new THREE.SphereGeometry(0.023, 16, 12),
          position: [0, 0.075, 0.181],
          scale: [0.82, 0.66, 0.72],
        },
        ...[-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(0.037, 16, 12),
          position: [side * (feminine ? 0.195 : 0.201), 0.092, -0.004],
          scale: [0.6, 0.95, 0.65],
        })),
      ]),
    M.skin,
    head,
  );
  mesh(
    'pilgrim-friendly-eyes',
    () =>
      baked(
        'baked-pilgrim-eyes',
        [-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(0.019, 16, 12),
          position: [side * 0.072, 0.131, 0.179],
          scale: [feminine ? 0.92 : 0.88, feminine ? 1.2 : 1.15, 0.54],
          rotation: [0, side * 0.23, 0],
        })),
      ),
    M.features,
    head,
  );
  mesh(
    'pilgrim-eye-catchlights',
    () =>
      baked(
        'baked-pilgrim-eye-catchlights',
        [-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(0.005, 10, 8),
          position: [side * 0.072 - 0.004, 0.137, 0.189],
          scale: [1, 1, 0.5],
        })),
      ),
    M.catchlight,
    head,
  );
  mesh(
    'pilgrim-soft-cheeks',
    () =>
      baked(
        'baked-pilgrim-cheeks',
        [-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(1, 16, 12),
          position: [side * (feminine ? 0.116 : 0.122), 0.076, 0.15],
          scale: [0.032, 0.017, 0.01],
          rotation: [0, side * 0.42, 0],
        })),
      ),
    M.cheeks,
    head,
  );
  line(
    'pilgrim-little-smile',
    [
      [-0.031, 0.043, 0.176],
      [-0.017, 0.034, 0.182],
      [0, 0.031, 0.184],
      [0.017, 0.034, 0.182],
      [0.031, 0.043, 0.176],
    ],
    0.004,
    M.features,
    head,
  );

  const legs = [];
  for (const side of [-1, 1]) {
    const upper = new THREE.Group();
    upper.position.set(side * 0.12, -0.01, 0.003);
    hips.add(upper);
    tube(
      'pilgrim-trouser-thigh',
      [
        [-0.305, 0.079, 0.085],
        [-0.22, 0.096, 0.104],
        [-0.08, 0.107, 0.112],
        [0.035, 0.09, 0.097],
      ],
      M.trousers,
      upper,
      [0, 0, 0],
      0.0038,
    );
    const lower = new THREE.Group();
    lower.position.y = -0.29;
    upper.add(lower);
    tube(
      'pilgrim-trouser-calf',
      [
        [-0.28, 0.062, 0.065],
        [-0.235, 0.073, 0.078],
        [-0.14, 0.089, 0.092],
        [-0.04, 0.082, 0.088],
        [0.025, 0.078, 0.084],
      ],
      M.trousers,
      lower,
      [0, 0, 0],
      0.0035,
    );
    tube(
      'pilgrim-trouser-cuff',
      [
        [-0.283, 0.068, 0.072],
        [-0.245, 0.076, 0.081],
      ],
      M.shirt,
      lower,
      [0, 0, 0],
      0.001,
    );
    const foot = new THREE.Group();
    foot.position.y = -0.27;
    lower.add(foot);
    mesh(
      'pilgrim-shoe-upper',
      () =>
        baked('baked-pilgrim-shoe-upper', [
          {
            geometry: new THREE.SphereGeometry(0.1, 20, 12),
            position: [0, -0.071, 0.049],
            scale: [0.8, 0.64, 1.36],
          },
          {
            geometry: new THREE.CylinderGeometry(0.042, 0.046, 0.065, 16),
            position: [0, -0.024, -0.009],
          },
        ]),
      M.shoe,
      foot,
    );
    const sole = mesh(
      'pilgrim-shoe-sole',
      () => {
        const sole = roundedBag(THREE, 0.158, 0.276, 0.019, 0.04);
        sole.rotateX(Math.PI / 2);
        return sole;
      },
      M.sole,
      foot,
      [0, -0.131, 0.042],
    );
    foot.name = side < 0 ? 'left-foot' : 'right-foot';
    legs.push({ upper, lower, foot, sole, side });
  }

  const arms = [];
  for (const side of [-1, 1]) {
    const upper = new THREE.Group();
    upper.position.set(side * (feminine ? 0.235 : 0.247), 0.383, -0.005);
    torso.add(upper);
    tube(
      'pilgrim-upper-sleeve',
      [
        [-0.245, 0.076, 0.081],
        [-0.17, 0.081, 0.089],
        [-0.045, 0.096, 0.097],
        [0.035, 0.074, 0.08],
        [0.065, 0.012, 0.015],
      ],
      M.shirt,
      upper,
      [0, 0, 0],
    );
    const lower = new THREE.Group();
    lower.position.y = -0.23;
    upper.add(lower);
    tube(
      'pilgrim-lower-sleeve',
      [
        [-0.19, 0.05, 0.054],
        [-0.14, 0.068, 0.072],
        [-0.05, 0.074, 0.079],
        [0.025, 0.068, 0.074],
      ],
      M.shirt,
      lower,
      [0, 0, 0],
      0.002,
    );
    tube(
      'pilgrim-sleeve-cuff',
      [
        [-0.202, 0.055, 0.059],
        [-0.173, 0.064, 0.068],
      ],
      M.shirt,
      lower,
      [0, 0, 0],
      0.0008,
    );
    const hand = new THREE.Group();
    hand.position.y = -0.207;
    lower.add(hand);
    mesh(
      'pilgrim-hand',
      () =>
        baked('baked-pilgrim-hand', [
          {
            geometry: new THREE.SphereGeometry(0.05, 18, 14),
            position: [0, -0.026, 0.006],
            scale: [0.83, 1, 0.62],
          },
          {
            geometry: new THREE.SphereGeometry(0.022, 14, 10),
            position: [0.032, -0.014, 0.017],
            scale: [0.7, 1, 0.75],
            rotation: [0, 0, -0.35],
          },
        ]),
      M.skin,
      hand,
    );
    if (side === 1) {
      mesh(
        'pilgrim-bracelet',
        () =>
          baked(
            'baked-pilgrim-bracelet',
            Array.from({ length: 14 }, (_, i) => {
              const angle = (i / 14) * Math.PI * 2;
              return {
                geometry: new THREE.SphereGeometry(0.0068, 8, 6),
                position: [Math.cos(angle) * 0.053, -0.198, Math.sin(angle) * 0.057],
              };
            }),
          ),
        M.wood,
        lower,
      );
    }
    arms.push({ upper, lower, hand, side });
  }

  let walkPhase = (Math.abs(seed) % 17) * 0.34;
  let walking = 0;
  let bowAmount = 0;
  let sittingAmount = 0;
  let bowTime = 0;
  let previouslyBowing = false;
  let disposed = false;
  const smooth = (a, b, amount) => a + (b - a) * amount;
  const inverseRoot = new THREE.Matrix4();
  const soleTransform = new THREE.Matrix4();

  return {
    group,
    animate({
      time = 0,
      delta = 0.016,
      moving = false,
      speed = 1,
      bowing = false,
      sitting = false,
      progress,
    } = {}) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(delta, 0.1));
      const blend = 1 - Math.exp(-12 * dt);
      sittingAmount = smooth(sittingAmount, sitting && !bowing && !moving ? 1 : 0, blend);
      walking = smooth(walking, moving && !bowing && !sitting ? 1 : 0, blend);
      walkPhase += dt * (6.2 + Math.min(Math.abs(speed), 5) * 0.5) * walking;
      if (bowing && !previouslyBowing) bowTime = 0;
      if (bowing) bowTime += dt;
      previouslyBowing = bowing;
      const bowProgress = Number.isFinite(progress) ? progress : Math.min(1, bowTime / 2.8);
      const envelope = bowing ? Math.sin(Math.min(1, bowProgress) * Math.PI * 0.92) : 0;
      bowAmount = smooth(bowAmount, Math.max(bowing ? 0.16 : 0, envelope), blend);
      const stride = Math.sin(walkPhase) * 0.36 * walking * (1 - bowAmount);
      const breathe = Math.sin(time * 1.6 + seed * 0.01) * 0.0035;
      hips.position.y = 0.74 - bowAmount * 0.25 + Math.cos(walkPhase * 2) * 0.017 * walking;
      hips.rotation.y = Math.sin(walkPhase) * 0.025 * walking;
      torso.rotation.x = bowAmount * 1.18 + walking * 0.025 + breathe;
      torso.rotation.z = Math.sin(walkPhase) * 0.024 * walking;
      head.rotation.x = -0.035 * bowAmount;
      head.rotation.y = Math.sin(time * 0.35 + seed) * 0.025 * (1 - walking) * (1 - bowAmount);
      for (const leg of legs) {
        const angle = stride * leg.side;
        leg.upper.rotation.x = smooth(smooth(angle, -1.4, sittingAmount), -1.05, bowAmount);
        leg.upper.rotation.z = leg.side * 0.012;
        leg.lower.rotation.x = smooth(
          smooth(Math.max(0, -angle) * 1.1 + walking * 0.035, 2.75, sittingAmount),
          1.6,
          bowAmount,
        );
        leg.foot.rotation.x = smooth(
          -Math.max(0, angle) * 0.22 * (1 - bowAmount),
          -1.35,
          sittingAmount,
        );
        leg.foot.rotation.y = Math.PI * sittingAmount;
      }
      for (const arm of arms) {
        const armSwing = -stride * arm.side * 0.68;
        arm.upper.rotation.x = smooth(
          smooth(armSwing - 0.035, -0.3, sittingAmount),
          -1.34,
          bowAmount,
        );
        arm.upper.rotation.z = smooth(
          smooth(-arm.side * 0.055, -arm.side * 0.24, sittingAmount),
          -arm.side * 0.46,
          bowAmount,
        );
        arm.lower.rotation.x = smooth(
          smooth(-0.09 - walking * 0.08, -0.3, sittingAmount),
          -1.05,
          bowAmount,
        );
        arm.lower.rotation.z =
          -arm.side * (0.36 * bowAmount + 0.25 * sittingAmount * (1 - bowAmount));
        arm.hand.rotation.x = (-Math.PI / 2) * sittingAmount * (1 - bowAmount);
        arm.hand.rotation.z = -arm.side * 0.1 * bowAmount;
      }
      // Anchor the lowest sole to the walking surface through both the stride
      // and bow poses; bending the legs should not leave the whole body aloft.
      group.updateWorldMatrix(true, true);
      inverseRoot.copy(group.matrixWorld).invert();
      let lowestSole = Infinity;
      for (const leg of legs) {
        soleTransform.multiplyMatrices(inverseRoot, leg.sole.matrixWorld);
        const m = soleTransform.elements;
        const p = leg.sole.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const y = m[1] * p.getX(i) + m[5] * p.getY(i) + m[9] * p.getZ(i) + m[13];
          lowestSole = Math.min(lowestSole, y);
        }
      }
      hips.position.y += 0.0225 - lowestSole;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      liveAvatars--;
      if (liveAvatars > 0) return;
      new Set(geometryCache.values()).forEach((item) => item.dispose());
      geometryCache.clear();
      materialCache.forEach((materials) =>
        Object.values(materials).forEach((item) => item.dispose()),
      );
      materialCache.clear();
      weave?.map.dispose();
      weave?.bumpMap.dispose();
      weave = null;
    },
  };
}
