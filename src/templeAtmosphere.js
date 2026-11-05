/**
 * Small details of a lived-in Korean mountain temple. Every mesh is static and
 * uses shared materials so the scene's existing material batching can merge it.
 */
export function addTempleAtmosphere(THREE, root) {
  const material = (color, options = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true, ...options });
  const M = {
    granite: material('#8a8e80'),
    stoneLight: material('#b3b49f'),
    tile: material('#424e48'),
    timber: material('#73513d'),
    moss: material('#617b4c'),
    fern: material('#79945e', { side: THREE.DoubleSide }),
    paper: material('#efcfa0', { emissive: '#c78d4d', emissiveIntensity: 0.11 }),
    brass: material('#9f824c', { metalness: 0.28, roughness: 0.65 }),
  };

  const mesh = (geometry, mat, x = 0, y = 0, z = 0) => {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.castShadow = true;
    object.receiveShadow = true;
    root.add(object);
    return object;
  };
  const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cylinder = (top, bottom, height, mat, x, y, z, sides = 8) =>
    mesh(new THREE.CylinderGeometry(top, bottom, height, sides), mat, x, y, z);
  const stone = (x, z, scale, rotation = 0) => {
    const rock = mesh(new THREE.IcosahedronGeometry(1, 1), M.granite, x, 0.33 * scale, z);
    rock.scale.set(1.3 * scale, 0.55 * scale, 0.8 * scale);
    rock.rotation.y = rotation;
    const moss = mesh(
      new THREE.IcosahedronGeometry(1, 0),
      M.moss,
      x - 0.1 * scale,
      0.76 * scale,
      z,
    );
    moss.scale.set(1.07 * scale, 0.08 * scale, 0.65 * scale);
    moss.rotation.y = rotation;
  };

  function fern(x, z, scale = 1, turn = 0) {
    // Five broad segmented fronds: enough silhouette at close distance, no alpha textures.
    for (let j = 0; j < 5; j++) {
      const angle = turn + (j / 5) * Math.PI * 2;
      const points = [
        new THREE.Vector3(x, 0.11, z),
        new THREE.Vector3(
          x + Math.cos(angle) * 0.35 * scale,
          0.75 * scale,
          z + Math.sin(angle) * 0.35 * scale,
        ),
        new THREE.Vector3(
          x + Math.cos(angle) * 1.05 * scale,
          0.5 * scale,
          z + Math.sin(angle) * 1.05 * scale,
        ),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      mesh(new THREE.TubeGeometry(curve, 4, 0.035 * scale, 3, false), M.moss);
      for (let k = 1; k <= 3; k++) {
        const p = curve.getPoint(k / 4);
        for (const sign of [-1, 1]) {
          const width = (0.32 - k * 0.055) * scale;
          const side = angle + sign * 0.85;
          const positions = new Float32Array([
            p.x,
            p.y,
            p.z,
            p.x + Math.cos(side) * width,
            p.y + 0.06 * scale,
            p.z + Math.sin(side) * width,
            p.x + Math.cos(angle) * 0.21 * scale,
            p.y + 0.08 * scale,
            p.z + Math.sin(angle) * 0.21 * scale,
          ]);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          geometry.computeVertexNormals();
          mesh(geometry, M.fern);
        }
      }
    }
  }

  // The low tiled walls frame the courtyard without hiding a walking character.
  // The open ends align with the trails to the groves and do not close the map.
  for (const side of [-1, 1]) {
    const x = side * 18;
    box(1.6, 0.22, 14, M.stoneLight, x, 0.11, 21);
    box(0.95, 1.25, 13.6, M.granite, x, 0.83, 21);
    // Individual irregular stone faces, grouped into two muted granite tones.
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 7; i++) {
        const z = 15.15 + i * 1.83 + (row % 2) * 0.34;
        if (z > 27.2) continue;
        box(1.02, 0.33, 1.63, (i + row) % 3 ? M.granite : M.stoneLight, x, 0.42 + row * 0.37, z);
      }
    }
    box(1.55, 0.15, 14.1, M.tile, x, 1.52, 21);
    for (let i = 0; i < 19; i++) {
      const tile = cylinder(0.105, 0.105, 1.65, M.tile, x, 1.69, 14.4 + i * 0.73, 6);
      tile.rotation.z = Math.PI / 2;
    }
    for (const z of [14, 28]) {
      box(1.4, 1.72, 1.4, M.stoneLight, x, 0.86, z);
      const cap = mesh(new THREE.ConeGeometry(1.25, 0.45, 4), M.tile, x, 1.94, z);
      cap.rotation.y = Math.PI / 4;
      cylinder(0.09, 0.16, 0.24, M.tile, x, 2.26, z, 6);
    }
    // A strip of moss at the base is deliberately narrow enough to keep paths clear.
    const mossBed = mesh(new THREE.IcosahedronGeometry(1, 1), M.moss, x + side * 0.7, 0.13, 21);
    mossBed.scale.set(0.6, 0.11, 7.3);
  }

  // A few thoughtful plantings replace a bare lawn with shade and forest-floor texture.
  for (const [x, z, size] of [
    [-14, 9, 0.8],
    [14, 10, 0.9],
    [-13, 23, 0.6],
    [12, 28, 0.65],
    [-21, 3, 1.05],
    [21, 0, 1.0],
    [-9, -8, 0.65],
    [10, -7, 0.65],
    [-30, -13, 0.9],
    [30, -15, 0.85],
  ]) {
    stone(x, z, size, x * 0.17);
    fern(x + 1.1 * size, z + 0.3, size * 0.65, z * 0.1);
  }

  // Incense vessel at the side of the stairs, never in the common bow approach.
  const burnerX = -7.7,
    burnerZ = -7.2;
  box(2.25, 0.26, 2.05, M.stoneLight, burnerX, 0.13, burnerZ);
  cylinder(0.65, 0.8, 0.34, M.granite, burnerX, 0.43, burnerZ);
  cylinder(0.37, 0.5, 1.05, M.granite, burnerX, 1.02, burnerZ);
  cylinder(0.95, 0.63, 0.48, M.brass, burnerX, 1.75, burnerZ, 12);
  cylinder(0.96, 0.96, 0.12, M.brass, burnerX, 2.03, burnerZ, 12);
  cylinder(0.79, 0.79, 0.04, M.stoneLight, burnerX, 2.1, burnerZ, 12);
  for (const [dx, dz, tilt] of [
    [-0.22, 0, -0.09],
    [0.08, -0.16, 0.04],
    [0.26, 0.17, 0.11],
  ]) {
    const incense = cylinder(0.025, 0.025, 0.75, M.timber, burnerX + dx, 2.47, burnerZ + dz, 5);
    incense.rotation.z = tilt;
  }

  // A restrained row of paper lanterns across the outer courtyard. The string is
  // high overhead; no large bright blocks cover the player or the Buddha.
  for (const side of [-1, 1]) {
    cylinder(0.13, 0.19, 6.2, M.timber, side * 13, 3.1, 2, 7);
    cylinder(0.32, 0.4, 0.28, M.stoneLight, side * 13, 0.14, 2, 8);
  }
  const ropePoints = [];
  for (let i = 0; i <= 16; i++) {
    const x = -13 + (i / 16) * 26;
    ropePoints.push(new THREE.Vector3(x, 5.4 + (x / 13) ** 2 * 0.8, 2));
  }
  mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePoints), 24, 0.028, 3, false),
    M.timber,
  );
  for (const x of [-10, -6, -2, 2, 6, 10]) {
    const y = 5.4 + (x / 13) ** 2 * 0.8;
    cylinder(0.018, 0.018, 0.36, M.timber, x, y - 0.18, 2, 4);
    const paper = mesh(new THREE.SphereGeometry(0.43, 10, 8), M.paper, x, y - 0.75, 2);
    paper.scale.set(1, 1.22, 1);
    cylinder(0.2, 0.2, 0.08, M.timber, x, y - 0.27, 2, 8);
    cylinder(0.18, 0.18, 0.08, M.timber, x, y - 1.24, 2, 8);
    cylinder(0.015, 0.015, 0.3, M.brass, x, y - 1.43, 2, 4);
  }

  // Small bronze punggyeong under the hall eave. The suspended fish is a quiet
  // traditional detail rather than a glowing fantasy object.
  const bellX = 11.5,
    bellZ = -12.2;
  cylinder(0.02, 0.02, 0.8, M.brass, bellX, 7.1, bellZ, 5);
  const bell = cylinder(0.21, 0.37, 0.58, M.brass, bellX, 6.5, bellZ, 10);
  bell.rotation.z = 0.07;
  cylinder(0.39, 0.39, 0.08, M.brass, bellX, 6.2, bellZ, 10);
  cylinder(0.018, 0.018, 0.6, M.timber, bellX, 5.89, bellZ, 4);
  const fish = mesh(new THREE.SphereGeometry(0.2, 7, 5), M.brass, bellX, 5.52, bellZ);
  fish.scale.set(1.7, 0.52, 0.16);
  const tail = mesh(new THREE.ConeGeometry(0.13, 0.22, 3), M.brass, bellX + 0.34, 5.52, bellZ);
  tail.rotation.z = Math.PI / 2;
  tail.scale.z = 0.15;
}
