import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as playwright } from 'playwright-core';
import { createAttempt, consumeCallback, isCallback } from '../src/auth.mjs';
import { APP_DISPLAY_NAME } from '../src/shared/app-name.mjs';

const profileDir = await mkdtemp(join(tmpdir(), 'music-electron-profile-'));
const mediaDir = await mkdtemp(join(tmpdir(), 'music-electron-audio-'));
let app;
let redirectRequests = 0;
const redirectServer = createServer((_request, response) => {
  redirectRequests++;
  response.writeHead(302, { Location: 'http://127.0.0.1:1/redirect-target' });
  response.end();
});
await new Promise(resolve => redirectServer.listen(0, '127.0.0.1', resolve));
const redirectUrl = `http://127.0.0.1:${redirectServer.address().port}/redirect`;

try {
  const wav = join(mediaDir, 'tone.wav');
  const mp3 = join(mediaDir, 'tone.mp3');
  const flac = join(mediaDir, 'tone.flac');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-ar', '44100', wav]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', mp3]);
  execFileSync('ffmpeg', ['-v', 'error', '-i', wav, '-c:a', 'flac', flac]);
  const localTracks = [
    { type: 'audio/mpeg', bytes: (await readFile(mp3)).toString('base64'), title: 'Smoke MP3' },
    { type: 'audio/flac', bytes: (await readFile(flac)).toString('base64'), title: 'Smoke FLAC' },
  ];
  app = await playwright.launch({
    executablePath: electron,
    args: ['--no-sandbox', `--user-data-dir=${profileDir}`, 'out/main/index.js'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });
  const window = await app.firstWindow();
  const safeStorageResult = await app.evaluate(({ safeStorage }, { directory, storePath }) => {
    const fs = process.getBuiltinModule('node:fs/promises');
    const path = process.getBuiltinModule('node:path');
    const moduleApi = process.getBuiltinModule('node:module');
    const store = moduleApi.createRequire(path.join(path.dirname(storePath), 'index.js'))(storePath);
    const persistence = store.persistenceMode(safeStorage);
    if (persistence !== 'secure') {
      const saved = store.saveSession(directory, {
        version: 1, music: { token: 'ELECTRON-SAFE-STORAGE-SMOKE-ONLY' },
      }, safeStorage, fs);
      return Promise.resolve(saved).then(async result => ({
        persistence, saved: result, files: await fs.readdir(directory).catch(() => []),
      }));
    }
    const candidate = {
      version: 1,
      music: { token: 'ELECTRON-SAFE-STORAGE-SMOKE-ONLY', snsUserID: 'SMOKE-USER', expireTime: '20990101000000' },
    };
    const file = path.join(directory, 'session.enc');
    return store.saveSession(directory, candidate, safeStorage, fs).then(async saved => {
      const [bytes, metadata, restored] = await Promise.all([
        fs.readFile(file), fs.stat(file), store.loadSession(directory, safeStorage, fs),
      ]);
      await store.clearSession(directory, fs);
      return {
        persistence, saved,
        plaintextAbsent: !bytes.includes(Buffer.from(candidate.music.token)),
        restored: JSON.stringify(restored) === JSON.stringify(candidate),
        fileMode: metadata.mode & 0o777,
        cleaned: !(await fs.stat(file).then(() => true, () => false)),
      };
    });
  }, {
    directory: join(profileDir, 'safe-storage-smoke'),
    storePath: join(dirname(fileURLToPath(import.meta.url)), '../src/main/session-store.cjs'),
  });
  if (safeStorageResult.persistence === 'secure') {
    assert.equal(safeStorageResult.saved, true);
    assert.equal(safeStorageResult.plaintextAbsent, true);
    assert.equal(safeStorageResult.restored, true);
    if (process.platform !== 'win32') assert.equal(safeStorageResult.fileMode, 0o600);
    assert.equal(safeStorageResult.cleaned, true);
    console.log('Electron system safeStorage encrypted, decrypted and cleaned an isolated synthetic session.');
  } else {
    assert.equal(safeStorageResult.saved, false);
    assert.deepEqual(safeStorageResult.files, []);
    console.log('Electron safeStorage is unavailable; isolated synthetic session remained memory-only.');
  }
  const cdp = await window.context().newCDPSession(window);
  await cdp.send('Page.enable');
  const failures = [];
  window.on('pageerror', error => failures.push(error.message));
  window.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await window.waitForTimeout(2500);
  const snapshot = await window.locator('body').innerText();
  assert.match(snapshot, /连接你的音乐库|请登录以读取个人音乐库/, JSON.stringify({ snapshot, failures }));
  assert.equal(await window.title(), APP_DISPLAY_NAME);
  assert.equal(await window.getByRole('status').getAttribute('aria-live'), 'polite');
  assert.equal(await window.getByRole('slider', { name: '播放进度' }).count(), 1);
  assert.equal(await window.getByRole('slider', { name: '音量' }).count(), 1);
  assert.equal(await window.getByRole('button', { name: '播放', exact: true }).isDisabled(), true);
  const boundary = await window.evaluate(() => ({
    desktopApi: typeof window.desktop?.auth?.status === 'function',
    apiKeys: Object.keys(window.desktop ?? {}).sort(),
    authKeys: Object.keys(window.desktop?.auth ?? {}).sort(),
    musicKeys: Object.keys(window.desktop?.music ?? {}).sort(),
    settingsKeys: Object.keys(window.desktop?.settings ?? {}).sort(),
    queueKeys: Object.keys(window.desktop?.queue ?? {}).sort(),
    windowKeys: Object.keys(window.desktop?.window ?? {}).sort(),
    playerKeys: Object.keys(window.desktop?.player ?? {}).sort(),
    hasGenericInvoke: 'invoke' in (window.desktop ?? {}) || 'send' in (window.desktop ?? {}),
    nodeProcess: typeof process,
    requireType: typeof require,
  }));
  assert.equal(boundary.desktopApi, true);
  assert.deepEqual(boundary.apiKeys, ['app', 'auth', 'music', 'onNotice', 'player', 'queue', 'settings', 'window']);
  assert.deepEqual(boundary.authKeys, ['cancelLogin', 'login', 'logout', 'onProgress', 'status']);
  assert.deepEqual(boundary.musicKeys, [
    'album', 'artist', 'createPlaylist', 'deletePlaylist', 'favoriteState', 'favorites', 'favoritesSummary', 'history', 'lyrics',
    'playlistDetail', 'playlists', 'reportPlayback', 'resolvePlayback', 'search', 'setFavorite', 'updatePlaylistDescription',
  ]);
  assert.deepEqual(boundary.settingsKeys, ['get', 'update']);
  assert.deepEqual(boundary.queueKeys, ['load', 'save']);
  assert.deepEqual(boundary.windowKeys, ['minimize', 'setCloseBehavior']);
  assert.deepEqual(boundary.playerKeys, ['onCommand']);
  assert.equal(boundary.hasGenericInvoke, false, 'preload exposed a generic IPC entry point');
  assert.equal(boundary.nodeProcess, 'undefined');
  assert.equal(boundary.requireType, 'undefined');
  // macOS keeps the minimal native roles for Cmd+Q / copy / paste; Windows/Linux
  // have no application menu or in-window menu bar. Never accept the default View menu.
  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    return { applicationMenuRemoved: menu === null, roles: menu?.items.map(item => item.role?.toLowerCase()) ?? [] };
  });
  assert.deepEqual(menuState, process.platform === 'darwin'
    ? { applicationMenuRemoved: false, roles: ['appmenu', 'editmenu', 'windowmenu'] }
    : { applicationMenuRemoved: true, roles: [] }, JSON.stringify(menuState));
  if (process.platform !== 'darwin') {
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  }
  const rendererOrigin = new URL(await window.url()).protocol;
  assert.equal(rendererOrigin, 'file:');
  const trustedUrl = await window.url();
  await window.evaluate(() => { window.location.href = 'file:///etc/passwd'; });
  await window.waitForTimeout(150);
  assert.equal(await window.url(), trustedUrl, 'main window allowed navigation away from the trusted renderer document');
  await window.evaluate(url => { window.location.href = url; }, redirectUrl);
  await window.waitForTimeout(250);
  assert.equal(await window.url(), trustedUrl, 'main window left the trusted renderer for an external redirect fixture');
  assert.equal(redirectRequests, 0, 'external navigation reached the local redirect server before being blocked');
  const permissionState = await window.evaluate(() => navigator.permissions.query({ name: 'notifications' }).then(result => result.state));
  assert.notEqual(permissionState, 'granted', 'main renderer unexpectedly received a browser permission');
  const pagesBeforePopup = window.context().pages().length;
  const popupResult = await window.evaluate(() => window.open('file:///etc/passwd'));
  assert.equal(popupResult, null, 'main window allowed a child window to open');
  assert.equal(window.context().pages().length, pagesBeforePopup, 'window.open created a child page');
  const attempt = createAttempt();
  const callbackTarget = `${attempt.redirectUri}?code=synthetic-code&state=${attempt.state}`;
  const callbackCode = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Electron did not report the synthetic custom-scheme navigation')), 5000);
    const cleanup = () => {
      clearTimeout(timer);
      cdp.off('Page.frameRequestedNavigation', captureNavigation);
      cdp.off('Page.frameScheduledNavigation', captureNavigation);
      cdp.off('Page.frameNavigated', captureFrame);
    };
    const consume = url => {
      if (typeof url !== 'string' || !isCallback(url, attempt)) return;
      cleanup();
      try { resolve(consumeCallback(url, attempt)); } catch (error) { reject(error); }
    };
    const captureNavigation = params => consume(params?.url);
    const captureFrame = params => consume(params?.frame?.url);
    cdp.on('Page.frameRequestedNavigation', captureNavigation);
    cdp.on('Page.frameScheduledNavigation', captureNavigation);
    cdp.on('Page.frameNavigated', captureFrame);
  });
  await window.evaluate(url => { window.location.href = url; }, callbackTarget);
  assert.equal(await callbackCode, 'synthetic-code');
  await window.waitForTimeout(100);
  assert.equal(await window.url(), trustedUrl, 'synthetic OAuth callback navigated the main window');
  await app.evaluate(({ ipcMain }, { urls }) => {
    const channels = {
      authStatus: 'auth:status', musicFavorites: 'music:favorites', musicResolvePlayback: 'music:resolve-playback',
    };
    ipcMain.removeHandler(channels.authStatus);
    ipcMain.removeHandler(channels.musicFavorites);
    ipcMain.removeHandler(channels.musicResolvePlayback);
    ipcMain.handle(channels.authStatus, () => ({ ok: true, data: { authenticated: true, persistence: 'memory-only' } }));
    ipcMain.handle(channels.musicFavorites, () => ({ ok: true, data: { tracks: [
      { id: 'smoke-mp3', title: 'Smoke MP3', artists: [{ name: 'Local fixture' }], available: true },
      { id: 'smoke-flac', title: 'Smoke FLAC', artists: [{ name: 'Local fixture' }], available: true },
    ], nextStart: 50, hasMore: false } }));
    ipcMain.handle(channels.musicResolvePlayback, (_event, input) => ({ ok: true, data: {
      url: input.trackId === 'smoke-mp3' ? urls[0] : urls[1],
      actualQuality: input.trackId === 'smoke-mp3' ? 'standard' : 'lossless',
    } }));
  }, { urls: [] });
  await window.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.__testAudioInstances = [];
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args) {
        const instance = Reflect.construct(target, args);
        window.__testAudioInstances.push(instance);
        return instance;
      },
    });
  });
  await window.reload();
  const localUrls = await window.evaluate(samples => samples.map(({ type, bytes }) => {
    const binary = atob(bytes);
    const data = Uint8Array.from(binary, character => character.charCodeAt(0));
    return URL.createObjectURL(new Blob([data], { type }));
  }), localTracks);
  await app.evaluate(({ ipcMain }, { urls }) => {
    ipcMain.removeHandler('music:resolve-playback');
    ipcMain.handle('music:resolve-playback', (_event, input) => ({ ok: true, data: {
      url: input.trackId === 'smoke-mp3' ? urls[0] : urls[1],
      actualQuality: input.trackId === 'smoke-mp3' ? 'standard' : 'lossless',
    } }));
  }, { urls: localUrls });
  // Anchor to the row's own accessible name; a bare /Smoke MP3/ also matches the favorite button.
  const mp3Row = window.getByRole('button', { name: /^Smoke MP3/ });
  const flacRow = window.getByRole('button', { name: /^Smoke FLAC/ });
  await mp3Row.waitFor({ timeout: 10000 });
  await flacRow.waitFor({ timeout: 10000 });
  await mp3Row.dblclick();
  await window.getByRole('button', { name: '暂停' }).waitFor({ timeout: 10000 });
  const beforeRefresh = await window.evaluate(() => ({
    count: window.__testAudioInstances.length,
    currentTime: window.__testAudioInstances[0]?.currentTime,
    paused: window.__testAudioInstances[0]?.paused,
  }));
  assert.equal(beforeRefresh.count, 1, 'app should own exactly one Audio element');
  assert.equal(beforeRefresh.paused, false);
  await window.getByRole('button', { name: '刷新收藏' }).click();
  await window.getByText('共 2 首收藏', { exact: true }).waitFor({ timeout: 5000 });
  await window.waitForTimeout(200);
  const afterRefresh = await window.evaluate(() => ({
    count: window.__testAudioInstances.length,
    sameInstance: window.__testAudioInstances.length === 1,
    currentTime: window.__testAudioInstances[0]?.currentTime,
    paused: window.__testAudioInstances[0]?.paused,
  }));
  assert.equal(afterRefresh.count, 1, 'rerender created or destroyed the singleton Audio element');
  assert.equal(afterRefresh.paused, false, 'favorites refresh interrupted playback');
  assert.ok(afterRefresh.currentTime > beforeRefresh.currentTime, JSON.stringify({ beforeRefresh, afterRefresh }));
  await window.getByRole('slider', { name: '播放进度' }).evaluate(input => {
    const slider = input;
    const target = Number(slider.max) * 0.65;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(target));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await window.getByText('Smoke FLAC', { exact: true }).waitFor({ timeout: 10000 });
  await window.getByRole('button', { name: '暂停' }).waitFor({ timeout: 10000 });
  await window.getByRole('button', { name: '播放', exact: true }).waitFor({ timeout: 15000 });
  assert.match(await window.locator('.now-playing').innerText(), /Smoke FLAC/);
  await window.evaluate(urls => urls.forEach(URL.revokeObjectURL), localUrls);
  const audioResult = await window.evaluate(async () => {
    const sampleRate = 8000;
    const sampleCount = sampleRate;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    write(0, 'RIFF'); view.setUint32(4, 36 + sampleCount * 2, true); write(8, 'WAVE');
    write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, sampleCount * 2, true);
    for (let index = 0; index < sampleCount; index++) view.setInt16(44 + index * 2, Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 5000, true);
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    const player = new Audio(url);
    const metadata = new Promise(resolve => player.addEventListener('loadedmetadata', () => resolve(player.duration), { once: true }));
    await metadata;
    const duration = player.duration;
    const seeked = new Promise(resolve => player.addEventListener('seeked', () => resolve(player.currentTime), { once: true }));
    player.currentTime = duration * 0.75;
    const seekPosition = await seeked;
    const ended = new Promise(resolve => player.addEventListener('ended', () => resolve(true), { once: true }));
    await player.play();
    const completed = await ended;
    player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url);
    return { duration, seekPosition, completed };
  });
  assert.ok(audioResult.duration > 0.9 && audioResult.duration < 1.1, JSON.stringify(audioResult));
  assert.ok(audioResult.seekPosition > 0.7, JSON.stringify(audioResult));
  assert.equal(audioResult.completed, true);
  try {
    for (const sample of localTracks) {
      const result = await window.evaluate(async ({ type, bytes }) => {
        const binary = atob(bytes);
        const data = Uint8Array.from(binary, character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([data], { type }));
        const player = new Audio(url);
        const failed = new Promise((_, reject) => player.addEventListener('error', () => reject(new Error(`Audio decode error: ${player.error?.code}`)), { once: true }));
        const metadata = await Promise.race([
          new Promise(resolve => player.addEventListener('loadedmetadata', () => resolve(player.duration), { once: true })), failed,
        ]);
        const seeked = new Promise(resolve => player.addEventListener('seeked', () => resolve(player.currentTime), { once: true }));
        player.currentTime = metadata * 0.65;
        const seekPosition = await seeked;
        const ended = new Promise(resolve => player.addEventListener('ended', () => resolve(true), { once: true }));
        await player.play();
        const completed = await Promise.race([ended, failed]);
        player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url);
        return { duration: metadata, seekPosition, completed };
      }, sample);
      assert.ok(result.duration > 3.9 && result.duration < 4.1, JSON.stringify(result));
      assert.ok(result.seekPosition > 2.5, JSON.stringify(result));
      assert.equal(result.completed, true);
    }
  } finally { await rm(mediaDir, { recursive: true, force: true }); }
  console.log('Electron smoke passed: renderer boundary; one app Audio instance survived favorites rerender during playback; app controls completed local MP3 -> seek -> FLAC -> ended; standalone HTMLAudioElement WAV/MP3/FLAC metadata, seek, ended. Huawei CDN/authorization remains untested.');
} finally {
  try {
    if (app) await app.close();
  } finally {
    await Promise.all([
      rm(profileDir, { recursive: true, force: true }),
      rm(mediaDir, { recursive: true, force: true }),
      new Promise(resolve => redirectServer.close(resolve)),
    ]);
  }
}
