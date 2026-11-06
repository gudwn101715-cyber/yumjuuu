import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { writeFile } from 'node:fs/promises';

async function openGame(page, { observeAudio = false } = {}) {
  // Observe real network messages without sending actions or changing game state.
  await page.addInitScript((observeAudio) => {
    if (observeAudio) {
      window.__moktakAudioObservations = {
        sampleStarts: 0,
        lastSampleAt: 0,
        sampleDurations: [],
        oscillators: 0,
        sentTypes: [],
        receivedTypes: [],
      };
      const contextPrototype = (window.AudioContext || window.webkitAudioContext)?.prototype;
      if (contextPrototype) {
        const createOscillator = contextPrototype.createOscillator;
        contextPrototype.createOscillator = function (...args) {
          window.__moktakAudioObservations.oscillators++;
          return createOscillator.apply(this, args);
        };
      }
      const sourcePrototype = window.AudioBufferSourceNode?.prototype;
      if (sourcePrototype) {
        const start = sourcePrototype.start;
        sourcePrototype.start = function (...args) {
          const result = start.apply(this, args);
          if (this.buffer?.duration > 0.05) {
            window.__moktakAudioObservations.sampleStarts++;
            window.__moktakAudioObservations.lastSampleAt = performance.now();
            window.__moktakAudioObservations.sampleDurations.push(this.buffer.duration);
          }
          return result;
        };
      }
      const send = window.WebSocket.prototype.send;
      window.WebSocket.prototype.send = function (data) {
        try {
          window.__moktakAudioObservations.sentTypes.push(JSON.parse(data).type);
        } catch {
          /* Ignore non-JSON messages. */
        }
        return send.call(this, data);
      };
    }
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => {
          try {
            const packet = JSON.parse(event.data);
            if (packet.type === 'state') window.__gameState = packet;
            if (observeAudio) window.__moktakAudioObservations.receivedTypes.push(packet.type);
          } catch {
            /* Ignore non-JSON messages. */
          }
        });
      }
    };
  }, observeAudio);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.__gameState?.self))).toBe(true);
  await expect(page.locator('.connecting-overlay')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('.world-canvas canvas')).toBeVisible();
  await expect(page.locator('.scene-error')).toHaveCount(0);
  if (observeAudio) {
    // Capture an actually rendered ritual frame, without changing pose or game state.
    await page.evaluate(() => {
      window.__bowFrame = { score: Infinity, data: null, progress: null };
      const capture = () => {
        const self = window.__gameState?.self;
        if (self?.bowDuration && self.bowingUntil > Date.now()) {
          const progress = (Date.now() - self.bowStartedAt) / self.bowDuration;
          const score = Math.abs(progress - 0.62);
          if (progress > 0.25 && progress < 0.88 && score < window.__bowFrame.score) {
            window.__bowFrame = {
              score,
              progress,
              data: document.querySelector('.world-canvas canvas').toDataURL('image/png'),
            };
          }
        }
        requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
  }
}

async function state(page) {
  return page.evaluate(() => window.__gameState);
}

async function sitAtHall(page) {
  const before = await state(page);
  await page.getByRole('button', { name: '절하기', exact: true }).click();
  await expect.poll(async () => (await state(page)).self.seatId, { timeout: 18000 }).toBeTruthy();
  await expect
    .poll(async () => (await state(page)).self.bows, { timeout: 22000 })
    .toBe(before.self.bows + 1);
  await expect(page.getByRole('button', { name: '목탁 두드리기', exact: true })).toBeEnabled();
  const captured = await page.evaluate(() => window.__bowFrame);
  if (captured?.data) {
    const file = `/tmp/yeomju-v2-full-prostration-${page.viewportSize().width}.png`;
    await writeFile(file, Buffer.from(captured.data.split(',')[1], 'base64'));
    console.log(`Captured actual bow frame at progress ${captured.progress.toFixed(2)}: ${file}`);
  }
}

async function openMenu(page) {
  await page.getByRole('button', { name: '게임 메뉴 열기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '게임 메뉴', exact: true })).toBeVisible();
}

test('opens only the full game and saves a genderless profile and graphics preference', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  await expect(page.locator('.game-screen')).toBeVisible();
  await expect(
    page.locator('.site-header, .page-header, .hud-minimap, .look-prompt, .world-heading'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: '게임 화면 넓히기', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '염주함 열기', exact: true })).toBeVisible();
  expect(Object.hasOwn((await state(page)).self, 'gender')).toBe(false);
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/yeomju-v2-gameplay.png', fullPage: true });
  const before = await state(page);
  await openMenu(page);
  await page.getByLabel('그래픽 품질').selectOption('low');
  await page.getByRole('button', { name: '순례자 이름 변경', exact: true }).click();
  await expect(page.getByLabel('캐릭터 성별')).toHaveCount(0);
  await page.getByLabel('순례자의 이름').fill('솔바람 동자');
  await page.getByRole('button', { name: '이 이름으로 머물기' }).click();
  await expect.poll(async () => (await state(page)).self.name).toBe('솔바람 동자');
  await page.reload();
  await expect.poll(async () => (await state(page))?.self.name).toBe('솔바람 동자');
  expect((await state(page)).self.id).toBe(before.self.id);
  expect(Object.hasOwn((await state(page)).self, 'gender')).toBe(false);
  await openMenu(page);
  await expect(page.getByLabel('그래픽 품질')).toHaveValue('low');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.game-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('primary background drag rotates the third-person camera without walking and guides movement', async ({
  page,
}) => {
  await openGame(page);
  const canvas = page.locator('.world-canvas canvas');
  const bounds = await canvas.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(bounds.width - viewport.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(bounds.height - viewport.height)).toBeLessThanOrEqual(2);
  const initial = await state(page);
  const startX = bounds.x + bounds.width * 0.4;
  const startY = bounds.y + bounds.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(startX + 200, startY, { steps: 10 });
  await page.mouse.up({ button: 'left' });
  await expect
    .poll(async () => (await state(page)).serverTime)
    .toBeGreaterThan(initial.serverTime + 700);
  const afterDrag = await state(page);
  expect(
    Math.hypot(afterDrag.self.x - initial.self.x, afterDrag.self.z - initial.self.z),
  ).toBeLessThan(0.25);
  expect(await page.evaluate(() => Boolean(document.pointerLockElement))).toBe(false);
  await canvas.focus();
  await page.keyboard.down('w');
  await expect
    .poll(async () => (await state(page)).self.x, { timeout: 8000 })
    .toBeGreaterThan(afterDrag.self.x + 3);
  await page.keyboard.up('w');
  expect((await state(page)).self.z).toBeLessThan(afterDrag.self.z - 1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '게임 메뉴', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.game-viewport')).toBeVisible();
});

test('gassho has no reward while bow walks to a cushion and completes a separate full-body ritual', async ({
  page,
}) => {
  await openGame(page);
  const initial = await state(page);
  const hallBefore = initial.halls.find((hall) => hall.id === 'hall-main').progress;
  expect(initial.self.seatId).toBeNull();
  await page.getByRole('button', { name: '합장하기', exact: true }).click();
  await expect.poll(async () => (await state(page)).self.gassho).toBe(true);
  await expect(page.getByRole('button', { name: '합장 풀기', exact: true })).toBeVisible();
  expect((await state(page)).self.bows).toBe(initial.self.bows);
  expect((await state(page)).self.inventory).toEqual(initial.self.inventory);
  await page.screenshot({ path: '/tmp/yeomju-v2-gassho.png' });
  await page.locator('.world-canvas canvas').focus();
  await page.keyboard.press('g');
  await expect.poll(async () => (await state(page)).self.gassho).toBe(false);
  await page.getByRole('button', { name: '절하기', exact: true }).click();
  await expect
    .poll(async () => (await state(page)).self.seatId, { timeout: 18000 })
    .toMatch(/^hall-main-seat-/);
  await expect
    .poll(async () => (await state(page)).self.bowingUntil, { timeout: 10000 })
    .toBeGreaterThan(0);
  const bowing = await state(page);
  expect(bowing.self.bowStartedAt).toBeGreaterThan(0);
  expect(bowing.self.bowDuration).toBeGreaterThan(0);
  expect(bowing.self.gassho).toBe(false);
  await page.screenshot({ path: '/tmp/yeomju-v2-bowing.png' });
  await expect
    .poll(async () => (await state(page)).self.bows, { timeout: 12000 })
    .toBe(initial.self.bows + 1);
  await expect
    .poll(async () => (await state(page)).halls.find((hall) => hall.id === 'hall-main').progress)
    .toBe((hallBefore + 1) % 108);
  expect((await state(page)).self.inventory.length).toBeLessThanOrEqual(
    initial.self.inventory.length + 1,
  );
  await expect(page.getByRole('button', { name: '목탁 두드리기', exact: true })).toBeEnabled();
  await page.screenshot({ path: '/tmp/yeomju-v2-temple.png' });
});

test('walks into the incense queue, waits for an offering, and can cancel a later place', async ({
  page,
}) => {
  await openGame(page);
  const initial = await state(page);
  await page.getByRole('button', { name: '향 공양하기', exact: true }).click();
  await expect
    .poll(async () => (await state(page)).self.incenseStationId, { timeout: 18000 })
    .toBe('incense-main');
  const queued = await state(page);
  expect(queued.self.incenseQueueIndex).toBe(0);
  expect(queued.incenseStations[0].queue).toContain(queued.self.id);
  await expect
    .poll(async () => (await state(page)).self.incenseOfferingUntil, { timeout: 18000 })
    .toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/yeomju-v2-incense.png' });
  await expect
    .poll(async () => (await state(page)).self.incenseStationId, { timeout: 15000 })
    .toBeNull();
  expect((await state(page)).self.bows).toBe(initial.self.bows);
  expect((await state(page)).self.inventory).toEqual(initial.self.inventory);
  await page.getByRole('button', { name: '향 공양하기', exact: true }).click();
  await expect
    .poll(async () => (await state(page)).self.incenseStationId, { timeout: 12000 })
    .toBe('incense-main');
  await page.getByRole('button', { name: '대기 취소', exact: true }).click();
  await expect.poll(async () => (await state(page)).self.incenseStationId).toBeNull();
  expect((await state(page)).incenseStations[0].queue).not.toContain(initial.self.id);
});

test('solid hall walls stop walking while the open front and stairs remain passable', async ({
  page,
}) => {
  await openGame(page);
  await sitAtHall(page);
  const inside = await state(page);
  expect(inside.self.x).toBeLessThan(0);
  expect(inside.self.z).toBeLessThan(-8.5);
  expect(inside.self.z).toBeGreaterThan(-31.5);
  await page.locator('.world-canvas canvas').focus();
  await page.keyboard.down('a');
  await expect.poll(async () => (await state(page)).self.x, { timeout: 10000 }).toBeLessThan(-16);
  const heldSamples = [];
  await expect
    .poll(async () => {
      heldSamples.push((await state(page)).self.x);
      if (heldSamples.length < 4) return Infinity;
      const recent = heldSamples.slice(-4);
      return Math.max(...recent) - Math.min(...recent);
    })
    .toBeLessThan(0.08);
  const atWall = await state(page);
  expect(atWall.self.x).toBeGreaterThan(-17.3);
  expect(atWall.self.x).toBeLessThan(-16);
  await page.keyboard.up('a');
  await page.screenshot({ path: '/tmp/yeomju-v2-solid-wall.png' });
  await page.keyboard.down('d');
  await expect
    .poll(async () => (await state(page)).self.x, { timeout: 10000 })
    .toBeGreaterThan(-3.4);
  await page.keyboard.up('d');
  expect(Math.abs((await state(page)).self.x)).toBeLessThan(5.25);
  await page.keyboard.down('s');
  await expect.poll(async () => (await state(page)).self.z, { timeout: 8000 }).toBeGreaterThan(-1);
  await page.keyboard.up('s');
  expect((await state(page)).self.seatId).toBeNull();
});

test('gathers real loot through the map and retains equipment and inventory after reconnect', async ({
  page,
}) => {
  await openGame(page);
  const initial = await state(page);
  await page.locator('.world-canvas canvas').focus();
  await page.keyboard.press('m');
  await expect(page.getByRole('dialog', { name: '느리게 걷는 산사' })).toBeVisible();
  await page.getByRole('button', { name: '대숲의 선물으로 이동' }).first().click();
  await expect
    .poll(async () => (await state(page)).self.inventory.length, { timeout: 18000 })
    .toBe(initial.self.inventory.length + 1);
  await page.getByRole('button', { name: '염주함 열기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '나의 염주함' });
  await dialog.locator('.inventory-item').nth(1).click();
  await dialog.getByRole('button', { name: '염주에서 빼기' }).click();
  await expect
    .poll(async () => (await state(page)).self.stats.bowSpeed)
    .toBe(initial.self.stats.bowSpeed - 1);
  await dialog.getByRole('button', { name: '염주에 이어 넣기' }).click();
  await expect
    .poll(async () => (await state(page)).self.stats.bowSpeed)
    .toBe(initial.self.stats.bowSpeed);
  const collected = await state(page);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect
    .poll(async () => (await state(page))?.self.inventory.length)
    .toBe(collected.self.inventory.length);
  expect((await state(page)).self.equipped.beads).toEqual(collected.self.equipped.beads);
});

test('seated moktak strikes sound only locally and never enter shared traffic', async ({
  browser,
  baseURL,
}, testInfo) => {
  testInfo.setTimeout(120000);
  const secondBrowser = await browser.browserType().launch(testInfo.project.use.launchOptions);
  const first = await browser.newContext({ baseURL, viewport: { width: 900, height: 650 } });
  const second = await secondBrowser.newContext({ baseURL, viewport: { width: 900, height: 650 } });
  try {
    const a = await first.newPage();
    await a.bringToFront();
    await openGame(a, { observeAudio: true });
    // Keep the real peer connected in a minimized window while the other
    // software-rendered client starts, as when a player switches windows.
    const aWindow = await first.newCDPSession(a);
    // Playwright normally forces every page to appear focused. Restore the
    // browser's real focus behavior so the game's background pause can work.
    await aWindow.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const { windowId: aWindowId } = await aWindow.send('Browser.getWindowForTarget');
    await aWindow.send('Browser.setWindowBounds', {
      windowId: aWindowId,
      bounds: { windowState: 'minimized' },
    });
    await expect.poll(() => a.evaluate(() => document.hasFocus())).toBe(false);
    const b = await second.newPage();
    await b.bringToFront();
    await openGame(b, { observeAudio: true });
    const aId = (await state(a)).self.id;
    const bId = (await state(b)).self.id;
    expect(aId).not.toBe(bId);
    await expect
      .poll(async () => (await state(b)).players.some((player) => player.id === aId))
      .toBe(true);
    const bWindow = await second.newCDPSession(b);
    await bWindow.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const { windowId: bWindowId } = await bWindow.send('Browser.getWindowForTarget');
    await bWindow.send('Browser.setWindowBounds', {
      windowId: bWindowId,
      bounds: { windowState: 'minimized' },
    });
    await expect.poll(() => b.evaluate(() => document.hasFocus())).toBe(false);
    await aWindow.send('Browser.setWindowBounds', {
      windowId: aWindowId,
      bounds: { windowState: 'normal' },
    });
    await a.bringToFront();
    await expect.poll(() => a.evaluate(() => document.hasFocus())).toBe(true);
    await sitAtHall(a);
    await expect
      .poll(async () => (await state(b)).players.find((player) => player.id === aId)?.seatId)
      .toBe((await state(a)).self.seatId);
    expect(await a.evaluate(() => window.__moktakAudioObservations.sampleStarts)).toBe(0);
    expect(await b.evaluate(() => window.__moktakAudioObservations.sampleStarts)).toBe(0);

    await a.getByRole('button', { name: '목탁 두드리기', exact: true }).click();
    await expect
      .poll(() => a.evaluate(() => window.__moktakAudioObservations.sampleStarts))
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() =>
        a.evaluate(() => performance.now() - window.__moktakAudioObservations.lastSampleAt),
      )
      .toBeGreaterThan(160);
    await a.locator('.world-canvas canvas').focus();
    await a.keyboard.press('f');
    await expect
      .poll(() => a.evaluate(() => window.__moktakAudioObservations.sampleStarts))
      .toBeGreaterThanOrEqual(2);
    await openMenu(a);
    await a.getByRole('button', { name: '목탁 소리 끄기', exact: true }).click();
    await a.keyboard.press('Escape');
    const mutedCount = await a.evaluate(() => window.__moktakAudioObservations.sampleStarts);
    const mutedAt = (await state(a)).serverTime;
    await a.getByRole('button', { name: '목탁 두드리기', exact: true }).click();
    await expect.poll(async () => (await state(a)).serverTime).toBeGreaterThan(mutedAt + 350);
    expect(await a.evaluate(() => window.__moktakAudioObservations.sampleStarts)).toBe(mutedCount);
    await openMenu(a);
    await a.getByRole('button', { name: '목탁 소리 켜기', exact: true }).click();
    await a.keyboard.press('Escape');
    await a.getByRole('button', { name: '목탁 두드리기', exact: true }).click();
    await expect
      .poll(() => a.evaluate(() => window.__moktakAudioObservations.sampleStarts))
      .toBeGreaterThan(mutedCount);
    const beforePackets = await b.evaluate(
      () => window.__moktakAudioObservations.receivedTypes.length,
    );
    await expect
      .poll(() => b.evaluate(() => window.__moktakAudioObservations.receivedTypes.length))
      .toBeGreaterThan(beforePackets);
    const observedA = await a.evaluate(() => window.__moktakAudioObservations);
    const observedB = await b.evaluate(() => window.__moktakAudioObservations);
    expect(observedB.sampleStarts).toBe(0);
    expect(observedA.oscillators).toBe(0);
    expect(observedB.oscillators).toBe(0);
    expect(observedA.sampleDurations.every((duration) => duration > 0.05)).toBe(true);
    expect(observedA.sentTypes.filter((type) => /moktak|audio|sound/i.test(type))).toEqual([]);
    expect(observedB.receivedTypes.filter((type) => /moktak|audio|sound/i.test(type))).toEqual([]);
    await a.locator('.world-canvas canvas').focus();
    await a.keyboard.down('w');
    await expect.poll(async () => (await state(a)).self.seatId).toBeNull();
    await expect
      .poll(async () => (await state(b)).players.find((player) => player.id === aId)?.seatId)
      .toBeNull();
    await a.keyboard.up('w');
  } finally {
    await first.close();
    await second.close();
    await secondBrowser.close();
  }
});

test('the recorded wooden-fish waveform plays audibly and ends without a synthesized tone', async ({
  page,
}) => {
  await page.route('**/moktak-audio-qa', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Recorded audio check</title>',
    }),
  );
  await page.goto('/moktak-audio-qa');
  const signal = await page.evaluate(async () => {
    const { playMoktakBuffer, MOKTAK_AUDIO_URL } = await import('/src/moktakAudio.js');
    const sampleRate = 44100;
    const decoder = new OfflineAudioContext(1, sampleRate, sampleRate);
    const response = await fetch(MOKTAK_AUDIO_URL);
    if (!response.ok) throw new Error(`Recording returned ${response.status}`);
    const recording = await decoder.decodeAudioData(await response.arrayBuffer());
    const context = new OfflineAudioContext(
      recording.numberOfChannels,
      Math.ceil((recording.duration + 0.3) * sampleRate),
      sampleRate,
    );
    let oscillators = 0;
    const createOscillator = context.createOscillator.bind(context);
    context.createOscillator = (...args) => {
      oscillators++;
      return createOscillator(...args);
    };
    playMoktakBuffer(context, context.destination, recording, 0, 0.9, 1);
    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);
    const original = recording.getChannelData(0);
    const rms = (values, start, end) => {
      const slice = values.subarray(Math.floor(start * sampleRate), Math.floor(end * sampleRate));
      return Math.sqrt(
        slice.reduce((sum, value) => sum + value * value, 0) / Math.max(1, slice.length),
      );
    };
    const start = Math.min(0.02, recording.duration * 0.1);
    const end = Math.max(start, recording.duration - 0.02);
    const inputRms = rms(original, start, end);
    return {
      duration: recording.duration,
      audible: rms(samples, 0, Math.min(recording.duration, 0.5)),
      waveformGain: rms(samples, start, end) / inputRms,
      tail: rms(samples, recording.duration + 0.05, recording.duration + 0.25),
      peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
      oscillators,
    };
  });
  expect(signal.duration).toBeGreaterThan(0.1);
  expect(signal.duration).toBeLessThan(5);
  expect(signal.audible).toBeGreaterThan(0.003);
  expect(signal.waveformGain).toBeCloseTo(0.9, 2);
  expect(signal.tail).toBeLessThan(0.00001);
  expect(signal.peak).toBeGreaterThan(0.01);
  expect(signal.peak).toBeLessThanOrEqual(1);
  expect(signal.oscillators).toBe(0);
});

test('temple background sound streams a real looping recording only after a play gesture', async ({
  page,
}) => {
  await page.route('**/temple-recording-qa', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><button>절 배경음 재생</button>',
    }),
  );
  await page.goto('/temple-recording-qa');
  await page.evaluate(async () => {
    const { createAmbience, AMBIENCE_AUDIO_URL } = await import('/src/ambient.js');
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__templeMedia = this;
      return nativePlay.apply(this, args);
    };
    window.__ambienceErrors = [];
    window.__templeAmbience = createAmbience({
      onError: (error) => window.__ambienceErrors.push(error),
    });
    window.__ambienceUrl = AMBIENCE_AUDIO_URL;
    document.querySelector('button').addEventListener('click', async () => {
      window.__ambienceStarted = await window.__templeAmbience.play();
    });
  });
  expect(await page.evaluate(() => Boolean(window.__templeMedia))).toBe(false);
  await page.getByRole('button', { name: '절 배경음 재생', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__ambienceStarted)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__templeMedia?.currentTime || 0))
    .toBeGreaterThan(0.15);
  const playing = await page.evaluate(() => ({
    duration: window.__templeMedia.duration,
    loop: window.__templeMedia.loop,
    paused: window.__templeMedia.paused,
    currentSource: new URL(window.__templeMedia.currentSrc).pathname,
    expectedSource: window.__ambienceUrl,
    errors: window.__ambienceErrors,
  }));
  expect(playing.duration).toBeGreaterThan(10);
  expect(playing.loop).toBe(true);
  expect(playing.paused).toBe(false);
  expect(playing.currentSource).toBe(playing.expectedSource);
  expect(playing.errors).toEqual([]);
  await page.evaluate(() => window.__templeAmbience.stop());
  expect(await page.evaluate(() => window.__templeMedia.paused)).toBe(true);
  expect(await page.evaluate(() => window.__templeAmbience.playing)).toBe(false);
});

