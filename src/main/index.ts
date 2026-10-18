import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, session, Tray } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpc } from './ipc';
import { AuthManager } from './auth-manager';
import { createAuthManagerLifecycle } from './auth-manager-lifecycle.mjs';
import { applyNodeProxy, electronBypassRules, proxyConfigurationProblem, proxyRules, readProxySettings } from './proxy.mjs';
import { shouldBlockMediaRequest } from '../safe-media-url.mjs';
import { loadSettings } from './storage';
import { TRAY_ICON_PNG_BASE64, TRAY_MAC_TEMPLATE_1X_PNG_BASE64, TRAY_MAC_TEMPLATE_2X_PNG_BASE64 } from './icons';
import { APP_DISPLAY_NAME } from '../shared/app-name.mjs';
import type { AppSettings } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let closeBehavior: AppSettings['closeBehavior'] = 'quit';
const rendererUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
const authManagerLifecycle = createAuthManagerLifecycle(async () => {
  const auth = new AuthManager(message => mainWindow?.webContents.send('auth:progress', message),
    () => session.defaultSession.clearStorageData({ storages: ['localstorage', 'indexdb', 'cachestorage'] }),
    // The official login page is embedded in the main window, so the window must outlive the flow.
    () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null));
  await auth.restore();
  return auth;
});

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) app.quit();

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1180, height: 760, minWidth: 960, minHeight: 640,
    title: APP_DISPLAY_NAME,
    // No in-window menu bar on Windows/Linux; the menu is removed below.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  mainWindow = window;
  window.once('closed', () => { if (mainWindow === window) mainWindow = null; });
  // Default is a real quit; hiding to the tray only happens when the user opts in.
  window.on('close', event => {
    if (quitting || closeBehavior !== 'tray' || !tray) return;
    event.preventDefault();
    window.hide();
  });
  try {
    const auth = await authManagerLifecycle.get();
    if (window.isDestroyed()) return;
    registerIpc(window, auth, { onCloseBehavior: value => { closeBehavior = value; } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    const blockUntrustedNavigation = (event: Electron.Event, url: string) => {
      if (url !== rendererUrl) event.preventDefault();
    };
    window.webContents.on('will-navigate', blockUntrustedNavigation);
    window.webContents.on('will-redirect', blockUntrustedNavigation);
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
}

function sendPlayerCommand(command: 'play-pause' | 'next' | 'previous'): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('player:command', command);
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow().catch(() => failStartup('应用启动失败', '无法重新创建应用窗口。请重启应用后重试。'));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  try {
    const image = process.platform === 'darwin'
      ? nativeImage.createFromBuffer(Buffer.from(TRAY_MAC_TEMPLATE_1X_PNG_BASE64, 'base64'), { scaleFactor: 1 })
      : nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG_BASE64}`);
    if (process.platform === 'darwin') {
      image.addRepresentation({ scaleFactor: 2, buffer: Buffer.from(TRAY_MAC_TEMPLATE_2X_PNG_BASE64, 'base64') });
      image.setTemplateImage(true);
    }
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
    tray.setToolTip(APP_DISPLAY_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: showMainWindow },
      { type: 'separator' },
      { label: '播放 / 暂停', click: () => sendPlayerCommand('play-pause') },
      { label: '上一首', click: () => sendPlayerCommand('previous') },
      { label: '下一首', click: () => sendPlayerCommand('next') },
      { type: 'separator' },
      { label: '退出程序', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showMainWindow);
  } catch {
    // Some Linux desktops have no tray host; keep the normal window/quit behaviour.
    tray = null;
  }
}

// The default Electron menu (File/Edit/View/Window) is not this app's UI. Windows/Linux get no
// menu bar at all; macOS keeps only the minimal standard roles so Cmd+Q / copy / paste still work.
function configureApplicationMenu(): void {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function registerMediaKeys(): void {
  const bindings: [Electron.Accelerator, 'play-pause' | 'next' | 'previous'][] = [
    ['MediaPlayPause', 'play-pause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
  ];
  for (const [accelerator, command] of bindings) {
    try { globalShortcut.register(accelerator, () => sendPlayerCommand(command)); } catch { /* Unsupported on this platform. */ }
  }
}

function failStartup(title: string, message: string): void {
  dialog.showErrorBox(title, message);
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createWindow().catch(() => failStartup('应用启动失败', '无法重新创建应用窗口。请重启应用后重试。'));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!hasSingleInstance) return;
  const proxyProblem = proxyConfigurationProblem();
  if (proxyProblem) {
    const detail = proxyProblem === 'unsupported'
      ? '检测到不支持的代理协议；当前仅支持 HTTP/HTTPS 代理。'
      : proxyProblem === 'credentials'
        ? '检测到带认证信息的代理；当前版本不支持代理认证。'
      : '检测到无法识别的代理配置。';
    dialog.showErrorBox('代理配置错误', `${detail}\n为避免绕过代理，本次不会直连网络。请修正进程代理环境变量后重启。`);
    app.quit();
    return;
  }
  const proxy = readProxySettings();
  applyNodeProxy(proxy);
  const settingsReady = loadSettings().then(settings => { closeBehavior = settings.closeBehavior; });
  configureApplicationMenu();
  createTray();
  registerMediaKeys();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: shouldBlockMediaRequest(details.resourceType, details.url) });
  });
  const rules = proxyRules(proxy);
  void Promise.all([settingsReady,
    rules ? session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: rules, proxyBypassRules: electronBypassRules(proxy.bypass) }) : Promise.resolve(),
  ])
    .then(() => createWindow().catch(() => {
      failStartup('应用启动失败', '无法初始化应用窗口。请检查本机应用数据目录权限后重启。');
    }))
    .catch(() => failStartup('代理配置失败', '无法应用当前 HTTP(S) 代理配置。为避免绕过代理，本次不会直连网络。请检查代理设置后重启。'));
  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      void createWindow().catch(() => failStartup('应用启动失败', '无法重新创建应用窗口。请重启应用后重试。'));
    }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});
