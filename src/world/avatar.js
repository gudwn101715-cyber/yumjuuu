import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const AVATAR_HEIGHT = 1.15;
export const AVATAR_PIVOT_HEIGHT = 0.88;
export const AVATAR_SOLE_HEIGHT = 0.006;

// One small, unisex character rig is shared by every pilgrim. The rounded
// silhouettes stay readable without realistic anatomy or noisy cloth textures.
const geometries = new Map();
const palettes = new Map();
let liveAvatars = 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

function geometry(key, build) {
  if (!geometries.has(key)) geometries.set(key, build());
  return geometries.get(key);
}

function bake(THREE, key, pieces) {
  return geometry(key, () => {
    const transformed = pieces.map(({ geometry: source, position, rotation, scale }) => {
      const copy = source.index ? source.toNonIndexed() : source.clone();
      copy.applyMatrix4(
        new THREE.Matrix4().compose(
          new THREE.Vector3(...(position || [0, 0, 0])),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation || [0, 0, 0]))),
          new THREE.Vector3(...(scale || [1, 1, 1])),
        ),
      );
      source.dispose();
      return copy;
    });
    const result = mergeGeometries(transformed);
    transformed.forEach((piece) => piece.dispose());
    return result;
  });
}

function materials(THREE, isSelf, seed) {
  const index = isSelf ? 0 : 1 + (Math.abs(seed) % 5);
  if (palettes.has(index)) return palettes.get(index);
  const tones = [
    ['#b5b9b1', '#939d90', '#ba9560'],
    ['#bbc0b4', '#98a190', '#b39568'],
    ['#b2beb8', '#8c9d91', '#bc9b70'],
    ['#c0bdb1', '#a19c8d', '#b69869'],
    ['#b6bebd', '#91a09b', '#b9a06f'],
    ['#bebeb0', '#9b9e8d', '#c1a173'],
  ][index];
  const matte = (color, roughness = 0.94) => new THREE.MeshStandardMaterial({ color, roughness });
  const result = {
    robe: matte(tones[0]),
    trousers: matte(tones[1]),
    kasa: matte(tones[2]),
    seam: matte('#d4b77f'),
    collar: matte('#f1ead6'),
    slipper: matte('#808d7a'),
    sole: matte('#697761'),
    skin: matte('#f4cdae', 0.86),
    features: matte('#49382e', 0.8),
    highlight: matte('#fff9df', 0.6),
    cheeks: matte('#e6a08b'),
    wood: matte('#72533a'),
    ember: new THREE.MeshBasicMaterial({ color: '#f2b57b' }),
  };
  result.kasa.side = THREE.DoubleSide;
  palettes.set(index, result);
  return result;
}

function kasaPoint(angle, v, extra = 0) {
  const x = Math.cos(angle) * 0.248;
  const y = mix(-0.165, 0.15 - x * 0.52, v);
  return [Math.cos(angle) * (0.248 + extra), y, Math.sin(angle) * (0.194 + extra)];
}

function kasaGeometry(THREE) {
  const positions = [],
    uvs = [],
    indices = [];
  const columns = 40,
    rows = 10;
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns,
        v = row / rows;
      positions.push(...kasaPoint(u * Math.PI * 2, v));
      uvs.push(u, v);
      if (row < rows && column < columns) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}

/**
 * Local +Z faces forward. The feet rest at AVATAR_SOLE_HEIGHT. Body translations
 * and yaw belong to the scene; this rig owns only the compact character poses.
 */