test('the compact monk has distinct upright gassho and forehead-to-floor bow poses', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 750 });
  await page.route('**/monk-pose-qa', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e8e9d8}.labels{position:absolute;bottom:18px;left:0;right:0;display:flex;justify-content:space-around;font:17px sans-serif;color:#4b5b46}canvas{display:block}</style><div class="labels"><span>서 있기</span><span>합장</span><span>절</span><span>방석</span></div>',
    }),
  );
  await page.goto('/monk-pose-qa');
  const poses = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createPilgrimAvatar, AVATAR_HEIGHT } = await import('/src/world/avatar.js');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#e8e9d8');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(1200, 750);
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    document.body.append(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-2.2, 2.2, 1.375, -1.375, 0.01, 30);
    camera.position.set(0, 1.65, 5);
    camera.lookAt(0, 0.48, 0);
    scene.add(new THREE.HemisphereLight('#fff6df', '#8b9c74', 2.2));
    const light = new THREE.DirectionalLight('#fff0ca', 3);
    light.position.set(-3, 5, 4);
    light.castShadow = true;
    scene.add(light);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: '#d4d9be', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const configurations = [
      {},
      { gassho: true },
      { bowing: true, progress: 0.58 },
      { sitting: true },
    ];
    const rigs = configurations.map((configuration) => {
      const rig = createPilgrimAvatar({ THREE, isSelf: true, seed: 0 });
      for (let frame = 0; frame < 120; frame++)
        rig.animate({ ...configuration, time: 0, delta: 1 / 60 });
      rig.group.updateWorldMatrix(true, true);
      return rig;
    });
    const bounds = new THREE.Box3().setFromObject(rigs[0].group, true);
    const bowHead = new THREE.Box3().setFromObject(
      rigs[2].group.getObjectByName('little-bald-head'),
      true,
    );
    const prayerHead = new THREE.Box3().setFromObject(
      rigs[1].group.getObjectByName('little-bald-head'),
      true,
    );
    const measurements = {
      advertisedHeight: AVATAR_HEIGHT,
      height: bounds.max.y - bounds.min.y,
      width: bounds.max.x - bounds.min.x,
      bowHeadBottom: bowHead.min.y,
      gasshoHeadBottom: prayerHead.min.y,
    };
    rigs.forEach((rig, index) => {
      rig.group.position.x = (index - 1.5) * 1.08;
      rig.group.rotation.y = index === 2 ? 1.15 : -0.2;
      scene.add(rig.group);
    });
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.16, 0.8),
      new THREE.MeshStandardMaterial({ color: '#859b72', roughness: 1 }),
    );
    cushion.position.set(1.62, 0.08, 0);
    scene.add(cushion);
    rigs[3].group.position.y = 0.154;
    renderer.render(scene, camera);
    window.__disposePoseCheck = () => {
      rigs.forEach((rig) => rig.dispose());
      renderer.dispose();
    };
    return measurements;
  });
  expect(poses.advertisedHeight).toBeCloseTo(1.15, 2);
  expect(poses.height).toBeGreaterThan(1.05);
  expect(poses.height).toBeLessThan(1.25);
  expect(poses.width).toBeLessThan(0.8);
  expect(poses.bowHeadBottom).toBeGreaterThanOrEqual(-0.01);
  expect(poses.bowHeadBottom).toBeLessThan(0.05);
  expect(poses.gasshoHeadBottom).toBeGreaterThan(0.6);
  await page.screenshot({ path: '/tmp/yeomju-v2-avatar-poses.png' });
  await page.evaluate(() => window.__disposePoseCheck());
});

