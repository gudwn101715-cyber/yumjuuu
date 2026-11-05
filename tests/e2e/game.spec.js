import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

async function openGame(page, { observeAudio = false } = {}) {
  // Observe real network messages, without sending game actions or changing state.
  await page.addInitScript((observeAudio) => {
    if (observeAudio) {
      window.__moktakAudioObservations = {
        oscillators: 0,
        lastOscillatorAt: 0,
        sentTypes: [],
        receivedTypes: [],
      };
      const contextPrototype = (window.AudioContext || window.webkitAudioContext)?.prototype;
      if (contextPrototype) {
        const createOscillator = contextPrototype.createOscillator;
        contextPrototype.createOscillator = function (...args) {
          window.__moktakAudioObservations.oscillators++;
          window.__moktakAudioObservations.lastOscillatorAt = performance.now();
          return createOscillator.apply(this, args);
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
}

async function state(page) {
  return page.evaluate(() => window.__gameState);
}

async function sitAtHall(page) {
  const before = await state(page);
  await page.getByRole('button', { name: '법당으로 가기', exact: true }).click();
  await expect
    .poll(async () => (await state(page)).self.bows, { timeout: 22000 })
    .toBe(before.self.bows + 1);
  await page.getByRole('button', { name: '방석 찾아가기', exact: true }).click();
  await expect.poll(async () => (await state(page)).self.seatId, { timeout: 18000 }).toBeTruthy();
  await expect(page.getByRole('button', { name: '목탁 두드리기', exact: true })).toBeEnabled();
}

test('renders the temple, moves authoritatively, and saves profile and quality choices', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  await expect(page.locator('.app-shell')).toHaveClass(/immersive-mode/);
  await expect(page.getByRole('button', { name: '염주함 열기', exact: true })).toBeVisible();
  await expect(page.locator('.world-canvas canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/yeomju-graphics-desktop.png', fullPage: true });
  const before = await state(page);
  await page.locator('.world-canvas canvas').focus();
  await page.keyboard.down('d');
  await expect
    .poll(async () => (await state(page)).self.x, { timeout: 8000 })
    .toBeGreaterThan(before.self.x + 3);
  await page.screenshot({ path: '/tmp/yeomju-graphics-walking.png' });
  await page.keyboard.up('d');
  await page.getByRole('button', { name: '순례자 이름 변경', exact: true }).click();
  await page.getByLabel('순례자의 이름').fill('솔바람 여행자');
  await page.getByLabel('캐릭터 성별').selectOption('female');
  await page.getByRole('button', { name: '이 이름으로 머물기' }).click();
  await expect.poll(async () => (await state(page)).self.name).toBe('솔바람 여행자');
  await expect.poll(async () => (await state(page)).self.gender).toBe('female');
  await page.getByLabel('그래픽 품질').selectOption('low');
  await expect(page.getByLabel('그래픽 품질')).toHaveValue('low');
  expect((await state(page)).self.id).toBe(before.self.id);
  await page.reload();
  await expect.poll(async () => (await state(page))?.self.name).toBe('솔바람 여행자');
  await expect.poll(async () => (await state(page))?.self.gender).toBe('female');
  await expect(page.getByLabel('그래픽 품질')).toHaveValue('low');
  expect((await state(page)).self.id).toBe(before.self.id);
  expect(errors).toEqual([]);
});

test('third-person camera turns with right drag, guides movement, and fills the viewport', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
  await expect(page.locator('.toast')).toHaveCount(0);
  const canvas = page.locator('.world-canvas canvas');
  await expect(page.locator('.app-shell')).toHaveClass(/immersive-mode/);
  await expect
    .poll(async () => {
      const bounds = await canvas.boundingBox();
      const viewport = page.viewportSize();
      return (
        Math.abs(bounds.width - viewport.width) <= 2 &&
        Math.abs(bounds.height - viewport.height) <= 2
      );
    })
    .toBe(true);
  await page.screenshot({ path: '/tmp/yeomju-graphics-immersive.png' });
  await page.getByRole('button', { name: '마우스 시점 켜기', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(false);
  await expect(page.locator('.app-shell')).toHaveClass(/immersive-mode/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/immersive-mode/);
  await expect(page.getByRole('button', { name: '게임 화면 넓히기', exact: true })).toBeVisible();

  const before = await state(page);
  await canvas.focus();
  await page.keyboard.down('w');
  await expect
    .poll(async () => (await state(page)).self.z, { timeout: 8000 })
    .toBeLessThan(before.self.z - 3);
  await page.keyboard.up('w');
  expect(Math.abs((await state(page)).self.x - before.self.x)).toBeLessThan(1);

  const bounds = await canvas.boundingBox();
  const startX = bounds.x + bounds.width * 0.4;
  const startY = bounds.y + bounds.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(startX + 200, startY, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  const afterTurn = await state(page);
  await canvas.focus();
  await page.keyboard.down('w');
  await expect
    .poll(async () => (await state(page)).self.x, { timeout: 8000 })
    .toBeGreaterThan(afterTurn.self.x + 3);
  await page.keyboard.up('w');
  expect((await state(page)).self.z).toBeLessThan(afterTurn.self.z - 1);
  expect(errors).toEqual([]);
});

test('walks to a real gathering node, gains loot, changes equipment, and retains inventory', async ({
  page,
}) => {
  await openGame(page);
  const initial = await state(page);
  await page.getByRole('button', { name: '산사 지도 열기', exact: true }).click();
  await page.getByRole('button', { name: '대숲의 선물으로 이동' }).first().click();
  await expect
    .poll(async () => (await state(page)).self.inventory.length, { timeout: 18000 })
    .toBe(initial.self.inventory.length + 1);
  await page.screenshot({ path: '/tmp/yeomju-graphics-forest.png' });
  await page.getByRole('button', { name: '염주함 열기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '나의 염주함' });
  await expect(dialog).toBeVisible();
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
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect
    .poll(async () => (await state(page))?.self.inventory.length)
    .toBe(collected.self.inventory.length);
  expect((await state(page)).self.equipped.beads).toEqual(collected.self.equipped.beads);
});

test('completes a timed bow and contributes to the shared hall progress', async ({ page }) => {
  await openGame(page);
  const initial = await state(page);
  const hallBefore = initial.halls.find((hall) => hall.id === 'hall-main').progress;
  await page.getByRole('button', { name: '법당으로 가기', exact: true }).click();
  await expect
    .poll(async () => (await state(page)).self.bows, { timeout: 22000 })
    .toBe(initial.self.bows + 1);
  await expect
    .poll(async () => (await state(page)).halls.find((hall) => hall.id === 'hall-main').progress)
    .toBe((hallBefore + 1) % 108);
  await expect(page.getByRole('button', { name: '마음을 담아 절하기', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/yeomju-graphics-temple-close.png' });
});

test('two independent browsers share a channel, chat, and isolate traffic after switching', async ({
  browser,
  baseURL,
}, testInfo) => {
  // Separate browser processes model independent players without making two
  // software-rendered worlds compete for the same Chromium GPU process.
  const secondBrowser = await browser.browserType().launch(testInfo.project.use.launchOptions);
  const first = await browser.newContext({ baseURL, viewport: { width: 900, height: 650 } });
  const second = await secondBrowser.newContext({ baseURL, viewport: { width: 900, height: 650 } });
  try {
    const a = await first.newPage();
    await a.bringToFront();
    await openGame(a);
    const b = await second.newPage();
    await b.bringToFront();
    await openGame(b);
    const aId = (await state(a)).self.id,
      bId = (await state(b)).self.id;
    expect(aId).not.toBe(bId);
    await expect
      .poll(async () => (await state(a)).players.some((player) => player.id === bId))
      .toBe(true);
    await expect
      .poll(async () => (await state(b)).players.some((player) => player.id === aId))
      .toBe(true);
    await a.getByRole('button', { name: '마당 이야기 열기', exact: true }).click();
    await b.getByRole('button', { name: '마당 이야기 열기', exact: true }).click();
    const chatA = a.locator('.hud-chat');
    const chatB = b.locator('.hud-chat');
    await chatA.getByLabel('채널 채팅 메시지').fill('함께 걷는 산사');
    await chatA.getByRole('button', { name: '메시지 보내기' }).click();
    await expect(chatB.locator('.chat-messages')).toContainText('함께 걷는 산사');
    await b.locator('.world-channel').click();
    await b.locator('.channel-tile').nth(1).click();
    await expect.poll(async () => (await state(b)).channel.id).toBe('ch-02');
    await expect
      .poll(async () => (await state(a)).players.some((player) => player.id === bId))
      .toBe(false);
    await expect
      .poll(async () => (await state(b)).players.some((player) => player.id === aId))
      .toBe(false);
    // Existing channel history must disappear when entering another channel.
    await expect(chatB.locator('.chat-messages')).not.toContainText('함께 걷는 산사');
    await chatB.getByLabel('채널 채팅 메시지').fill('연꽃 마당의 인사');
    await chatB.getByRole('button', { name: '메시지 보내기' }).click();
    await expect(chatB.locator('.chat-messages')).toContainText('연꽃 마당의 인사');
    await expect(chatA.locator('.chat-messages')).not.toContainText('연꽃 마당의 인사');
  } finally {
    await first.close();
    await second.close();
    await secondBrowser.close();
  }
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
    expect(await a.evaluate(() => window.__moktakAudioObservations.oscillators)).toBe(0);
    expect(await b.evaluate(() => window.__moktakAudioObservations.oscillators)).toBe(0);

    await a.getByRole('button', { name: '목탁 두드리기', exact: true }).click();
    await expect
      .poll(() => a.evaluate(() => window.__moktakAudioObservations.oscillators))
      .toBeGreaterThanOrEqual(5);
    await expect
      .poll(() =>
        a.evaluate(() => performance.now() - window.__moktakAudioObservations.lastOscillatorAt),
      )
      .toBeGreaterThan(160);
    await a.locator('.world-canvas canvas').focus();
    await a.keyboard.press('f');
    await expect
      .poll(() => a.evaluate(() => window.__moktakAudioObservations.oscillators))
      .toBeGreaterThanOrEqual(10);
    const beforePackets = await b.evaluate(
      () => window.__moktakAudioObservations.receivedTypes.length,
    );
    await expect
      .poll(() => b.evaluate(() => window.__moktakAudioObservations.receivedTypes.length))
      .toBeGreaterThan(beforePackets);
    const observedA = await a.evaluate(() => window.__moktakAudioObservations);
    const observedB = await b.evaluate(() => window.__moktakAudioObservations);
    expect(observedB.oscillators).toBe(0);
    expect(observedA.sentTypes.filter((type) => /moktak|audio|sound/i.test(type))).toEqual([]);
    expect(observedB.receivedTypes.filter((type) => /moktak|audio|sound/i.test(type))).toEqual([]);
    await a.getByRole('button', { name: '일어나기', exact: true }).click();
    await expect.poll(async () => (await state(a)).self.seatId).toBeNull();
    await expect
      .poll(async () => (await state(b)).players.find((player) => player.id === aId)?.seatId)
      .toBeNull();
  } finally {
    await first.close();
    await second.close();
    await secondBrowser.close();
  }
});

test('moktak synthesis renders an audible strike that decays to silence', async ({ page }) => {
  await page.route('**/moktak-audio-qa', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Audio check</title>' }),
  );
  await page.goto('/moktak-audio-qa');
  const signal = await page.evaluate(async () => {
    const { synthesizeMoktak } = await import('/src/moktakAudio.js');
    const sampleRate = 44100;
    const context = new OfflineAudioContext(1, sampleRate, sampleRate);
    synthesizeMoktak(context, context.destination, 0, 0.9);
    const rendered = await context.startRendering();
    const samples = rendered.getChannelData(0);
    const rms = (start, end) => {
      const slice = samples.subarray(Math.floor(start * sampleRate), Math.floor(end * sampleRate));
      return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
    };
    return {
      attack: rms(0.002, 0.06),
      tail: rms(0.8, 0.95),
      peak: samples.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0),
    };
  });
  expect(signal.attack).toBeGreaterThan(0.02);
  expect(signal.tail).toBeLessThan(0.0002);
  expect(signal.peak).toBeGreaterThan(0.05);
  expect(signal.peak).toBeLessThan(1);
});

test('mobile layout fits the viewport, moves, and plays a seated moktak by touch', async ({
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
    await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded');
    await expect(page.locator('.toast')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/tmp/yeomju-graphics-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '산사 지도 열기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '느리게 걷는 산사' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '염주함 열기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '나의 염주함' })).toBeVisible();
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    const initial = await state(page);
    const forward = page.getByRole('button', { name: '앞으로 이동', exact: true });
    await expect(forward).toBeVisible();
    const bounds = await forward.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect
      .poll(async () => (await state(page)).self.z, { timeout: 8000 })
      .toBeLessThan(initial.self.z - 0.6);
    await page.mouse.up();
    const stoppedSamples = [];
    await expect
      .poll(async () => {
        stoppedSamples.push((await state(page)).self.z);
        if (stoppedSamples.length < 4) return Infinity;
        const recent = stoppedSamples.slice(-4);
        return Math.max(...recent) - Math.min(...recent);
      })
      .toBeLessThan(0.12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await sitAtHall(page);
    const moktak = page.getByRole('button', { name: '목탁 두드리기', exact: true });
    await expect(moktak).toBeVisible();
    await moktak.tap();
    await expect
      .poll(() => page.evaluate(() => window.__moktakAudioObservations.oscillators))
      .toBeGreaterThanOrEqual(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: '/tmp/yeomju-seated-mobile.png', fullPage: true });
    await page.getByRole('button', { name: '일어나기', exact: true }).tap();
    await expect.poll(async () => (await state(page)).self.seatId).toBeNull();
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
    await expect(page.locator('.world-channel')).toContainText('연화의 못');
  } finally {
    for (const socket of peers) socket.terminate();
  }
});