export function createPilgrimAvatar({ THREE, isSelf = false, seed = 0 }) {
  if (!THREE) throw new Error('createPilgrimAvatar requires the Three.js namespace.');
  liveAvatars++;
  const M = materials(THREE, isSelf, seed);
  const group = new THREE.Group();
  group.name = 'little-temple-pilgrim';
  const torso = new THREE.Group();
  group.add(torso);
  const head = new THREE.Group();
  head.position.set(0, 0.45, -0.015);
  torso.add(head);

  function mesh(key, build, material, parent = group, position = [0, 0, 0]) {
    const object = new THREE.Mesh(geometry(key, build), material);
    object.name = key;
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function line(key, points, radius, material, parent = torso) {
    return mesh(
      key,
      () =>
        new THREE.TubeGeometry(
          new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))),
          Math.max(10, points.length * 3),
          radius,
          5,
          false,
        ),
      material,
      parent,
    );
  }
  const sphere = (key, scale, material, parent, position = [0, 0, 0]) =>
    mesh(
      key,
      () => {
        const result = new THREE.SphereGeometry(1, 24, 16);
        result.scale(...scale);
        return result;
      },
      material,
      parent,
      position,
    );

  mesh(
    'little-rounded-robe',
    () => {
      const result = new THREE.LatheGeometry(
        [
          [0, -0.18],
          [0.16, -0.18],
          [0.218, -0.165],
          [0.236, -0.08],
          [0.224, 0.08],
          [0.19, 0.19],
          [0.11, 0.245],
          [0, 0.245],
        ].map(([radius, y]) => new THREE.Vector2(radius, y)),
        32,
      );
      result.scale(1, 1, 0.78);
      return result;
    },
    M.robe,
    torso,
    [0, 0.035, 0],
  );
  mesh('little-wrapped-kasa', () => kasaGeometry(THREE), M.kasa, torso);
  mesh(
    'little-kasa-seams',
    () => {
      const pieces = [];
      const seam = (points) =>
        pieces.push({
          geometry: new THREE.TubeGeometry(
            new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))),
            points.length * 2,
            0.0011,
            4,
            false,
          ),
        });
      for (const v of [0.045, 0.5, 0.955])
        seam(Array.from({ length: 41 }, (_, i) => kasaPoint((i / 40) * Math.PI * 2, v, 0.0015)));
      for (let i = 0; i < 6; i++)
        seam(
          Array.from({ length: 11 }, (_, j) => kasaPoint((i / 6) * Math.PI * 2, j / 10, 0.0015)),
        );
      return bake(THREE, 'little-kasa-seam-bake', pieces);
    },
    M.seam,
    torso,
  );
  line(
    'little-robe-collar',
    [
      [-0.092, 0.277, 0.046],
      [-0.066, 0.235, 0.127],
      [0.006, 0.171, 0.176],
      [0.074, 0.12, 0.182],
    ],
    0.012,
    M.collar,
  );
  line(
    'little-robe-inner-collar',
    [
      [0.092, 0.277, 0.046],
      [0.066, 0.235, 0.127],
      [0.006, 0.171, 0.176],
    ],
    0.01,
    M.collar,
  );

  mesh(
    'little-bald-head',
    () =>
      bake(THREE, 'little-head-bake', [
        { geometry: new THREE.SphereGeometry(1, 32, 20), scale: [0.27, 0.27, 0.25] },
        ...[-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(1, 14, 10),
          position: [side * 0.267, -0.012, -0.01],
          scale: [0.029, 0.037, 0.029],
        })),
        {
          geometry: new THREE.SphereGeometry(1, 14, 10),
          position: [0, -0.018, 0.249],
          scale: [0.019, 0.014, 0.016],
        },
      ]),
    M.skin,
    head,
  );
  mesh(
    'little-dot-eyes',
    () =>
      bake(
        THREE,
        'little-eyes-bake',
        [-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(1, 14, 10),
          position: [side * 0.087, 0.027, 0.238],
          scale: [0.018, 0.023, 0.011],
          rotation: [0, side * 0.27, 0],
        })),
      ),
    M.features,
    head,
  );
  mesh(
    'little-eye-sparkles',
    () =>
      bake(
        THREE,
        'little-eye-sparkles-bake',
        [-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(0.0052, 8, 6),
          position: [side * 0.087 - 0.004, 0.034, 0.248],
        })),
      ),
    M.highlight,
    head,
  );
  mesh(
    'little-rosy-cheeks',
    () =>
      bake(
        THREE,
        'little-cheeks-bake',
        [-1, 1].map((side) => ({
          geometry: new THREE.SphereGeometry(1, 14, 10),
          position: [side * 0.151, -0.036, 0.207],
          scale: [0.035, 0.016, 0.009],
          rotation: [0, side * 0.45, 0],
        })),
      ),
    M.cheeks,
    head,
  );
  line(
    'little-kind-smile',
    [
      [-0.032, -0.069, 0.239],
      [-0.018, -0.078, 0.246],
      [0, -0.081, 0.249],
      [0.018, -0.078, 0.246],
      [0.032, -0.069, 0.239],
    ],
    0.004,
    M.features,
    head,
  );

  const yAxis = new THREE.Vector3(0, 1, 0);
  const segmentDirection = new THREE.Vector3();
  const shoulder = new THREE.Vector3();
  const handTarget = new THREE.Vector3();
  const elbow = new THREE.Vector3();
  const shoulderToHand = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const torsoRotation = new THREE.Quaternion();
  const torsoPosition = new THREE.Vector3();
  const arms = [];
  const legs = [];
  const limb = (name, radius, material) =>
    mesh(name, () => new THREE.CapsuleGeometry(radius, 0.12, 4, 12), material);
  function segment(object, from, to, radius) {
    segmentDirection.subVectors(to, from);
    const length = segmentDirection.length();
    object.position.copy(from).add(to).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(yAxis, segmentDirection.normalize());
    object.scale.set(1, length / (radius * 2 + 0.12), 1);
  }
  for (const side of [-1, 1]) {
    const arm = {
      side,
      upper: limb('little-upper-sleeve', 0.071, M.robe),
      lower: limb('little-lower-sleeve', 0.063, M.robe),
      hand: sphere('little-hand', [0.032, 0.047, 0.031], M.skin, group),
    };
    arms.push(arm);
    const leg = {
      side,
      upper: limb('little-upper-trouser', 0.081, M.trousers),
      lower: limb('little-lower-trouser', 0.063, M.trousers),
      foot: new THREE.Group(),
    };
    leg.foot.name = side < 0 ? 'left-foot' : 'right-foot';
    group.add(leg.foot);
    sphere('little-round-slipper', [0.083, 0.056, 0.127], M.slipper, leg.foot, [0, 0.062, 0.026]);
    mesh(
      'little-slipper-sole',
      () => {
        const sole = new THREE.CylinderGeometry(0.1, 0.1, 0.026, 20);
        sole.scale(0.85, 1, 1.4);
        return sole;
      },
      M.sole,
      leg.foot,
      [0, 0.019, 0.026],
    );
    legs.push(leg);
  }
  const incense = mesh(
    'little-offering-incense',
    () => new THREE.CylinderGeometry(0.004, 0.004, 0.24, 6),
    M.wood,
  );
  const ember = sphere(
    'little-incense-ember',
    [0.006, 0.007, 0.006],
    M.ember,
    incense,
    [0, 0.123, 0],
  );
  group.remove(incense);
  ember.castShadow = false;

  // Explicit ground-contact poses replace the old shallow whole-body tilt.
  // Each keyframe uses pelvis height, torso lean, kneel amount and hand mode.
  const frames = [
    { p: 0, hip: 0.34, lean: 0, kneel: 0, hands: 1 },
    { p: 0.14, hip: 0.34, lean: 0, kneel: 0, hands: 1 },
    { p: 0.31, hip: 0.19, lean: 0.12, kneel: 1, hands: 0.45 },
    { p: 0.49, hip: 0.145, lean: 1.55, kneel: 1, hands: 0 },
    { p: 0.68, hip: 0.145, lean: 1.55, kneel: 1, hands: 0 },
    { p: 0.86, hip: 0.19, lean: 0.08, kneel: 1, hands: 0.75 },
    { p: 1, hip: 0.34, lean: 0, kneel: 0, hands: 1 },
  ];
  let phase = (Math.abs(seed) % 13) * 0.4;
  let disposed = false;
  let previousBowing = false;
  let localBowTime = 0;
  let poseHip = 0.34,
    poseLean = 0,
    poseKneel = 0,
    poseHands = 0;
  const hipPoint = new THREE.Vector3(),
    kneePoint = new THREE.Vector3(),
    anklePoint = new THREE.Vector3(),
    idleHand = new THREE.Vector3(),
    prayerHand = new THREE.Vector3(),
    floorHand = new THREE.Vector3();

  function animate({
    time = 0,
    delta = 0.016,
    moving = false,
    speed = 1,
    bowing = false,
    sitting = false,
    gassho = false,
    incenseOffering = false,
    progress,
  } = {}) {
    if (disposed) return;
    const dt = clamp(delta, 0, 0.15);
    const blend = 1 - Math.exp(-18 * dt);
    const walking = moving && !bowing && !sitting;
    if (walking) phase += dt * (6 + Math.min(Math.abs(speed), 5) * 0.45);
    if (bowing && !previousBowing) localBowTime = 0;
    if (bowing) localBowTime += dt;
    previousBowing = bowing;
    const t = clamp(Number.isFinite(progress) ? progress : localBowTime / 3, 0, 1);
    let hip = sitting && !moving ? 0.19 : 0.34;
    let lean = 0;
    let kneel = sitting && !moving ? 1 : 0;
    let hands = gassho || incenseOffering ? 1 : 0;
    if (bowing) {
      let a = frames[0],
        b = frames.at(-1);
      for (let i = 1; i < frames.length; i++) {
        if (t <= frames[i].p) {
          a = frames[i - 1];
          b = frames[i];
          break;
        }
      }
      const u = smoothstep(clamp((t - a.p) / Math.max(0.0001, b.p - a.p), 0, 1));
      hip = mix(a.hip, b.hip, u);
      lean = mix(a.lean, b.lean, u);
      kneel = mix(a.kneel, b.kneel, u);
      hands = mix(a.hands, b.hands, u);
      if (sitting && t > 0.86) {
        hip = mix(hip, 0.19, smoothstep((t - 0.86) / 0.14));
        kneel = 1;
      }
    }
    // Authoritative progress drives a complete pose immediately. Idle changes
    // are softened, but a slow frame never turns the floor-touch into a nod.
    const poseBlend = bowing ? 1 : blend;
    poseHip = mix(poseHip, hip, poseBlend);
    poseLean = mix(poseLean, lean, poseBlend);
    poseKneel = mix(poseKneel, kneel, poseBlend);
    poseHands = mix(poseHands, hands, poseBlend);
    const stride = walking ? Math.sin(phase) : 0;
    const hipZ = -0.065 * poseKneel;
    const bob = walking ? Math.abs(Math.sin(phase * 2)) * 0.012 : 0;
    torso.position.set(0, poseHip + 0.09 + bob, hipZ);
    torso.rotation.set(poseLean, walking ? stride * 0.025 : 0, walking ? stride * 0.018 : 0);
    head.rotation.set(
      bowing ? 0.25 * (poseLean / 1.55) : 0,
      !bowing && !moving ? Math.sin(time * 0.5 + seed) * 0.025 : 0,
      0,
    );
    torsoRotation.setFromEuler(torso.rotation);
    torsoPosition.copy(torso.position);

    for (const leg of legs) {
      hipPoint.set(leg.side * 0.105, poseHip, hipZ);
      kneePoint.set(
        leg.side * mix(0.105, 0.125, poseKneel),
        mix(0.19, 0.078, poseKneel),
        mix(stride * leg.side * 0.055, 0.09, poseKneel),
      );
      anklePoint.set(
        leg.side * mix(0.105, 0.125, poseKneel),
        0.066 + (walking ? Math.max(0, stride * leg.side) * 0.032 : 0),
        mix(stride * leg.side * 0.105, -0.075, poseKneel),
      );
      segment(leg.upper, hipPoint, kneePoint, 0.081);
      segment(leg.lower, kneePoint, anklePoint, 0.063);
      leg.foot.position.set(anklePoint.x, anklePoint.y - 0.066, anklePoint.z);
      leg.foot.rotation.set(0, Math.PI * poseKneel, 0);
    }
    for (const arm of arms) {
      shoulder
        .set(arm.side * 0.215, 0.205, -0.005)
        .applyQuaternion(torsoRotation)
        .add(torsoPosition);
      idleHand.set(arm.side * 0.275, poseHip + 0.005, 0.035 + stride * arm.side * 0.035);
      prayerHand.set(arm.side * 0.027, poseHip + 0.205, 0.218 + hipZ);
      floorHand.set(arm.side * 0.195, 0.041, 0.43 + hipZ);
      handTarget.copy(idleHand).lerp(prayerHand, poseHands);
      if (bowing) handTarget.copy(floorHand).lerp(prayerHand, poseHands);
      shoulderToHand.subVectors(handTarget, shoulder);
      const reach = clamp(shoulderToHand.length(), 0.025, 0.318);
      shoulderToHand.normalize();
      handTarget.copy(shoulder).addScaledVector(shoulderToHand, reach);
      middle.copy(shoulder).add(handTarget).multiplyScalar(0.5);
      bend.set(arm.side, 0.12, -0.15);
      bend.addScaledVector(shoulderToHand, -bend.dot(shoulderToHand)).normalize();
      elbow
        .copy(middle)
        .addScaledVector(bend, Math.sqrt(Math.max(0, 0.16 ** 2 - (reach / 2) ** 2)));
      segment(arm.upper, shoulder, elbow, 0.071);
      segment(arm.lower, elbow, handTarget, 0.063);
      arm.hand.position.copy(handTarget);
      arm.hand.rotation.set(
        bowing ? (-Math.PI / 2) * (1 - poseHands) : 0,
        0,
        arm.side * poseHands * 0.06,
      );
      arm.hand.scale.set(mix(1, 0.84, poseHands), 1, 1);
    }
    if (incenseOffering && !bowing) {
      if (!incense.parent) group.add(incense);
      incense.position.set(0, poseHip + 0.35, 0.21 + hipZ);
      incense.rotation.x = -0.12;
    } else incense.removeFromParent();
    group.updateMatrixWorld(true);
  }

  animate({ delta: 1 });
  return {
    group,
    animate,
    dispose() {
      if (disposed) return;
      disposed = true;
      incense.removeFromParent();
      group.removeFromParent();
      liveAvatars--;
      if (liveAvatars > 0) return;
      new Set(geometries.values()).forEach((item) => item.dispose());
      geometries.clear();
      palettes.forEach((palette) =>
        Object.values(palette).forEach((material) => material.dispose()),
      );
      palettes.clear();
    },
  };
}