test('mobile game fits the viewport, moves, and plays its cushion moktak by touch', async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(90000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await openGame(page, { observeAudio: true });
    await expect(page.locator('.game-screen')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/tmp/yeomju-v2-mobile.png', fullPage: true });
    await openMenu(page);
    await expect(page.getByLabel('그래픽 품질')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.getByRole('button', { name: '게임으로 돌아가기', exact: true }).click();
    await page.getByRole('button', { name: '염주함 열기', exact: true }).tap();
    await expect(page.getByRole('dialog', { name: '나의 염주함' })).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    const initial = await state(page);
    const forward = page.getByRole('button', { name: '앞으로 이동', exact: true });
    const bounds = await forward.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await state(page)).self.z, { timeout: 8000 })
      .toBeLessThan(initial.self.z - 0.6);
    await page.mouse.up();
    await sitAtHall(page);
    const moktak = page.getByRole('button', { name: '목탁 두드리기', exact: true });
    await moktak.tap();
    await expect
      .poll(() => page.evaluate(() => window.__moktakAudioObservations.sampleStarts))
      .toBeGreaterThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/tmp/yeomju-v2-seated-mobile.png', fullPage: true });
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await state(page)).self.seatId).toBeNull();
    await page.mouse.up();
  } finally {
    await context.close();
  }
});

