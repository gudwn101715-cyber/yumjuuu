/** Locally generated, repeatable surface maps. No remote assets or credentials. */
export function createWorldMaterials(THREE) {
  const textures = [];
  const materialList = [];
  const cache = new Map();
  const hasCanvas = typeof document !== 'undefined';
  const fract = (n) => n - Math.floor(n);
  const smooth = (n) => n * n * (3 - 2 * n);
  const hash = (x, y, seed) => {
    let n = Math.imul(x + seed * 131, 374761393) ^ Math.imul(y + seed * 17, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const field = (frequency, seed) => {
    const grid = Float32Array.from({ length: frequency * frequency }, (_, i) =>
      hash(i % frequency, Math.floor(i / frequency), seed),
    );
    return (u, v) => {
      const x = fract(u) * frequency;
      const y = fract(v) * frequency;
      const ix = Math.floor(x),
        iy = Math.floor(y);
      const fx = smooth(x - ix),
        fy = smooth(y - iy);
      const a = grid[iy * frequency + ix];
      const b = grid[iy * frequency + ((ix + 1) % frequency)];
      const c = grid[((iy + 1) % frequency) * frequency + ix];
      const d = grid[((iy + 1) % frequency) * frequency + ((ix + 1) % frequency)];
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    };
  };

  function family(kind, size = 256, repeat = [2, 2]) {
    if (!hasCanvas) return {};
    if (cache.has(kind)) return cache.get(kind);
    const albedo = document.createElement('canvas');
    const relief = document.createElement('canvas');
    albedo.width = relief.width = size;
    albedo.height = relief.height = size;
    const ac = albedo.getContext('2d');
    const hc = relief.getContext('2d');
    const colorData = ac.createImageData(size, size);
    const heightData = hc.createImageData(size, size);
    const low = field(4, 13),
      mid = field(13, 31),
      fine = field(43, 71);
    const flow = field(8, 107);
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const a = low(u, v),
          b = mid(u, v),
          c = fine(u, v);
        const grain = hash(x, y, 211) - 0.5;
        let light = 0.88 + (a - 0.5) * 0.08 + (b - 0.5) * 0.05 + grain * 0.025;
        let height = 0.5 + (b - 0.5) * 0.18 + (c - 0.5) * 0.16;
        if (kind === 'timber' || kind === 'bark') {
          const waves = Math.sin(
            (u * 43 + flow(u, v * 0.22) * 1.6 + Math.sin(v * Math.PI * 2) * 0.18) * Math.PI * 2,
          );
          const pores = Math.pow(Math.max(0, waves), 7);
          const knotu = Math.min(Math.abs(u - 0.37), 1 - Math.abs(u - 0.37));
          const knotv = Math.min(Math.abs(v - 0.64), 1 - Math.abs(v - 0.64));
          const knotRadius = Math.hypot(knotu * 8, knotv * 2.5);
          const knot = Math.sin(knotRadius * 33) * Math.exp(-knotRadius * 4);
          light += waves * 0.032 - pores * 0.045 + knot * 0.065;
          height += waves * 0.09 - pores * 0.12 + knot * 0.08;
          if (kind === 'bark') {
            const split = Math.pow(
              Math.max(0, Math.sin((u * 17 + flow(u, v * 0.35) * 1.5) * Math.PI * 2)),
              12,
            );
            light -= split * 0.18;
            height -= split * 0.28;
          }
        } else if (kind === 'granite' || kind === 'masonry' || kind === 'pavers') {
          light += (c - 0.5) * 0.085 + grain * 0.045;
          height += (c - 0.5) * 0.24 + grain * 0.08;
          if (kind !== 'granite') {
            const rows = kind === 'pavers' ? 3 : 4;
            const row = Math.floor(v * rows);
            const xx = fract(u * 2 + (row % 2) * 0.5);
            const yy = fract(v * rows);
            const edge = Math.min(xx, 1 - xx, yy, 1 - yy);
            const joint = Math.max(0, 1 - edge / 0.015);
            light -= joint * 0.14;
            height -= joint * 0.28;
            light += (hash(Math.floor(u * 2 + (row % 2) * 0.5), row, 13) - 0.5) * 0.055;
          }
        } else if (kind === 'soil') {
          light += (a - 0.5) * 0.14 + (b - 0.5) * 0.1 + (c - 0.5) * 0.07;
          height += (c - 0.5) * 0.32 + grain * 0.18;
          const pebble = hash(Math.floor(x / 3), Math.floor(y / 3), 89);
          if (pebble > 0.97) {
            light += 0.035;
            height += 0.1;
          }
        } else if (kind === 'tile') {
          const wave = Math.cos(u * Math.PI * 16 + (b - 0.5) * 0.12);
          light += wave * 0.018 + (c - 0.5) * 0.045;
          height += wave * 0.065 + (c - 0.5) * 0.11;
        } else if (kind === 'plaster') {
          light += (a - 0.5) * 0.045 + (c - 0.5) * 0.055;
          height += (c - 0.5) * 0.21 + grain * 0.07;
        } else if (kind === 'ripples') {
          const ripple = Math.sin((u * 6 + v * 3 + a * 0.27) * Math.PI * 2);
          light = 0.94;
          height = 0.5 + ripple * 0.08 + (b - 0.5) * 0.07;
        }
        const i = (y * size + x) * 4;
        const brightness = Math.max(0, Math.min(255, Math.round(light * 255)));
        const bump = Math.max(0, Math.min(255, Math.round(height * 255)));
        colorData.data[i] = brightness;
        colorData.data[i + 1] = brightness;
        colorData.data[i + 2] = brightness;
        colorData.data[i + 3] = 255;
        heightData.data[i] = heightData.data[i + 1] = heightData.data[i + 2] = bump;
        heightData.data[i + 3] = 255;
      }
    }
    ac.putImageData(colorData, 0, 0);
    hc.putImageData(heightData, 0, 0);
    const map = new THREE.CanvasTexture(albedo);
    const bumpMap = new THREE.CanvasTexture(relief);
    map.colorSpace = THREE.SRGBColorSpace;
    // Height data stays linear. Color conversion here would distort the relief.
    bumpMap.colorSpace = THREE.NoColorSpace;
    for (const texture of [map, bumpMap]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(...repeat);
      texture.anisotropy = 4;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      textures.push(texture);
    }
    const result = { map, bumpMap };
    cache.set(kind, result);
    return result;
  }

  const timber = family('timber', 512, [2, 2]);
  const bark = family('bark', 256, [2, 3]);
  const granite = family('granite', 512, [2, 2]);
  const masonry = family('masonry', 512, [2, 2]);
  const pavers = family('pavers', 512, [2, 2]);
  const plaster = family('plaster', 256, [2, 2]);
  const soil = family('soil', 512, [4, 4]);
  const tile = family('tile', 256, [2, 2]);
  const ripples = family('ripples', 256, [4, 4]);
  const surface = (color, maps = {}, options = {}) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.91,
      metalness: 0,
      flatShading: false,
      ...maps,
      bumpScale: 0.025,
      ...options,
    });
    materialList.push(material);
    return material;
  };
  const materials = {
    grass: surface('#87a661', soil, { bumpScale: 0.016 }),
    grassLight: surface('#a2b77b', soil, { bumpScale: 0.014 }),
    grassDark: surface('#5c7946', soil, { bumpScale: 0.016 }),
    dirt: surface('#c5b38d', soil, { bumpScale: 0.018, roughness: 0.98 }),
    path: surface('#ccc7b1', pavers, { bumpScale: 0.018, roughness: 0.96 }),
    stone: surface('#afb29f', masonry, { bumpScale: 0.024 }),
    stoneLight: surface('#d1cdb8', granite, { bumpScale: 0.018 }),
    stoneDark: surface('#89927e', granite, { bumpScale: 0.024 }),
    wood: surface('#9b6b50', timber, { bumpScale: 0.012 }),
    woodLight: surface('#b88d5f', timber, { bumpScale: 0.012 }),
    woodDark: surface('#684b37', timber, { bumpScale: 0.015 }),
    roof: surface('#526158', tile, { bumpScale: 0.012 }),
    roofEdge: surface('#768274', tile, { bumpScale: 0.01 }),
    roofDark: surface('#303c36', tile, { bumpScale: 0.016, side: THREE.DoubleSide }),
    jade: surface('#47685b', timber, { bumpScale: 0.012 }),
    cream: surface('#e3d8bc', plaster, { bumpScale: 0.016 }),
    gold: surface('#ba9d61', {}, { metalness: 0.62, roughness: 0.42 }),
    goldLight: surface('#d0b67d', {}, { metalness: 0.52, roughness: 0.36 }),
    leaves: surface('#729454', {}, { roughness: 0.97 }),
    leavesLight: surface('#95ad6d', {}, { roughness: 0.98 }),
    pine: surface('#4d7957', {}, { roughness: 0.97 }),
    trunk: surface('#6e5842', bark, { bumpScale: 0.045 }),
    pink: surface('#d5aaa1', {}, { roughness: 0.95 }),
    pinkLight: surface('#f0ccc1', {}, { roughness: 0.95 }),
    pinkDark: surface('#ad807c', {}, { roughness: 0.95 }),
    water: surface('#579d91', ripples, { metalness: 0.12, roughness: 0.3, bumpScale: 0.02 }),
    waterLight: surface('#87b8a6', ripples, { metalness: 0.08, roughness: 0.34, bumpScale: 0.016 }),
    bamboo: surface('#8aab66', timber, { roughness: 0.88, bumpScale: 0.008 }),
    bambooDark: surface('#688848', timber, { roughness: 0.91, bumpScale: 0.008 }),
    flame: surface(
      '#e6bd79',
      {},
      { emissive: '#db9e4e', emissiveIntensity: 0.45, roughness: 0.65 },
    ),
  };

  return {
    materials,
    textures,
    dispose() {
      for (const material of materialList) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
