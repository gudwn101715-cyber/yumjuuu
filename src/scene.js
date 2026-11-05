import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HALLS, NODES, WORLD, BASE_MOVE_SPEED } from '../shared/game.js';
import { HALL_LAYOUTS, SEATS } from '../shared/templeLayout.js';
import { createThirdPersonCamera } from './thirdPersonCamera.js';
import { createWorldMaterials } from './world/materials.js';
import { buildNaturalEnvironment } from './world/environment.js';
import { buildTempleArchitecture } from './world/templeArchitecture.js';
import { createPilgrimAvatar } from './world/avatar.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (a, b, t) => a + (b - a) * t;
const tempV = new THREE.Vector3();
const seatsById = new Map(SEATS.map((seat) => [seat.id, seat]));
const SEATED_LIFT = 0.225 - 0.025 - 0.0225;

/** Human-height third-person renderer; gameplay state remains server authoritative. */
export function createScene(
  container,
  { onMove, onInteract, onInspect, onReady, quality = 'auto' } = {},
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b4c0b8');
  scene.fog = new THREE.FogExp2('#b4c0b8', 0.0038);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  const gl = renderer.getContext();
  const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const softwareGPU =
    rendererInfo &&
    /swiftshader|llvmpipe|softpipe/i.test(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL));
  let qualityMode = ['auto', 'high', 'balanced', 'low'].includes(quality) ? quality : 'auto';
  let effectiveQuality = qualityMode === 'auto' ? (softwareGPU ? 'low' : 'balanced') : qualityMode;
  renderer.setPixelRatio(
    effectiveQuality === 'low' ? 0.7 : Math.min(window.devicePixelRatio || 1, 1.5),
  );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.domElement.style.cssText =
    'display:block;width:100%;height:100%;outline:none;touch-action:none;';
  renderer.domElement.setAttribute(
    'aria-label',
    '산사 3인칭 시점. WASD로 이동, Shift로 빠르게 걷기, 마우스 오른쪽 드래그로 둘러보기, E키로 상호작용하세요.',
  );
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);
  const labels = document.createElement('div');
  labels.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2;';
  container.appendChild(labels);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 650);
  const view = createThirdPersonCamera({ camera, canvas: renderer.domElement });
  let viewportWidth = 1,
    viewportHeight = 1,
    disposed = false;

  const sky = new Sky();
  sky.scale.setScalar(10000);
  const skyUniforms = sky.material.uniforms;
  skyUniforms.turbidity.value = 5.5;
  skyUniforms.rayleigh.value = 1.8;
  skyUniforms.mieCoefficient.value = 0.004;
  skyUniforms.mieDirectionalG.value = 0.82;
  skyUniforms.sunPosition.value.set(-0.58, 0.48, 0.52).normalize();
  scene.add(sky);
  const ambient = new THREE.HemisphereLight('#d8e3e8', '#444b35', 0.85);
  scene.add(ambient);
  const sunOffset = new THREE.Vector3(-28, 34, 18);
  const sunlight = new THREE.DirectionalLight('#ffe4b5', 3.8);
  sunlight.position.copy(sunOffset);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = -36;
  sunlight.shadow.camera.right = 36;
  sunlight.shadow.camera.top = 36;
  sunlight.shadow.camera.bottom = -36;
  sunlight.shadow.camera.near = 1;
  sunlight.shadow.camera.far = 115;
  sunlight.shadow.normalBias = 0.035;
  sunlight.shadow.bias = -0.00012;
  sunlight.shadow.radius = 2;
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sunlight.target = sunTarget;
  scene.add(sunlight);
  // A retained radiance map gives aged metal and stone believable ambient light.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const radiance = pmrem.fromScene(room, 0.06);
  scene.environment = radiance.texture;
  scene.environmentIntensity = 0.22;
  room.dispose();
  pmrem.dispose();

  const surfaces = createWorldMaterials(THREE);
  const M = surfaces.materials;
  const staticRoot = new THREE.Group();
  scene.add(staticRoot);
  const environment = buildNaturalEnvironment({
    THREE,
    root: staticRoot,
    materials: M,
    world: WORLD,
  });
  const architecture = buildTempleArchitecture({
    THREE,
    root: staticRoot,
    halls: HALLS,
    materials: M,
  });
  for (const [index, hall] of HALLS.entries()) {
    const layout = HALL_LAYOUTS[hall.id];
    const main = index === 0;
    const altarLight = new THREE.PointLight('#ffd99d', main ? 22 : 16, main ? 18 : 14, 2);
    altarLight.position.set(
      layout.x,
      layout.floor + 4.2,
      layout.z - layout.depth / 2 + (main ? 5.8 : 4.8),
    );
    scene.add(altarLight);
  }
  const pickTargets = [];
  const makeLabel = (text, style = '') => {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText =
      'position:absolute;left:0;top:0;white-space:nowrap;font-family:inherit;transform:translate(-50%,-50%);will-change:transform;' +
      style;
    labels.appendChild(el);
    return el;
  };
  for (const hall of HALLS) {
    const layout = HALL_LAYOUTS[hall.id];
    const pick = new THREE.Mesh(
      new THREE.BoxGeometry(layout.width + 3, layout.eave + layout.rise, layout.depth + 3),
      new THREE.MeshBasicMaterial(),
    );
    pick.position.set(layout.x, (layout.eave + layout.rise) / 2, layout.z);
    pick.layers.set(1);
    pick.userData = { kind: 'hall', id: hall.id };
    scene.add(pick);
    pickTargets.push(pick);
  }
  for (const seat of SEATS) {
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.3, 1.05),
      new THREE.MeshBasicMaterial(),
    );
    cushion.position.set(seat.x, seat.y + 0.13, seat.z);
    cushion.layers.set(1);
    cushion.userData = { kind: 'seat', id: seat.id };
    scene.add(cushion);
    pickTargets.push(cushion);
    const instrument = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 10, 8),
      new THREE.MeshBasicMaterial(),
    );
    instrument.position.set(seat.moktak.x, seat.moktak.y, seat.moktak.z);
    instrument.layers.set(1);
    instrument.userData = { kind: 'moktak', id: seat.id };
    scene.add(instrument);
    pickTargets.push(instrument);
  }
  const localMallet = new THREE.Group();
  const malletWood = new THREE.MeshStandardMaterial({ color: '#ba8a51', roughness: 0.72 });
  const malletHandle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.016, 0.37, 10),
    malletWood,
  );
  malletHandle.position.y = -0.14;
  localMallet.add(malletHandle);
  const malletHead = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), malletWood);
  malletHead.position.y = -0.33;
  localMallet.add(malletHead);
  localMallet.visible = false;
  scene.add(localMallet);
  let malletStrikeAt = -Infinity;

  // Batch by material while retaining UVs and surface relief. Spatial cells keep
  // forest culling useful instead of making the entire forest one giant mesh.
  staticRoot.updateMatrixWorld(true);
  const batches = new Map();
  const sourceGeometries = new Set();
  staticRoot.traverse((object) => {
    if (!object.isMesh) return;
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const cell =
      box.max.x - box.min.x > 50 || box.max.z - box.min.z > 50
        ? 'land'
        : `${Math.floor(center.x / 38)}:${Math.floor(center.z / 38)}`;
    const key = `${object.material.uuid}:${object.castShadow}:${cell}`;
    if (!batches.has(key))
      batches.set(key, {
        material: object.material,
        castShadow: object.castShadow,
        geometries: [],
      });
    const geometry = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    if (!geometry.attributes.uv)
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          new Float32Array(geometry.attributes.position.count * 2),
          2,
        ),
      );
    for (const name of Object.keys(geometry.attributes))
      if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
    batches.get(key).geometries.push(geometry);
    sourceGeometries.add(object.geometry);
  });
  sourceGeometries.forEach((geometry) => geometry.dispose());
  staticRoot.clear();
  for (const { material, castShadow, geometries } of batches.values()) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!geometry) throw new Error('Cannot batch world geometry');
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.originalCastShadow = castShadow;
    mesh.castShadow = castShadow && (!material.alphaTest || effectiveQuality === 'high');
    mesh.receiveShadow = true;
    staticRoot.add(mesh);
  }
  let shadowAt = 0;
  let slowFrames = 0;
  function applyQuality(mode, automaticLevel) {
    qualityMode = ['auto', 'high', 'balanced', 'low'].includes(mode) ? mode : 'auto';
    const level =
      qualityMode === 'auto' ? automaticLevel || (softwareGPU ? 'low' : 'balanced') : qualityMode;
    effectiveQuality = level;
    const softwareFallback = softwareGPU && qualityMode === 'auto' && level === 'low';
    renderer.setPixelRatio(
      level === 'high'
        ? Math.min(window.devicePixelRatio || 1, 1.5)
        : level === 'low'
          ? softwareFallback
            ? 0.55
            : 0.7
          : Math.min(window.devicePixelRatio || 1, 1.15),
    );
    // A software rasterizer has no dedicated graphics hardware. Retain local
    // contact shading while skipping the expensive full-world shadow pass.
    renderer.shadowMap.enabled = !softwareFallback;
    const shadowSize = level === 'high' ? 2048 : level === 'low' ? 512 : 1024;
    sunlight.shadow.mapSize.set(shadowSize, shadowSize);
    if (sunlight.shadow.map && sunlight.shadow.map.width !== shadowSize) {
      sunlight.shadow.map.dispose();
      sunlight.shadow.map = null;
    }
    const touched = new Set();
    staticRoot.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow =
        object.userData.originalCastShadow && (!object.material.alphaTest || level === 'high');
      const material = object.material;
      if (touched.has(material)) return;
      touched.add(material);
      if (!Object.hasOwn(material.userData, 'detailBump'))
        material.userData.detailBump = material.bumpMap || null;
      const desired = level === 'low' ? null : material.userData.detailBump;
      if (material.bumpMap !== desired) {
        material.bumpMap = desired;
        material.needsUpdate = true;
      }
    });
    renderer.shadowMap.needsUpdate = true;
  }

  const contactCanvas = document.createElement('canvas');
  contactCanvas.width = contactCanvas.height = 64;
  const contactContext = contactCanvas.getContext('2d');
  const contactGradient = contactContext.createRadialGradient(32, 32, 5, 32, 32, 32);
  contactGradient.addColorStop(0, 'rgba(16, 23, 15, .72)');
  contactGradient.addColorStop(0.4, 'rgba(16, 23, 15, .38)');
  contactGradient.addColorStop(1, 'rgba(16, 23, 15, 0)');
  contactContext.fillStyle = contactGradient;
  contactContext.fillRect(0, 0, 64, 64);
  const contactTexture = new THREE.CanvasTexture(contactCanvas);
  const buildingContact = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.48,
    depthWrite: false,
  });
  for (const [index, hall] of HALLS.entries()) {
    const layout = HALL_LAYOUTS[hall.id];
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(layout.width + 6, layout.depth + 5),
      buildingContact,
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.set(layout.x, 0.023, layout.z);
    scene.add(contact);
  }

  const nodeVisuals = new Map();
  const orbGeometry = new THREE.SphereGeometry(0.16, 18, 12);
  const orbMaterial = new THREE.MeshStandardMaterial({
    color: '#b19463',
    emissive: '#c3a264',
    emissiveIntensity: 0.08,
    roughness: 0.42,
    metalness: 0.15,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: '#f7e9bd',
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  NODES.forEach((node, i) => {
    const group = new THREE.Group();
    group.position.set(node.x, 0, node.z);
    scene.add(group);
    const orb = new THREE.Mesh(orbGeometry, orbMaterial);
    orb.position.y = 0.45;
    orb.castShadow = true;
    group.add(orb);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.012, 5, 32), ringMaterial.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    group.add(ring);
    const spark = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.035),
      new THREE.MeshBasicMaterial({ color: '#fff5ce' }),
    );
    spark.position.set(0.2, 0.6, 0);
    group.add(spark);
    const label = makeLabel(
      '✧ ' + (node.name || '염주 재료'),
      'padding:4px 8px;background:#faf8ecdf;border:1px solid #ffffff8c;border-radius:12px;font-size:10px;color:#756746;box-shadow:0 2px 4px #405d3610;',
    );
    const pick = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 10, 8),
      new THREE.MeshBasicMaterial({ opacity: 0, transparent: true, depthWrite: false }),
    );
    pick.position.set(node.x, 0.65, node.z);
    pick.layers.set(1);
    pick.userData = { kind: 'node', id: node.id };
    scene.add(pick);
    pickTargets.push(pick);
    nodeVisuals.set(node.id, {
      group,
      orb,
      ring,
      spark,
      label,
      node,
      phase: i * 0.8,
      available: true,
      readyAt: 0,
    });
  });
  const petalCount = 65,
    petalPositions = new Float32Array(petalCount * 3);
  for (let i = 0; i < petalCount; i++) {
    petalPositions[i * 3] = Math.sin(i * 5.3) * 57;
    petalPositions[i * 3 + 1] = ((i * 1.61) % 24) + 2;
    petalPositions[i * 3 + 2] = Math.cos(i * 1.8) * 55;
  }
  const petalGeometry = new THREE.BufferGeometry();
  petalGeometry.setAttribute('position', new THREE.BufferAttribute(petalPositions, 3));
  const petals = new THREE.Points(
    petalGeometry,
    new THREE.PointsMaterial({
      color: '#ffe3cc',
      size: 0.018,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  );
  scene.add(petals);

  const avatars = new Map();
  const avatarLODGeometries = new Map();
  const avatarLODMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  function remoteSilhouette(rig, seed, gender) {
    const key = `${gender}:${Math.abs(seed) % 5}`;
    if (!avatarLODGeometries.has(key)) {
      const pieces = [];
      rig.group.updateMatrixWorld(true);
      rig.group.traverse((object) => {
        if (!object.isMesh) return;
        const geometry = object.geometry.index
          ? object.geometry.toNonIndexed()
          : object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);
        geometry.deleteAttribute('uv');
        const color = object.material.color || new THREE.Color('#7d8272');
        const colors = new Float32Array(geometry.attributes.position.count * 3);
        for (let i = 0; i < colors.length; i += 3) {
          colors[i] = color.r;
          colors[i + 1] = color.g;
          colors[i + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        pieces.push(geometry);
      });
      const merged = mergeGeometries(pieces);
      pieces.forEach((geometry) => geometry.dispose());
      avatarLODGeometries.set(key, merged);
    }
    return new THREE.Mesh(avatarLODGeometries.get(key), avatarLODMaterial);
  }
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: contactTexture,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const shadowGeometry = new THREE.CircleGeometry(0.48, 24);
  const selfMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.37, 32),
    new THREE.MeshBasicMaterial({
      color: '#f8efd5',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    }),
  );
  selfMarker.rotation.x = -Math.PI / 2;
  selfMarker.position.y = 0.025;
  scene.add(selfMarker);
  const destinationMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.65, 0.78, 24),
    new THREE.MeshBasicMaterial({
      color: '#fff9dd',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  destinationMarker.rotation.x = -Math.PI / 2;
  destinationMarker.position.y = 0.15;
  destinationMarker.visible = false;
  scene.add(destinationMarker);
  let snapshot = null,
    localPosition = new THREE.Vector3(0, 0, 20),
    serverOffset = 0;
  let destination = null,
    pendingInteraction = null,
    lastMoveAt = 0,
    lastInteractionAt = 0;
  let pendingSeatStrike = null;
  let pendingSeatStrikeUntil = 0;
  let walkingNow = false;
  let lastFrame = performance.now(),
    elapsed = 0,
    frame = 0;
  let renderedFrames = 0;
  let touchOrigin = null,
    pointerStart = null,
    dragDistance = 0;
  const keys = new Set(),
    raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  raycaster.layers.enable(1);
  const moveInput = { strafe: 0, forward: 0 };
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
  let currentTheme = 'bamboo';
  let themeInitialized = false;

  const addAvatar = (player, isSelf) => {
    const seed = [...player.id].reduce((n, c) => n + c.charCodeAt(0), 0);
    const gender = player.gender === 'female' ? 'female' : 'male';
    const rig = createPilgrimAvatar({ THREE, isSelf, seed, gender });
    const lod = isSelf ? null : remoteSilhouette(rig, seed, gender);
    const group = new THREE.Group(),
      pivot = new THREE.Group();
    group.add(pivot);
    const pick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 1.65, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    pick.position.y = 0.825;
    pick.layers.set(1);
    pick.userData = { kind: 'player', id: player.id };
    group.add(pick);
    pickTargets.push(pick);
    pivot.add(rig.group);
    if (lod) {
      pivot.add(lod);
      lod.visible = false;
    }
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.018;
    group.add(shadow);
    group.position.set(player.x, architecture.heightAt(player.x, player.z) + 0.025, player.z);
    group.rotation.y = Math.PI;
    scene.add(group);
    const label = makeLabel(
      '',
      'font-size:10px;font-weight:600;color:#3e5944;text-shadow:0 1px 3px #fff9e8,0 -1px 3px #fff9e8,1px 0 3px #fff9e8;',
    );
    const item = {
      group,
      pivot,
      rig,
      lod,
      gender,
      label,
      player,
      isSelf,
      seed,
      target: new THREE.Vector3(
        player.x,
        architecture.heightAt(player.x, player.z) + 0.025,
        player.z,
      ),
      angle: Math.PI,
      lastX: player.x,
      lastZ: player.z,
    };
    avatars.set(player.id, item);
    return item;
  };
  const emitMove = (x, z) => {
    const now = performance.now();
    if (now - lastMoveAt < 94) return;
    lastMoveAt = now;
    onMove?.(clamp(x, WORLD.minX, WORLD.maxX), clamp(z, WORLD.minZ, WORLD.maxZ));
  };
  const interact = (action) => {
    if (performance.now() - lastInteractionAt < 500) return;
    lastInteractionAt = performance.now();
    onInteract?.(action);
  };
  const strikeMoktak = () => {
    const self = snapshot?.self;
    const seat = seatsById.get(self?.seatId);
    if (
      !seat ||
      self.bowingUntil > Date.now() + serverOffset ||
      performance.now() - malletStrikeAt < 130
    )
      return false;
    malletStrikeAt = performance.now();
    localMallet.position.set(seat.moktak.x + 0.14, seat.moktak.y + 0.53, seat.moktak.z);
    onInteract?.({ type: 'moktak', seatId: seat.id });
    return true;
  };
  const approach = (kind, id) => {
    if (!snapshot?.self) return;
    const isSeat = kind === 'seat' || kind === 'moktak';
    const obj = isSeat
      ? seatsById.get(id)
      : kind === 'hall'
        ? HALLS.find((h) => h.id === id)
        : NODES.find((n) => n.id === id);
    if (!obj) return;
    if (kind === 'moktak' && snapshot.self.seatId === id) {
      strikeMoktak();
      return;
    }
    const x = obj.x,
      z = isSeat ? obj.z : kind === 'hall' ? obj.z + 8 : obj.z + 2;
    destination = { x, z };
    pendingInteraction = isSeat
      ? { type: 'sit', seatId: id }
      : kind === 'hall'
        ? { type: 'bow', hallId: id }
        : { type: 'gather', nodeId: id };
    pendingSeatStrike = kind === 'moktak' ? id : null;
    pendingSeatStrikeUntil = Date.now() + 20000;
    destinationMarker.position.set(x, 0.15, z);
    destinationMarker.visible = true;
  };
  const nearestInteraction = () => {
    if (!snapshot?.self) return;
    const p = snapshot.self;
    if (!p.seatId) {
      const nearby = SEATS.filter((seat) => Math.hypot(seat.x - p.x, seat.z - p.z) <= 1.8).sort(
        (a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
      )[0];
      if (nearby) {
        interact({ type: 'sit', seatId: nearby.id });
        return;
      }
    }
    const h = HALLS.find((hall) => Math.hypot(hall.x - p.x, hall.z - p.z) <= hall.radius);
    if (h) {
      interact({ type: 'bow', hallId: h.id });
      return;
    }
    const n = NODES.filter((node) => Math.hypot(node.x - p.x, node.z - p.z) <= 6.5).sort(
      (a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
    )[0];
    if (n) interact({ type: 'gather', nodeId: n.id });
  };
  const isTyping = () =>
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) ||
    document.activeElement?.isContentEditable ||
    !!document.querySelector('[role="dialog"][aria-modal="true"]');
  const keyDown = (event) => {
    if (event.key === 'Escape' && document.pointerLockElement === renderer.domElement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.exitPointerLock();
      keys.clear();
      return;
    }
    if (isTyping()) return;
    const key = event.key.toLowerCase();
    if (
      [
        'w',
        'a',
        's',
        'd',
        'arrowup',
        'arrowdown',
        'arrowleft',
        'arrowright',
        'e',
        'f',
        ' ',
      ].includes(key)
    )
      event.preventDefault();
    if (key === 'e' && !event.repeat) nearestInteraction();
    if (key === 'f' && !event.repeat) {
      onInteract?.({ type: 'prime-audio' });
      strikeMoktak();
    }
    if (key === ' ' && !event.repeat) {
      const h =
        snapshot?.self &&
        HALLS.find(
          (hall) => Math.hypot(hall.x - snapshot.self.x, hall.z - snapshot.self.z) <= hall.radius,
        );
      if (h) interact({ type: 'bow', hallId: h.id });
    }
    keys.add(key);
  };
  const keyUp = (event) => keys.delete(event.key.toLowerCase());
  const clearKeys = () => {
    keys.clear();
    moveInput.strafe = moveInput.forward = 0;
    touchOrigin = null;
  };
  const lookModeChanged = () => {
    clearKeys();
    if (document.pointerLockElement === renderer.domElement) {
      destination = null;
      pendingInteraction = null;
      destinationMarker.visible = false;
    }
  };
  const groundPoint = (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(groundPlane, tempV)?.clone();
  };
  const pointerDown = (event) => {
    if (event.button !== 0) return;
    onInteract?.({ type: 'prime-audio' });
    pointerStart = { x: event.clientX, y: event.clientY };
    dragDistance = 0;
    if (event.pointerType === 'touch') touchOrigin = { x: event.clientX, y: event.clientY };
  };
  const pointerMove = (event) => {
    if (!pointerStart) return;
    dragDistance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
  };
  const pointerUp = (event) => {
    const orbitHandled = view.consumeClick();
    if (!pointerStart || event.button !== 0) return;
    pointerStart = null;
    touchOrigin = null;
    if (orbitHandled || dragDistance > 12 || !snapshot?.self) return;
    const point = groundPoint(event);
    const hits = raycaster.intersectObjects(pickTargets, false);
    if (hits.length) {
      const selected =
        hits.find(
          (hit) => hit.object.userData.kind === 'moktak' || hit.object.userData.kind === 'seat',
        ) || hits[0];
      const { kind, id } = selected.object.userData;
      if (kind === 'player') {
        const player = avatars.get(id)?.player;
        if (player && id !== snapshot.self.id) onInspect?.(player);
        return;
      }
      approach(kind, id);
      return;
    }
    if (!point) return;
    destination = {
      x: clamp(point.x, WORLD.minX + 1, WORLD.maxX - 1),
      z: clamp(point.z, WORLD.minZ + 1, WORLD.maxZ - 1),
    };
    pendingInteraction = null;
    pendingSeatStrike = null;
    destinationMarker.position.set(destination.x, 0.15, destination.z);
    destinationMarker.visible = true;
    renderer.domElement.focus({ preventScroll: true });
  };
  const wheel = (event) => {
    event.preventDefault();
    view.zoom(-event.deltaY * 0.01);
  };
  document.addEventListener('keydown', keyDown);
  document.addEventListener('keyup', keyUp);
  window.addEventListener('blur', clearKeys);
  document.addEventListener('pointerlockchange', lookModeChanged);
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  const resize = () => {
    viewportWidth = Math.max(1, container.clientWidth);
    viewportHeight = Math.max(1, container.clientHeight);
    renderer.setSize(viewportWidth, viewportHeight);
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const projectLabel = (el, position, offset = 0) => {
    const v = position.clone().project(camera);
    const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    el.style.display = visible ? '' : 'none';
    if (visible)
      el.style.transform = `translate(-50%,-50%) translate(${(v.x * 0.5 + 0.5) * viewportWidth}px,${(-v.y * 0.5 + 0.5) * viewportHeight + offset}px)`;
  };
  const themeColors = {
    bamboo: ['#d4e4e0', '#9bad7d', '#87b9ac'],
    lotus: ['#e7ddd7', '#b5bf8b', '#a1c9c2'],
    pine: ['#d5e1dc', '#9fb384', '#8dbbb1'],
    moon: ['#8999ac', '#8d9e95', '#96b5c0'],
    dawn: ['#ecd0b1', '#b4b184', '#a5c5b2'],
    snow: ['#e6edef', '#d9ded1', '#b0ced0'],
    autumn: ['#f0e4cf', '#c2b17b', '#a7bfb0'],
    mist: ['#dce7df', '#a8b8a0', '#a3c9c1'],
    mountain: ['#dfe7d7', '#9db083', '#91bbb0'],
    sacred: ['#eee6d2', '#b4bb8b', '#acc9b5'],
  };

  function tickMovement(stepDelta) {
    if (!snapshot?.self || disposed) return;
    {
      const self = snapshot.self,
        speed =
          (destination || keys.has('shift') ? BASE_MOVE_SPEED : 2.8) *
          (1 + (self.stats?.moveSpeed || 0) / 100);
      const serverNow = Date.now() + serverOffset,
        bowing = self.bowingUntil > serverNow;
      let dx = 0,
        dz = 0;
      if (!isTyping()) {
        const strafe =
          Number(keys.has('d') || keys.has('arrowright')) -
          Number(keys.has('a') || keys.has('arrowleft')) +
          moveInput.strafe;
        const forward =
          Number(keys.has('w') || keys.has('arrowup')) -
          Number(keys.has('s') || keys.has('arrowdown')) +
          moveInput.forward;
        ({ x: dx, z: dz } = view.movement(strafe, forward));
      }
      if (dx || dz) {
        destination = null;
        pendingInteraction = null;
        destinationMarker.visible = false;
        pendingSeatStrike = null;
      }
      if (destination && !bowing) {
        const dist = Math.hypot(destination.x - localPosition.x, destination.z - localPosition.z);
        if (dist < 1.1) {
          destination = null;
          destinationMarker.visible = false;
          if (pendingInteraction) {
            const interaction = pendingInteraction;
            pendingInteraction = null;
            // Wait for the server to acknowledge the final position before checking reach.
            setTimeout(() => {
              if (!disposed) interact(interaction);
            }, 180);
          }
        } else {
          dx = (destination.x - localPosition.x) / dist;
          dz = (destination.z - localPosition.z) / dist;
        }
      }
      walkingNow = Boolean((dx || dz) && !bowing);
      if (walkingNow) {
        const length = Math.hypot(dx, dz);
        dx /= length;
        dz /= length;
        localPosition.x = clamp(localPosition.x + dx * speed * stepDelta, WORLD.minX, WORLD.maxX);
        localPosition.z = clamp(localPosition.z + dz * speed * stepDelta, WORLD.minZ, WORLD.maxZ);
        emitMove(localPosition.x, localPosition.z);
      } else if (!destination) {
        // Reconcile gently after packet loss, a rejected move, or a channel change.
        localPosition.x = ease(localPosition.x, self.x, Math.min(1, stepDelta * 7));
        localPosition.z = ease(localPosition.z, self.z, Math.min(1, stepDelta * 7));
      }
      localPosition.y =
        architecture.heightAt(localPosition.x, localPosition.z) +
        0.025 +
        (self.seatId && !walkingNow ? SEATED_LIFT : 0);
    }
  }
  let movementAt = performance.now();
  const movementTimer = setInterval(() => {
    const now = performance.now();
    const stepDelta = Math.min(0.15, Math.max(0, (now - movementAt) / 1000));
    movementAt = now;
    tickMovement(stepDelta);
  }, 50);

  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (document.hidden || (!document.hasFocus() && renderedFrames >= 3)) {
      lastFrame = performance.now();
      return;
    }
    const now = performance.now(),
      frameDelta = Math.max(0, (now - lastFrame) / 1000);
    const delta = Math.min(frameDelta, 0.1);
    lastFrame = now;
    elapsed += frameDelta;
    if (qualityMode === 'auto' && effectiveQuality !== 'low') {
      slowFrames = frameDelta > 0.18 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames >= 3) applyQuality('auto', 'low');
    }
    if (snapshot?.self) {
      const serverNow = Date.now() + serverOffset;
      selfMarker.position.y = localPosition.y + 0.015;
      selfMarker.position.x = localPosition.x;
      selfMarker.position.z = localPosition.z;
      view.update(localPosition, Math.min(frameDelta, 0.3));
      const detailedPeers = new Set(
        [...avatars.values()]
          .filter((avatar) => !avatar.isSelf)
          .sort(
            (a, b) =>
              a.target.distanceToSquared(localPosition) - b.target.distanceToSquared(localPosition),
          )
          .slice(0, 8)
          .map((avatar) => avatar.player.id),
      );
      for (const avatar of avatars.values()) {
        avatar.pivot.visible = !avatar.isSelf || view.getDistance() > 0.85;
        const player = avatar.player,
          pos = avatar.group.position;
        const desired = avatar.isSelf ? localPosition : avatar.target;
        const prevX = pos.x,
          prevZ = pos.z;
        pos.x = ease(pos.x, desired.x, Math.min(1, delta * (avatar.isSelf ? 18 : 11)));
        pos.z = ease(pos.z, desired.z, Math.min(1, delta * (avatar.isSelf ? 18 : 11)));
        const distanceMoved = Math.hypot(pos.x - prevX, pos.z - prevZ);
        const moving = distanceMoved > 0.0025;
        const seated = Boolean(player.seatId && (!avatar.isSelf || !walkingNow));
        pos.y = architecture.heightAt(pos.x, pos.z) + 0.025 + (seated ? SEATED_LIFT : 0);
        if (moving) avatar.angle = Math.atan2(pos.x - prevX, pos.z - prevZ);
        let diff = avatar.angle - avatar.group.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        avatar.group.rotation.y += diff * Math.min(1, delta * 12);
        const isBowing = player.bowingUntil > serverNow;
        if (isBowing || seated) avatar.angle = Math.PI;
        const detailed =
          avatar.isSelf ||
          (detailedPeers.has(player.id) && pos.distanceToSquared(localPosition) < 24 * 24);
        avatar.rig.group.visible = detailed;
        if (avatar.lod) avatar.lod.visible = !detailed;
        if (detailed)
          avatar.rig.animate({
            time: elapsed,
            delta,
            moving,
            speed: distanceMoved / Math.max(delta, 0.001),
            bowing: isBowing,
            sitting: seated,
          });
        const nextLabel = `${avatar.isSelf ? '나 · ' : ''}${player.name || '수행자'}${isBowing ? ' 🙏' : ''}`;
        if (avatar.label.textContent !== nextLabel) avatar.label.textContent = nextLabel;
        // The local character is already identified by the HUD. Keep the forward
        // sightline clear rather than placing a name over the altar.
        if (avatar.isSelf) avatar.label.style.display = 'none';
        else
          projectLabel(
            avatar.label,
            pos.clone().add(new THREE.Vector3(0, seated ? 1.45 : 1.85, 0)),
          );
      }
    }
    if (!snapshot?.self) view.update(localPosition, delta);
    const serverNow = Date.now() + serverOffset;
    for (const visual of nodeVisuals.values()) {
      visual.orb.position.y = 0.42 + Math.sin(elapsed * 1.6 + visual.phase) * 0.045;
      visual.orb.rotation.y += delta * 0.5;
      visual.spark.rotation.y += delta;
      visual.spark.position.y = 0.65 + Math.sin(elapsed * 1.7 + visual.phase) * 0.08;
      const available = visual.readyAt <= serverNow;
      visual.orb.visible = available;
      visual.spark.visible = available;
      visual.ring.material.opacity = available ? 0.6 : 0.18;
      const distance = Math.hypot(visual.node.x - localPosition.x, visual.node.z - localPosition.z);
      if (distance < 10 && available) {
        projectLabel(visual.label, new THREE.Vector3(visual.node.x, 1.15, visual.node.z));
      } else visual.label.style.display = 'none';
    }
    for (let i = 0; i < petalCount; i++) {
      petalPositions[i * 3] += delta * (0.3 + Math.sin(elapsed + i) * 0.15);
      petalPositions[i * 3 + 1] -= delta * (0.3 + (i % 3) * 0.08);
      if (petalPositions[i * 3 + 1] < 0.3) petalPositions[i * 3 + 1] = 18 + (i % 5);
    }
    petalGeometry.attributes.position.needsUpdate = true;
    environment.update({ time: elapsed, delta });
    const strikePhase = (performance.now() - malletStrikeAt) / 260;
    localMallet.visible = strikePhase >= 0 && strikePhase < 1;
    if (localMallet.visible) localMallet.rotation.x = -0.6 + Math.sin(strikePhase * Math.PI) * 0.9;
    sunTarget.position.set(localPosition.x, 0, localPosition.z);
    sunlight.position.copy(sunTarget.position).add(sunOffset);
    if (
      elapsed - shadowAt >
      (effectiveQuality === 'high' ? 0.05 : effectiveQuality === 'low' ? 0.18 : 0.1)
    ) {
      renderer.shadowMap.needsUpdate = true;
      shadowAt = elapsed;
    }
    renderer.render(scene, camera);
    renderedFrames++;
  };
  applyQuality(qualityMode);
  view.setCollisionMeshes(architecture.colliders);
  view.reset(localPosition);
  animate();
  onReady?.();
  return {
    setQuality(mode) {
      applyQuality(mode);
    },
    strikeMoktak,
    focusSeat(id) {
      approach('seat', id);
    },
    setState(state) {
      if (!state?.self) return;
      const previousId = snapshot?.self?.id,
        previousChannel = snapshot?.channel?.id,
        previousSeat = snapshot?.self?.seatId;
      snapshot = state;
      serverOffset = (state.serverTime || Date.now()) - Date.now();
      if (
        !previousId ||
        previousId !== state.self.id ||
        previousChannel !== state.channel?.id ||
        Math.hypot(localPosition.x - state.self.x, localPosition.z - state.self.z) > 20
      ) {
        localPosition.set(
          state.self.x,
          architecture.heightAt(state.self.x, state.self.z) + 0.025,
          state.self.z,
        );
        destination = null;
        pendingInteraction = null;
        pendingSeatStrike = null;
        destinationMarker.visible = false;
        view.reset(localPosition);
      }
      if (state.self.seatId && state.self.seatId !== previousSeat) {
        const seat = seatsById.get(state.self.seatId);
        if (seat) {
          localPosition.set(seat.x, seat.y + 0.025 + SEATED_LIFT, seat.z);
          walkingNow = false;
          destination = null;
          pendingInteraction = null;
          destinationMarker.visible = false;
        }
      }
      const players = [state.self, ...(state.players || []).filter((p) => p.id !== state.self.id)],
        current = new Set(players.map((p) => p.id));
      const incomingGender = new Map(
        players.map((player) => [player.id, player.gender === 'female' ? 'female' : 'male']),
      );
      for (const [id, avatar] of avatars)
        if (!current.has(id) || incomingGender.get(id) !== avatar.gender) {
          const picks = avatar.group.children.filter((child) => child.userData?.kind === 'player');
          for (const pick of picks) {
            const index = pickTargets.indexOf(pick);
            if (index >= 0) pickTargets.splice(index, 1);
            pick.geometry.dispose();
            pick.material.dispose();
          }
          avatar.rig.dispose();
          scene.remove(avatar.group);
          avatar.label.remove();
          avatars.delete(id);
        }
      for (const player of players) {
        const avatar = avatars.get(player.id) || addAvatar(player, player.id === state.self.id);
        avatar.player = player;
        avatar.target.set(player.x, architecture.heightAt(player.x, player.z) + 0.025, player.z);
      }
      for (const node of state.nodes || []) {
        const visual = nodeVisuals.get(node.id);
        if (visual) visual.readyAt = node.readyAt || 0;
      }
      const theme =
        typeof state.channel?.theme === 'object' ? state.channel.theme.id : state.channel?.theme;
      if (theme && theme !== currentTheme) this.setTheme(theme);
      if (pendingSeatStrike && Date.now() > pendingSeatStrikeUntil) pendingSeatStrike = null;
      if (pendingSeatStrike && state.self.seatId === pendingSeatStrike) {
        pendingSeatStrike = null;
        strikeMoktak();
      }
    },
    setTheme(theme) {
      const id = typeof theme === 'object' ? theme.id : theme;
      if (themeInitialized && currentTheme === id) return;
      themeInitialized = true;
      currentTheme = id || 'bamboo';
      const colors = themeColors[currentTheme] || themeColors.bamboo;
      const night = currentTheme === 'moon';
      const haze = night
        ? '#263846'
        : currentTheme === 'dawn'
          ? '#bca58b'
          : currentTheme === 'snow'
            ? '#c5ced0'
            : '#aebbb2';
      scene.background.set(night ? '#182937' : colors[0]);
      scene.fog.color.set(haze);
      sky.visible = !night;
      sunlight.intensity = night ? 0.5 : 3.8;
      ambient.intensity = night ? 0.65 : 0.85;
      renderer.toneMappingExposure = night ? 1.1 : 0.94;
      sunlight.color.set(night ? '#e6ebff' : currentTheme === 'dawn' ? '#ffd5a0' : '#ffe4b5');
    },
    setMoveInput(strafe, forward) {
      moveInput.strafe = clamp(Number(strafe) || 0, -1, 1);
      moveInput.forward = clamp(Number(forward) || 0, -1, 1);
    },
    focusHall(id) {
      approach('hall', id);
    },
    focusNode(id) {
      approach('node', id);
    },
    focusPlayer() {
      view.reset(localPosition);
    },
    setZoom(delta) {
      view.zoom(delta);
    },
    requestLook() {
      return view.requestLook();
    },
    dispose() {
      disposed = true;
      view.dispose();
      cancelAnimationFrame(frame);
      clearInterval(movementTimer);
      observer.disconnect();
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('pointerlockchange', lookModeChanged);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('wheel', wheel);
      for (const avatar of avatars.values()) avatar.rig.dispose();
      avatars.clear();
      environment.dispose();
      architecture.dispose();
      surfaces.dispose();
      radiance.dispose();
      contactTexture.dispose();
      avatarLODGeometries.forEach((geometry) => geometry.dispose());
      avatarLODMaterial.dispose();
      const geometries = new Set(),
        materialSet = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material)
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) =>
            materialSet.add(m),
          );
      });
      geometries.forEach((g) => g.dispose());
      materialSet.forEach((m) => m.dispose());

      renderer.dispose();
      renderer.domElement.remove();
      labels.remove();
    },
  };
}