test('a new browser enters the next channel when 108 real connections fill the first', async ({
  page,
  baseURL,
}) => {
  const peers = [];
  const sessionURL = `${baseURL}/api/session`;
  const websocketURL = `${baseURL.replace('http:', 'ws:')}/ws`;
  try {
    await Promise.all(
      Array.from({ length: 108 }, async (_, index) => {
        const response = await fetch(sessionURL);
        expect(response.ok).toBe(true);
        const cookie = response.headers.get('set-cookie')?.split(';')[0];
        expect(Boolean(cookie)).toBe(true);
        const socket = new WebSocket(websocketURL, { headers: { Cookie: cookie } });
        peers.push(socket);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Channel filler could not enter')),
            15000,
          );
          socket.on('error', reject);
          socket.on('open', () =>
            socket.send(
              JSON.stringify({ type: 'join', channelId: 'ch-01', name: `정원 검사 ${index}` }),
            ),
          );
          socket.on('message', (raw) => {
            const packet = JSON.parse(raw.toString());
            if (packet.type === 'state' && packet.channel.id === 'ch-01') {
              clearTimeout(timer);
              resolve();
            }
          });
        });
      }),
    );
    await expect
      .poll(async () => {
        const response = await fetch(`${baseURL}/api/channels`);
        return (await response.json()).channels.find((channel) => channel.id === 'ch-01').count;
      })
      .toBe(108);
    await openGame(page);
    await expect.poll(async () => (await state(page)).channel.id).toBe('ch-02');
    await expect(page.getByRole('button', { name: '채널 선택', exact: true })).toContainText(
      '연화의 못',
    );
  } finally {
    for (const socket of peers) socket.terminate();
  }
});
