import { Raycaster, Vector3 } from 'three';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const DEFAULT_DISTANCE = 2.9;
const DEFAULT_PITCH = 0.08;
const PIVOT_HEIGHT = 0.88;
const SHOULDER_OFFSET = 0.28;
const LOOK_AHEAD = 1.8;
const DRAG_THRESHOLD = 4;

/** A ground-level, over-the-shoulder camera; gameplay positions stay server-owned. */
export function createThirdPersonCamera({ camera, canvas, onViewChange } = {}) {
  if (!camera || !canvas) throw new Error('A camera and canvas are required.');
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const pivot = new Vector3(0, PIVOT_HEIGHT, 20);
  const player = new Vector3(0, 0, 20);
  const desiredCamera = new Vector3();
  const lookTarget = new Vector3();
  const cameraDirection = new Vector3();
  const ray = new Raycaster();
  let yaw = 0;
  let pitch = DEFAULT_PITCH;
  let distance = DEFAULT_DISTANCE;
  let targetDistance = DEFAULT_DISTANCE;
  let actualDistance = DEFAULT_DISTANCE;
  let collisionMeshes = [];
  let initialized = false;
  let disposed = false;
  let drag = null;
  let suppressClick = false;
  let suppressUntil = 0;

  const locked = () => doc.pointerLockElement === canvas;
  const blocked = () =>
    !!doc.querySelector('[role="dialog"][aria-modal="true"]') ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(doc.activeElement?.tagName) ||
    doc.activeElement?.isContentEditable;

  function rotate(dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    yaw += dx * 0.004;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    pitch = clamp(pitch + dy * 0.003, -0.12, 0.65);
  }

  function releaseDrag() {
    const previous = drag;
    drag = null;
    if (previous && canvas.hasPointerCapture?.(previous.id)) {
      try {
        canvas.releasePointerCapture(previous.id);
      } catch {
        /* Already released. */
      }
    }
  }

  function pointerDown(event) {
    if (disposed || blocked() || locked()) return;
    if (event.isPrimary === false) return;
    if (event.button !== 0 && event.button !== 2 && event.pointerType !== 'touch') return;
    releaseDrag();
    suppressClick = false;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      touch: event.pointerType === 'touch',
      moved: false,
    };
    if (event.button === 2) event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Optional in embedded views. */
    }
    canvas.focus({ preventScroll: true });
  }

  function pointerMove(event) {
    if (locked() || !drag || drag.id !== event.pointerId) return;
    if (blocked()) return releaseDrag();
    const total = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (total > DRAG_THRESHOLD) drag.moved = true;
    if (drag.moved) {
      rotate(event.clientX - drag.x, event.clientY - drag.y);
      suppressClick = true;
      suppressUntil = performance.now() + 450;
      event.preventDefault();
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function pointerUp(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved) {
      suppressClick = true;
      suppressUntil = performance.now() + 450;
    }
    releaseDrag();
  }

  function mouseMove(event) {
    if (!locked()) return;
    if (blocked()) {
      doc.exitPointerLock?.();
      return;
    }
    rotate(event.movementX || 0, event.movementY || 0);
  }

  function lockChange() {
    releaseDrag();
    suppressClick = false;
    onViewChange?.({ locked: locked() });
  }

  async function requestLook() {
    if (disposed || blocked() || !canvas.requestPointerLock) return false;
    if (locked()) return true;
    try {
      await canvas.requestPointerLock();
      return locked();
    } catch {
      // Dragging the background works even when an embedded view denies lock.
      onViewChange?.({ locked: false });
      return false;
    }
  }

  function contextMenu(event) {
    event.preventDefault();
  }
  function blur() {
    releaseDrag();
    if (locked()) doc.exitPointerLock?.();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('lostpointercapture', pointerUp);
  canvas.addEventListener('contextmenu', contextMenu);
  doc.addEventListener('mousemove', mouseMove);
  doc.addEventListener('pointerlockchange', lockChange);
  win.addEventListener('blur', blur);

  function update(position, delta = 0) {
    if (disposed) return;
    player.set(position.x, position.y || 0, position.z);
    const dt = Math.min(Math.max(delta, 0), 0.3);
    if (!initialized) {
      pivot.copy(player);
      pivot.y += PIVOT_HEIGHT;
      initialized = true;
    } else {
      const smoothing = 1 - Math.exp(-12 * dt);
      pivot.x += (player.x - pivot.x) * smoothing;
      pivot.z += (player.z - pivot.z) * smoothing;
      pivot.y += (player.y + PIVOT_HEIGHT - pivot.y) * smoothing;
    }
    distance += (targetDistance - distance) * (1 - Math.exp(-10 * dt));
    const sin = Math.sin(yaw),
      cos = Math.cos(yaw);
    const horizontal = Math.cos(pitch) * distance;
    desiredCamera.set(
      pivot.x - sin * horizontal + cos * SHOULDER_OFFSET,
      Math.max(0.45, pivot.y + Math.sin(pitch) * distance),
      pivot.z + cos * horizontal + sin * SHOULDER_OFFSET,
    );
    cameraDirection.subVectors(desiredCamera, pivot);
    const desiredLength = cameraDirection.length();
    cameraDirection.normalize();
    if (collisionMeshes.length) {
      ray.set(pivot, cameraDirection);
      ray.near = 0.12;
      ray.far = desiredLength;
      const hit = ray.intersectObjects(collisionMeshes, true)[0];
      if (hit)
        desiredCamera
          .copy(pivot)
          .addScaledVector(cameraDirection, Math.max(0.35, hit.distance - 0.18));
    }
    desiredCamera.y = Math.max(0.45, desiredCamera.y);
    actualDistance = desiredCamera.distanceTo(pivot);
    camera.position.copy(desiredCamera);
    lookTarget.set(pivot.x + sin * LOOK_AHEAD, pivot.y, pivot.z - cos * LOOK_AHEAD);
    camera.up.set(0, 1, 0);
    camera.lookAt(lookTarget);
    camera.updateMatrixWorld();
  }

  return {
    update,
    reset(position, { resetHeading = true } = {}) {
      if (resetHeading) {
        yaw = 0;
        pitch = DEFAULT_PITCH;
      }
      distance = targetDistance = DEFAULT_DISTANCE;
      initialized = false;
      releaseDrag();
      suppressClick = false;
      if (position) update(position, 0);
    },
    zoom(delta) {
      if (Number.isFinite(delta)) targetDistance = clamp(targetDistance - delta * 0.35, 1.8, 5.5);
    },
    rotate,
    movement(strafe, forward) {
      return {
        x: Math.sin(yaw) * forward + Math.cos(yaw) * strafe,
        z: -Math.cos(yaw) * forward + Math.sin(yaw) * strafe,
      };
    },
    getHeading: () => yaw,
    getDistance: () => actualDistance,
    requestLook,
    isDragging: () => !!drag,
    consumeClick() {
      const consumed = locked() || (suppressClick && performance.now() <= suppressUntil);
      suppressClick = false;
      return consumed;
    },
    setCollisionMeshes(meshes) {
      collisionMeshes = meshes || [];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      blur();
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerUp);
      canvas.removeEventListener('lostpointercapture', pointerUp);
      canvas.removeEventListener('contextmenu', contextMenu);
      doc.removeEventListener('mousemove', mouseMove);
      doc.removeEventListener('pointerlockchange', lockChange);
      win.removeEventListener('blur', blur);
      collisionMeshes = [];
    },
  };
}
