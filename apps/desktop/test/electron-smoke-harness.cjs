const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { readFileSync, mkdirSync } = require('node:fs');
const { resolve, join, dirname, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');

// Test-only entry point: no production flags are added and physical lockdown cannot run.
const workspace = resolve(process.cwd(), 'tmp') + sep;
const profile = resolve(process.env.LOCKEDSCREEN_SMOKE_PROFILE || 'invalid');
const archive = resolve(process.env.LOCKEDSCREEN_SMOKE_ARCHIVE || 'invalid');
if (!profile.startsWith(workspace) || !archive.endsWith('app.asar')) throw new Error('Invalid smoke-test paths');
mkdirSync(profile, { recursive: true });
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => setPath(name, name === 'userData' ? profile : value);
app.setPath('userData', profile);
const spawn = childProcess.spawn;
childProcess.spawn = (file, args, ...options) => {
  if (/Lockedscreen\.Security\.(Agent|Client|Service)\.exe$/i.test(file) && args?.[0] !== 'status') {
    throw new Error('Physical native lockdown is disabled in this smoke test');
  }
  return spawn(file, args, ...options);
};
syncBuiltinESMExports();
for (const method of ['show', 'showInactive', 'focus', 'moveTop']) BrowserWindow.prototype[method] = function () {};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, ['session:begin', 'session:launchAlternateDesktop', 'applications:launch'].includes(channel)
  ? async () => { throw new Error('Physical lockdown/external applications are disabled in this smoke test'); } : listener);
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.lockedscreenSmokeImportFile] });
dialog.showSaveDialog = async () => { throw new Error('Unexpected save dialog in smoke test'); };
dialog.showErrorBox = (_title, message) => { console.error(message); app.exit(2); };
shell.openExternal = async () => { throw new Error('External browser launch is disabled in smoke test'); };
const pkg = JSON.parse(readFileSync(join(archive, 'package.json'), 'utf8'));
globalThis.lockedscreenSmokePaths = {
  preload: join(archive, dirname(pkg.main), '../preload/index.cjs')
};
import(pathToFileURL(join(archive, pkg.main)).href).catch(error => { console.error(error); app.exit(2); });
