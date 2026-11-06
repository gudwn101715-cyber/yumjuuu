import { HALL_LAYOUTS, SEATS, INCENSE_STATIONS } from '../../shared/templeLayout.js';

/**
 * Korean temple architecture built for a human-height, third-person camera.
 * All render geometry retains UVs and can be merged by material by the scene.
 */
export function buildTempleArchitecture({ THREE, root, halls, materials: M }) {
  const colliders = [];
  const signs = [];
  const surfaces = [];
  const ownedMaterials = [];
  const ownedTextures = [];
  const collisionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let disposed = false;

  const add = (geometry, material, x = 0, y = 0, z = 0, scale = null) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    if (scale) object.scale.set(...scale);
    object.castShadow = true;
    object.receiveShadow = true;
    root.add(object);
    return object;
  };
  const box = (w, h, d, mat, x, y, z) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cylinder = (r1, r2, h, mat, x, y, z, sides = 16) =>
    add(new THREE.CylinderGeometry(r1, r2, h, sides), mat, x, y, z);
  const sphere = (r, mat, x, y, z, scale = [1, 1, 1]) =>
    add(new THREE.SphereGeometry(r, 20, 14), mat, x, y, z, scale);
  const collider = (w, h, d, x, y, z) => {
    const object = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), collisionMaterial);
    object.position.set(x, y, z);
    object.updateMatrixWorld(true);
    colliders.push(object);
    return object;
  };
  const tube = (points, radius, mat, segments = 20, radialSegments = 8) =>
    add(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))),
        segments,
        radius,
        radialSegments,
        false,
      ),
      mat,
    );

  function roofHeight(x, z, width, depth, rise, scale) {
    const xx = Math.abs((x * 2) / width);
    const zz = Math.abs((z * 2) / depth);
    return (
      rise * Math.pow(Math.max(0, 1 - zz), 0.83) +
      scale * (0.35 * xx ** 5 + 0.38 * zz ** 5 + 0.24 * (xx * zz) ** 4)
    );
  }

  function roofSurface(width, depth, rise, scale) {
    const columns = 48;
    const rows = 32;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let iz = 0; iz <= rows; iz++) {
      const z = (iz / rows - 0.5) * depth;
      for (let ix = 0; ix <= columns; ix++) {
        const x = (ix / columns - 0.5) * width;
        positions.push(x, roofHeight(x, z, width, depth, rise, scale), z);
        uvs.push((x + width / 2) / 3, (z + depth / 2) / 3);
        if (iz < rows && ix < columns) {
          const a = iz * (columns + 1) + ix;
          const b = a + columns + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function roofTiles(width, depth, rise, scale) {
    // One geometry contains the overlapping half-round tile rows. The close
    // eaves have real relief instead of a flat roof with painted lines.
    const positions = [];
    const uvs = [];
    const indices = [];
    const rowCount = Math.ceil(width / (0.48 * scale));
    const tileCount = Math.ceil(depth / (0.78 * scale));
    const arcSegments = 5;
    const radius = 0.105 * scale;
    for (let row = 0; row <= rowCount; row++) {
      const x = -width / 2 + (row / rowCount) * width;
      for (let tile = 0; tile < tileCount; tile++) {
        const a = -depth / 2 + (tile / tileCount) * depth;
        const b = Math.min(depth / 2, a + depth / tileCount + 0.11 * scale);
        const start = positions.length / 3;
        for (let end = 0; end < 2; end++) {
          const z = end ? b : a;
          const y = roofHeight(x, z, width, depth, rise, scale) + 0.035 * scale;
          for (let arc = 0; arc <= arcSegments; arc++) {
            const angle = (arc / arcSegments) * Math.PI;
            positions.push(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z);
            uvs.push(arc / arcSegments, end);
            if (end === 0 && arc < arcSegments) {
              const v = start + arc;
              const next = v + arcSegments + 1;
              indices.push(v, v + 1, next, next, v + 1, next + 1);
            }
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function fascia(width, y, frontZ, scale, x) {
    box(width, 0.42 * scale, 0.34 * scale, M.woodDark, x, y, frontZ);
    box(width, 0.17 * scale, 0.38 * scale, M.jade, x, y + 0.13 * scale, frontZ + 0.03 * scale);
    box(width, 0.055 * scale, 0.39 * scale, M.gold, x, y - 0.1 * scale, frontZ + 0.04 * scale);
    const patternCount = Math.floor(width / (1.15 * scale));
    for (let i = 0; i < patternCount; i++) {
      const xx = x - width / 2 + ((i + 0.5) / patternCount) * width;
      const diamond = box(
        0.23 * scale,
        0.23 * scale,
        0.045 * scale,
        M.wood,
        xx,
        y,
        frontZ + 0.21 * scale,
      );
      diamond.rotation.z = Math.PI / 4;
      const center = cylinder(
        0.055 * scale,
        0.055 * scale,
        0.05 * scale,
        M.goldLight,
        xx,
        y,
        frontZ + 0.25 * scale,
        10,
      );
      center.rotation.x = Math.PI / 2;
    }
  }

  function bracket(x, y, z, s) {
    for (let tier = 0; tier < 3; tier++) {
      const width = (2.1 - tier * 0.4) * s;
      const yy = y - tier * 0.25 * s;
      box(width, 0.17 * s, (1.05 + tier * 0.23) * s, tier % 2 ? M.wood : M.jade, x, yy, z);
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0);
        shape.lineTo(side * width * 0.48, 0.02 * s);
        shape.quadraticCurveTo(side * width * 0.53, -0.23 * s, side * width * 0.25, -0.31 * s);
        shape.lineTo(0, -0.28 * s);
        shape.closePath();
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: 0.18 * s,
          bevelEnabled: true,
          bevelThickness: 0.025 * s,
          bevelSize: 0.025 * s,
          bevelSegments: 1,
          steps: 1,
          curveSegments: 5,
        });
        add(geometry, tier % 2 ? M.jade : M.wood, x, yy - 0.04 * s, z + 0.35 * s);
      }
    }
  }

  function plaqueMaterial(text, index) {
    if (typeof document === 'undefined') return M.woodDark;
    const canvas = document.createElement('canvas');
    canvas.width = 1536;
    canvas.height = 384;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.84 });
    ownedTextures.push(texture);
    ownedMaterials.push(material);
    const hanja = ['大雄殿', '觀音殿', '藥師殿', '冥想殿'][index] || text;
    const draw = () => {
      if (disposed) return;
      context.fillStyle = '#203c34';
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let line = 0; line < 120; line++) {
        context.strokeStyle = `rgba(16,26,20,${0.015 + (line % 7) * 0.008})`;
        context.lineWidth = 1 + (line % 4);
        context.beginPath();
        context.moveTo(0, line * 3.3);
        context.bezierCurveTo(470, line * 3.3 + 6, 870, line * 3.3 - 8, 1536, line * 3.3 + 3);
        context.stroke();
      }
      context.strokeStyle = '#ba9a55';
      context.lineWidth = 6;
      context.strokeRect(20, 20, 1496, 344);
      context.strokeStyle = '#d9c58a';
      context.lineWidth = 1.5;
      context.strokeRect(34, 34, 1468, 316);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = '#e0c889';
      context.shadowColor = '#101910';
      context.shadowBlur = 4;
      context.font = '190px "Gowun Batang", "Noto Serif CJK KR", serif';
      const letters = [...hanja];
      const spacing = 290;
      letters.forEach((character, i) =>
        context.fillText(character, 768 + (i - (letters.length - 1) / 2) * spacing, 166),
      );
      context.shadowBlur = 0;
      context.font = '36px "Gowun Batang", serif';
      context.fillStyle = '#c3b385';
      context.fillText(text.split('').join('   '), 768, 307);
      texture.needsUpdate = true;
    };
    draw();
    document.fonts?.ready.then(draw);
    return material;
  }

  function lotusBuddha(x, floor, z, s) {
    cylinder(1.65 * s, 1.8 * s, 0.25 * s, M.stoneDark, x, floor + 0.125 * s, z, 32);
    cylinder(1.48 * s, 1.65 * s, 0.27 * s, M.gold, x, floor + 0.38 * s, z, 32);
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const petal = sphere(
        0.3 * s,
        i % 2 ? M.gold : M.goldLight,
        x + Math.sin(angle) * 1.28 * s,
        floor + 0.5 * s,
        z + Math.cos(angle) * 1.1 * s,
        [0.58, 1.1, 1.15],
      );
      petal.rotation.y = angle;
      petal.rotation.x = 0.45;
    }
    cylinder(1.28 * s, 1.4 * s, 0.2 * s, M.goldLight, x, floor + 0.65 * s, z, 32);
    // Crossed knees and the folded robe create a seated silhouette rather than stacked balls.
    const leftKnee = sphere(
      0.68 * s,
      M.gold,
      x - 0.55 * s,
      floor + 0.94 * s,
      z + 0.24 * s,
      [1.22, 0.46, 0.86],
    );
    leftKnee.rotation.y = -0.18;
    const rightKnee = sphere(
      0.68 * s,
      M.goldLight,
      x + 0.55 * s,
      floor + 0.94 * s,
      z + 0.24 * s,
      [1.22, 0.46, 0.86],
    );
    rightKnee.rotation.y = 0.18;
    sphere(0.42 * s, M.gold, x + 0.2 * s, floor + 1.05 * s, z + 0.65 * s, [1.05, 0.33, 0.6]);
    sphere(0.42 * s, M.goldLight, x - 0.2 * s, floor + 1.12 * s, z + 0.55 * s, [1.05, 0.33, 0.6]);
    const torsoPoints = [
      [0.46, 0],
      [0.6, 0.18],
      [0.64, 0.6],
      [0.68, 0.92],
      [0.53, 1.15],
      [0.26, 1.3],
    ].map(([r, y]) => new THREE.Vector2(r * s, y * s));
    add(new THREE.LatheGeometry(torsoPoints, 28), M.gold, x, floor + 1.05 * s, z);
    cylinder(0.19 * s, 0.25 * s, 0.3 * s, M.goldLight, x, floor + 2.4 * s, z, 20);
    sphere(0.39 * s, M.goldLight, x, floor + 2.78 * s, z + 0.02 * s, [0.86, 1.14, 0.88]);
    sphere(0.35 * s, M.gold, x, floor + 3.03 * s, z - 0.06 * s, [0.94, 0.65, 0.96]);
    sphere(0.14 * s, M.gold, x, floor + 3.28 * s, z - 0.04 * s, [0.9, 0.9, 0.9]);
    for (const side of [-1, 1]) {
      sphere(
        0.085 * s,
        M.goldLight,
        x + side * 0.335 * s,
        floor + 2.7 * s,
        z + 0.01 * s,
        [0.7, 1.65, 0.7],
      );
      const eyebrow = tube(
        [
          [x + side * 0.07 * s, floor + 2.87 * s, z + 0.335 * s],
          [x + side * 0.18 * s, floor + 2.89 * s, z + 0.31 * s],
        ],
        0.018 * s,
        M.gold,
        4,
        5,
      );
      eyebrow.castShadow = false;
    }
    sphere(0.075 * s, M.gold, x, floor + 2.76 * s, z + 0.35 * s, [0.5, 1.0, 0.9]);
    // One hand raised in reassurance, the other rests in the lap.
    tube(
      [
        [x + 0.55 * s, floor + 2.05 * s, z],
        [x + 0.79 * s, floor + 1.7 * s, z + 0.12 * s],
        [x + 0.75 * s, floor + 2.12 * s, z + 0.36 * s],
      ],
      0.13 * s,
      M.goldLight,
      12,
      8,
    );
    sphere(0.16 * s, M.goldLight, x + 0.75 * s, floor + 2.3 * s, z + 0.38 * s, [0.58, 1.35, 0.35]);
    tube(
      [
        [x - 0.54 * s, floor + 2.05 * s, z],
        [x - 0.77 * s, floor + 1.48 * s, z + 0.2 * s],
        [x - 0.22 * s, floor + 1.37 * s, z + 0.58 * s],
      ],
      0.14 * s,
      M.gold,
      14,
      8,
    );
    sphere(0.15 * s, M.goldLight, x - 0.16 * s, floor + 1.38 * s, z + 0.59 * s, [1.5, 0.45, 0.85]);
    // Sculpted robe folds follow the chest and crossed knees.
    for (let i = 0; i < 5; i++) {
      const f = i * 0.12 * s;
      tube(
        [
          [x - 0.4 * s, floor + 2.2 * s - f, z + 0.42 * s],
          [x - 0.2 * s, floor + 1.76 * s - f, z + 0.58 * s],
          [x + 0.45 * s, floor + 1.3 * s - f * 0.35, z + 0.43 * s],
        ],
        0.022 * s,
        M.goldLight,
        12,
        5,
      );
    }
    const halo = add(
      new THREE.TorusGeometry(1.31 * s, 0.035 * s, 8, 64),
      M.goldLight,
      x,
      floor + 2.12 * s,
      z - 0.55 * s,
    );
    halo.scale.y = 1.13;
    const outerHalo = add(
      new THREE.TorusGeometry(1.45 * s, 0.019 * s, 6, 64),
      M.gold,
      x,
      floor + 2.12 * s,
      z - 0.58 * s,
    );
    outerHalo.scale.y = 1.13;
  }

  function paperLantern(x, y, z, s) {
    cylinder(0.018 * s, 0.018 * s, 0.6 * s, M.woodDark, x, y + 0.48 * s, z, 5);
    sphere(0.32 * s, M.flame || M.cream, x, y - 0.06 * s, z, [1, 1.35, 1]);
    for (const side of [-1, 1])
      cylinder(0.17 * s, 0.17 * s, 0.065 * s, M.woodDark, x, y + side * 0.43 * s - 0.06 * s, z, 16);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const points = [];
      for (let j = 0; j <= 8; j++) {
        const a = (j / 8) * Math.PI;
        const radius = Math.sin(a) * 0.32 * s;
        points.push([
          x + Math.sin(angle) * radius,
          y + Math.cos(a) * 0.43 * s - 0.06 * s,
          z + Math.cos(angle) * radius,
        ]);
      }
      tube(points, 0.009 * s, M.gold, 8, 4);
    }
    cylinder(0.014 * s, 0.014 * s, 0.3 * s, M.gold, x, y - 0.64 * s, z, 5);
  }

  function incenseVessel(x, y, z, s) {
    cylinder(0.45 * s, 0.53 * s, 0.15 * s, M.stoneDark, x, y + 0.075 * s, z);
    for (const dx of [-0.22, 0.22])
      cylinder(0.065 * s, 0.09 * s, 0.3 * s, M.gold, x + dx * s, y + 0.3 * s, z);
    cylinder(0.44 * s, 0.32 * s, 0.32 * s, M.gold, x, y + 0.57 * s, z, 24);
    cylinder(0.45 * s, 0.45 * s, 0.06 * s, M.goldLight, x, y + 0.76 * s, z, 24);
    cylinder(0.35 * s, 0.35 * s, 0.045 * s, M.stoneLight, x, y + 0.79 * s, z, 24);
    for (let i = 0; i < 3; i++)
      cylinder(
        0.011 * s,
        0.011 * s,
        (0.45 + i * 0.08) * s,
        M.woodDark,
        x + (i - 1) * 0.12 * s,
        y + 1.05 * s,
        z + (i % 2) * 0.07 * s,
        5,
      );
  }

  // The seats use woven cloth rather than the stone/wood textures of the hall.
  const fabricMaps = (() => {
    if (typeof document === 'undefined') return {};
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const pixels = ctx.createImageData(128, 128);
    for (let iy = 0; iy < 128; iy++)
      for (let ix = 0; ix < 128; ix++) {
        const stripe = (ix % 4 === 0 ? -12 : 0) + (iy % 3 === 0 ? -9 : 0);
        const grain = Math.sin(ix * 12.4 + iy * 7.2) * 4;
        const value = 237 + stripe + grain;
        pixels.data.set([value, value - 1, value - 4, 255], (iy * 128 + ix) * 4);
      }
    ctx.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    ownedTextures.push(texture);
    return { map: texture, bumpMap: texture, bumpScale: 0.012 };
  })();
  const cloth = (color) => {
    const mat = new THREE.MeshStandardMaterial({ color, ...fabricMaps, roughness: 0.96 });
    ownedMaterials.push(mat);
    return mat;
  };
  const cushionCloth = [cloth('#6c7b61'), cloth('#803f39'), cloth('#61776c')];
  const runnerCloth = cloth('#643d37');
  const cushionBorder = cloth('#b49a5c');
  const darkHollow = new THREE.MeshStandardMaterial({ color: '#2b1d13', roughness: 0.94 });
  ownedMaterials.push(darkHollow);

  function roundedRectangle(width, depth, radius) {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2 + radius, -depth / 2);
    shape.lineTo(width / 2 - radius, -depth / 2);
    shape.quadraticCurveTo(width / 2, -depth / 2, width / 2, -depth / 2 + radius);
    shape.lineTo(width / 2, depth / 2 - radius);
    shape.quadraticCurveTo(width / 2, depth / 2, width / 2 - radius, depth / 2);
    shape.lineTo(-width / 2 + radius, depth / 2);
    shape.quadraticCurveTo(-width / 2, depth / 2, -width / 2, depth / 2 - radius);
    shape.lineTo(-width / 2, -depth / 2 + radius);
    shape.quadraticCurveTo(-width / 2, -depth / 2, -width / 2 + radius, -depth / 2);
    return shape;
  }
  const cushionShape = roundedRectangle(1.06, 0.87, 0.14);
  const cushionGeometry = new THREE.ExtrudeGeometry(cushionShape, {
    depth: 0.11,
    bevelEnabled: true,
    bevelSize: 0.055,
    bevelThickness: 0.055,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 5,
  });
  cushionGeometry.rotateX(-Math.PI / 2);
  const cushionPiping = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(
      cushionShape.getPoints(6).map((p) => new THREE.Vector3(p.x * 0.97, 0.125, -p.y * 0.97)),
      true,
    ),
    64,
    0.012,
    4,
    true,
  );
  const moktakBody = new THREE.SphereGeometry(0.235, 18, 12);
  const moktakHandle = new THREE.TorusGeometry(0.105, 0.037, 7, 20);
  const malletHead = new THREE.SphereGeometry(0.047, 10, 8);
  const standLeg = new THREE.CylinderGeometry(0.022, 0.03, 0.13, 6);
  const standTop = new THREE.BoxGeometry(0.7, 0.065, 0.55);
  const malletShaft = new THREE.CylinderGeometry(0.013, 0.016, 0.34, 7);
  const moktakSlit = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.17, -0.015, 0.165),
      new THREE.Vector3(-0.1, -0.038, 0.192),
      new THREE.Vector3(0, -0.045, 0.207),
      new THREE.Vector3(0.1, -0.038, 0.192),
      new THREE.Vector3(0.17, -0.015, 0.165),
    ]),
    14,
    0.014,
    4,
    false,
  );

  function meditationSeat(seat, index) {
    add(cushionGeometry, cushionCloth[index % cushionCloth.length], seat.x, seat.y + 0.06, seat.z);
    add(cushionPiping, cushionBorder, seat.x, seat.y + 0.06, seat.z);
    // The wooden fish is not a music drum: a hollow pear-shaped body, carved
    // mouth and a circular handle above it sit on an individual low stand.
    const p = seat.moktak;
    add(standTop, M.woodDark, p.x, seat.y + 0.17, p.z);
    for (const dx of [-0.27, 0.27])
      for (const dz of [-0.2, 0.2]) add(standLeg, M.woodDark, p.x + dx, seat.y + 0.085, p.z + dz);
    add(moktakBody, M.woodLight, p.x, p.y, p.z, [1.13, 0.87, 0.87]);
    add(moktakSlit, darkHollow, p.x, p.y, p.z);
    add(moktakHandle, M.wood, p.x, p.y + 0.225, p.z - 0.08);
    const shaft = add(malletShaft, M.wood, p.x + 0.27, seat.y + 0.235, p.z + 0.035);
    shaft.rotation.z = -Math.PI / 2;
    shaft.rotation.x = 0.15;
    add(malletHead, M.woodLight, p.x + 0.43, seat.y + 0.235, p.z + 0.035);
  }

  halls.forEach((hall, index) => {
    const layout = HALL_LAYOUTS[hall.id];
    if (!layout) return;
    const { x, z, width: w, depth: d, floor, eave, rise } = layout;
    const s = layout.detailScale;
    const main = hall.id === 'hall-main';
    const front = z + d / 2;
    const back = z - d / 2;
    const wallHeight = eave - floor - 0.35;
    const roofW = w + (main ? 6.7 : 5.8);
    const roofD = d + (main ? 6.3 : 5.5);
    const platformW = w + layout.platformMargin * 2;
    const platformD = d + layout.platformMargin * 2;

    // A substantial stone stylobate, with separately dressed blocks and a
    // broad processional stair, gives the hall real architectural weight.
    box(platformW, floor - 0.2, platformD, M.stoneDark, x, (floor - 0.2) / 2, z);
    const courses = 4;
    for (let row = 0; row < courses; row++) {
      const blockCount = Math.ceil(platformW / 2.1);
      for (let i = 0; i < blockCount; i++) {
        const xx = x - platformW / 2 + ((i + 0.5) / blockCount) * platformW;
        box(
          platformW / blockCount - 0.035,
          (floor - 0.24) / courses - 0.025,
          0.46,
          (i + row) % 3 ? M.stone : M.stoneLight,
          xx,
          0.1 + ((row + 0.5) / courses) * (floor - 0.24),
          front + layout.platformMargin - 0.15,
        );
      }
      for (const side of [-1, 1]) {
        const blocks = Math.ceil(platformD / 2);
        for (let i = 0; i < blocks; i++)
          box(
            0.46,
            (floor - 0.24) / courses - 0.025,
            platformD / blocks - 0.035,
            i % 2 ? M.stone : M.stoneLight,
            x + side * (platformW / 2 - 0.15),
            0.1 + ((row + 0.5) / courses) * (floor - 0.24),
            z - platformD / 2 + ((i + 0.5) / blocks) * platformD,
          );
      }
    }
    // Stone is an apron around the timber floor, not a full slab underneath it.
    // The old slab and plank tops were both exactly floor + .20, so their
    // overlapping triangles flickered between white granite and wood as viewed.
    const capW = platformW;
    const capD = platformD;
    const apronD = (capD - d) / 2;
    const apronW = (capW - w) / 2;
    for (const side of [-1, 1]) {
      box(capW, 0.18, apronD, M.stoneLight, x, floor + 0.11, z + (side * (d + apronD)) / 2);
      box(apronW, 0.18, d, M.stoneLight, x + (side * (w + apronW)) / 2, floor + 0.11, z);
    }
    box(w, 0.2, d, M.woodDark, x, floor + 0.02, z);
    const boards = Math.ceil(w / 0.68);
    for (let board = 0; board < boards; board++)
      box(
        w / boards - 0.025,
        0.08,
        d - 0.1,
        board % 5 ? M.wood : M.woodLight,
        x - w / 2 + ((board + 0.5) / boards) * w,
        floor + 0.16,
        z,
      );
    const stairStart = front + layout.platformMargin;
    for (let step = 0; step < layout.stairsCount; step++) {
      const height = ((layout.stairsCount - step) / layout.stairsCount) * (floor + 0.2);
      const stepZ = stairStart + (step + 0.5) * layout.stairsDepth;
      box(
        layout.stairsWidth,
        height,
        layout.stairsDepth,
        step % 2 ? M.stoneLight : M.stone,
        x,
        height / 2,
        stepZ,
      );
      for (let seam = -2; seam <= 2; seam++)
        box(
          0.018,
          0.01,
          layout.stairsDepth - 0.07,
          M.stoneDark,
          x + (seam * layout.stairsWidth) / 5,
          height + 0.005,
          stepZ,
        );
    }
    surfaces.push({
      ...layout,
      platformWidth: platformW,
      platformDepth: platformD,
      front,
      scale: 1,
      walkHeight: floor + 0.2,
    });

    // Rear plaster and deep side bays enclose an open, columned nave. Nothing
    // screens the central view from the steps to the gold altar.
    box(w - 0.4, wallHeight, 0.35, M.cream, x, floor + wallHeight / 2, back + 0.1);
    for (const side of [-1, 1]) {
      box(0.35, wallHeight, d - 0.2, M.cream, x + side * (w / 2 - 0.1), floor + wallHeight / 2, z);
      for (let beam = 0; beam <= 4; beam++)
        box(
          0.38,
          wallHeight,
          0.3,
          M.woodDark,
          x + (side * w) / 2,
          floor + wallHeight / 2,
          back + 0.5 + (beam * (d - 1)) / 4,
        );
      for (const height of [floor + 1.6, eave - 1.4])
        box(0.42, 0.2, d, M.wood, x + (side * w) / 2, height, z);
    }
    const pillarXs = main ? [-15.5, -10.3, -5.15, 5.15, 10.3, 15.5] : [-10.8, -5.4, 5.4, 10.8];
    for (const dx of pillarXs) {
      for (const zz of [front - 0.45, back + 0.55]) {
        cylinder(0.39 * s, 0.47 * s, wallHeight, M.wood, x + dx, floor + wallHeight / 2, zz, 20);
        cylinder(0.68 * s, 0.76 * s, 0.3, M.stoneLight, x + dx, floor + 0.16, zz, 16);
        cylinder(0.47 * s, 0.52 * s, 0.28, M.woodDark, x + dx, floor + 0.44, zz, 20);
        bracket(x + dx, eave - 0.68, zz, s);
      }
      // Heavy lengthwise tie beams are visible from the seated rows.
      box(0.4 * s, 0.55 * s, d - 0.5, M.woodDark, x + dx, eave - 1.0, z);
    }
    for (const zz of [back + 0.6, z - d * 0.18, z + d * 0.18, front - 0.4]) {
      box(w - 0.2, 0.6 * s, 0.48 * s, M.woodDark, x, eave - 0.8, zz);
      box(w - 0.2, 0.14 * s, 0.54 * s, M.jade, x, eave - 1.07, zz);
      box(w - 0.2, 0.035 * s, 0.57 * s, M.gold, x, eave - 1.17, zz);
    }
    // Decorative coffer rails and small gilt lotus bosses make the nave feel
    // carefully finished when the player looks up from a meditation cushion.
    for (const dx of [-w * 0.3, 0, w * 0.3])
      for (const dz of [-d * 0.24, d * 0.19]) {
        box(2.7 * s, 0.16, 2.1 * s, M.jade, x + dx, eave - 1.22, z + dz);
        const boss = cylinder(
          0.2 * s,
          0.29 * s,
          0.12,
          M.goldLight,
          x + dx,
          eave - 1.35,
          z + dz,
          12,
        );
        boss.rotation.x = Math.PI;
      }
    // Rich lattice panels stay against the rear wall and narrow outer bays,
    // preserving a generous open-front view into the hall.
    const panelCount = main ? 6 : 4;
    const panelW = (w - 3.4) / panelCount;
    for (let panel = 0; panel < panelCount; panel++) {
      const panelX = x - (w - 3.4) / 2 + (panel + 0.5) * panelW;
      const panelH = Math.min(4.5, wallHeight - 2.0);
      const panelY = floor + 2.5;
      box(panelW - 0.22, panelH + 0.24, 0.14, M.woodDark, panelX, panelY, back + 0.38);
      box(panelW - 0.4, panelH, 0.045, M.cream, panelX, panelY, back + 0.48);
      for (let i = 0; i < 11; i++)
        box(
          0.06,
          panelH,
          0.1,
          M.woodLight,
          panelX + (-0.5 + i / 10) * (panelW - 0.5),
          panelY,
          back + 0.55,
        );
      for (let i = 0; i < 9; i++)
        box(
          panelW - 0.4,
          0.06,
          0.11,
          M.woodLight,
          panelX,
          panelY - panelH / 2 + (i / 8) * panelH,
          back + 0.56,
        );
    }
    for (const side of [-1, 1]) {
      const shutterX = x + side * (w / 2 - 1.25);
      box(1.9, 4.2, 0.14, M.woodDark, shutterX, floor + 2.3, front - 0.1);
      box(1.66, 3.95, 0.04, M.cream, shutterX, floor + 2.3, front);
      for (let i = 0; i < 7; i++)
        box(0.065, 3.95, 0.1, M.woodLight, shutterX - 0.72 + i * 0.24, floor + 2.3, front + 0.07);
      for (let i = 0; i < 9; i++)
        box(1.66, 0.065, 0.11, M.woodLight, shutterX, floor + 0.47 + i * 0.46, front + 0.08);
    }
    box(w + 0.9, 0.4 * s, d + 0.9, M.woodDark, x, eave - 0.12, z);
    fascia(w + 0.9, eave - 0.46, front + 0.25, s, x);
    fascia(w + 0.9, eave - 0.46, back - 0.25, s, x);
    const rafterCount = Math.ceil(w / 0.48);
    for (let i = 0; i <= rafterCount; i++) {
      const xx = x - w / 2 + (i / rafterCount) * w;
      for (const side of [-1, 1]) {
        const rafter = box(
          0.14,
          0.17,
          4.4,
          i % 5 ? M.woodDark : M.jade,
          xx,
          eave - 0.04,
          z + side * (d / 2 + 1.05),
        );
        rafter.rotation.x = -side * 0.14;
      }
    }
    add(roofSurface(roofW, roofD, rise, s), M.roofDark, x, eave, z);
    add(roofTiles(roofW, roofD, rise, s), M.roof, x, eave + 0.035, z);
    for (const side of [-1, 1]) {
      const points = [];
      for (let i = 0; i <= 44; i++) {
        const xx = -roofW / 2 + (i / 44) * roofW;
        const zz = (side * roofD) / 2;
        points.push([x + xx, eave + roofHeight(xx, zz, roofW, roofD, rise, s), z + zz]);
      }
      tube(points, 0.14 * s, M.roofEdge, 44, 8);
    }
    const ridge = cylinder(
      0.24 * s,
      0.24 * s,
      roofW + 0.3,
      M.roofDark,
      x,
      eave + rise + 0.13,
      z,
      16,
    );
    ridge.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      tube(
        [
          [x + side * (roofW / 2 - 1.6), eave + rise + 0.1, z],
          [x + side * (roofW / 2 + 0.15), eave + rise + 0.46 * s, z],
          [x + side * (roofW / 2 + 0.4), eave + rise + 1.08 * s, z],
        ],
        0.18 * s,
        M.roofEdge,
        18,
        9,
      );
    }
    const plaqueW = main ? 7.5 : 5.9;
    const plaqueH = main ? 1.9 : 1.5;
    box(plaqueW + 0.28, plaqueH + 0.25, 0.32, M.woodDark, x, eave - 1.43, front + 0.62);
    add(
      new THREE.PlaneGeometry(plaqueW, plaqueH),
      plaqueMaterial(hall.name, index),
      x,
      eave - 1.43,
      front + 0.79,
    ).castShadow = false;
    signs.push({ hall, position: new THREE.Vector3(x, eave - 1.43, front + 0.86) });
    for (const dx of main ? [-13.7, -7.8, 7.8, 13.7] : [-9.2, 9.2])
      paperLantern(x + dx, eave - 2.15, front + 1.0, main ? 1.15 : 0.95);

    // The altar fills the far end of the nave, with a large lotus dais and
    // graduated offering tables. Gold is concentrated here rather than on every surface.
    const altarZ = back + (main ? 4.0 : 3.15);
    const buddhaScale = main ? 1.45 : 1.1;
    box(main ? 10.8 : 8.2, 0.3, main ? 5.1 : 4.1, M.stoneLight, x, floor + 0.26, altarZ);
    lotusBuddha(x, floor + 0.42, altarZ - 0.5, buddhaScale);
    const tableZ = altarZ + (main ? 2.1 : 1.75);
    const tableW = main ? 8.8 : 6.7;
    box(tableW, 0.22, 1.3, M.woodDark, x, floor + 1.02, tableZ);
    box(tableW + 0.15, 0.08, 1.43, M.woodLight, x, floor + 1.17, tableZ);
    for (const dx of [-tableW / 2 + 0.5, tableW / 2 - 0.5]) {
      box(0.3, 1.05, 0.75, M.wood, x + dx, floor + 0.59, tableZ);
      box(0.8, 0.1, 0.95, M.woodDark, x + dx, floor + 0.15, tableZ);
    }
    for (const dx of [-3.1, 3.1]) {
      const candleX = x + dx * (main ? 1 : 0.72);
      cylinder(0.16, 0.24, 0.5, M.gold, candleX, floor + 1.46, tableZ);
      cylinder(0.09, 0.09, 0.48, M.cream, candleX, floor + 1.94, tableZ);
      sphere(0.045, M.flame || M.goldLight, candleX, floor + 2.2, tableZ, [0.7, 1.7, 0.7]);
    }
    for (const dx of [-1.6, 1.6]) {
      cylinder(0.37, 0.24, 0.12, M.goldLight, x + dx, floor + 1.27, tableZ, 20);
      for (let fruit = 0; fruit < 4; fruit++)
        sphere(
          0.12,
          M.gold,
          x + dx + Math.sin(fruit * 2.4) * 0.17,
          floor + 1.42 + fruit * 0.018,
          tableZ + Math.cos(fruit * 2.4) * 0.14,
        );
    }
    // A dignified aisle remains open between the symmetrical cushion groups.
    const runnerLength = d - (main ? 6.4 : 5.4);
    box(2.65, 0.018, runnerLength, runnerCloth, x, floor + 0.213, front - 1.4 - runnerLength / 2);
    for (const side of [-1, 1])
      box(
        0.035,
        0.019,
        runnerLength,
        cushionBorder,
        x + side * 1.26,
        floor + 0.221,
        front - 1.4 - runnerLength / 2,
      );
    SEATS.filter((seat) => seat.hallId === hall.id).forEach(meditationSeat);
    incenseVessel(x - layout.stairsWidth / 2 - 1.25, 0, front + 3.15, main ? 1.4 : 1.05);

    // Only broad hidden camera volumes are raycast; the intricate roof and seats
    // remain merged render geometry and add no per-frame camera ray cost.
    collider(w, wallHeight, 0.5, x, floor + wallHeight / 2, back);
    for (const side of [-1, 1])
      collider(0.5, wallHeight, d, x + (side * w) / 2, floor + wallHeight / 2, z);
    collider(roofW, 0.55, roofD, x, eave + 0.25, z);
  });

  // The shared queue uses one approachable courtyard censer. Keep its bowl
  // low enough for the smaller monks to offer incense without a tall pedestal.
  for (const station of INCENSE_STATIONS) {
    const { x, z } = station;
    const y = station.y || 0;
    cylinder(0.67, 0.76, 0.12, M.stoneLight, x, y + 0.06, z, 24);
    cylinder(0.4, 0.52, 0.12, M.stoneDark, x, y + 0.18, z, 20);
    for (const dx of [-0.26, 0.26]) cylinder(0.065, 0.09, 0.3, M.gold, x + dx, y + 0.36, z, 12);
    cylinder(0.49, 0.33, 0.27, M.gold, x, y + 0.59, z, 28);
    cylinder(0.51, 0.51, 0.065, M.goldLight, x, y + 0.755, z, 28);
    cylinder(0.425, 0.425, 0.032, M.stoneLight, x, y + 0.797, z, 24);
    for (let i = 0; i < 5; i++) {
      const xx = x + (i - 2) * 0.09;
      const zz = z + (i % 2 ? -0.08 : 0.05);
      const tip = y + 1.19 + (i % 3) * 0.045;
      cylinder(0.009, 0.011, tip - (y + 0.8), M.woodDark, xx, (tip + y + 0.8) / 2, zz, 6);
      sphere(0.014, M.flame || M.goldLight, xx, tip, zz, [1, 0.7, 1]);
    }
    for (const side of [-1, 1]) {
      const handle = add(
        new THREE.TorusGeometry(0.105, 0.028, 6, 16),
        M.goldLight,
        x + side * 0.55,
        y + 0.66,
        z,
      );
      handle.rotation.y = Math.PI / 2;
    }
    // A single pair of quiet inlaid stones marks where the waiting line begins.
    const entrance = station.entrance;
    for (const side of [-1, 1])
      box(0.12, 0.025, 0.55, M.stoneLight, entrance.x + side * 0.5, 0.028, entrance.z);
  }

  return {
    colliders,
    signs,
    surfaces,
    /** Optional render-only elevation; authoritative multiplayer positions remain X/Z. */
    heightAt(x, z) {
      for (const surface of surfaces) {
        const dx = Math.abs(x - surface.x);
        const dz = Math.abs(z - surface.z);
        // Use the complete stone platform, including the apron beyond the timber walls.
        if (dx <= surface.platformWidth / 2 && dz <= surface.platformDepth / 2)
          return surface.walkHeight;
        const stairsStart = surface.front + surface.platformMargin;
        const stairsEnd = stairsStart + surface.stairsCount * surface.stairsDepth;
        if (dx <= surface.stairsWidth / 2 && z >= stairsStart - 1e-6 && z <= stairsEnd + 1e-6) {
          const step = Math.min(
            surface.stairsCount - 1,
            Math.max(0, Math.floor((z - stairsStart) / surface.stairsDepth)),
          );
          return ((surface.stairsCount - step) / surface.stairsCount) * surface.walkHeight;
        }
      }
      return 0;
    },
    dispose() {
      disposed = true;
      colliders.forEach((mesh) => mesh.geometry.dispose());
      collisionMaterial.dispose();
      ownedTextures.forEach((texture) => texture.dispose());
      ownedMaterials.forEach((material) => material.dispose());
    },
  };
}
