// Runs the app for development: `npm run dev`.
// UI changes (renderer/) reload the window from inside the app; changes to main.js,
// preload.js or src/ restart the app here. Closing the window stops everything.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron'); // path to the Electron binary

const ROOT = path.join(__dirname, '..');
const RESTART_ON = /^(main\.js|preload\.js|src[\\/])/;

let child;
let restarting = false;
let timer;

function start() {
  child = spawn(electron, ['.', '--dev'], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => {
    if (restarting) {
      restarting = false;
      start();
    } else if (code) {
      // Crashed (e.g. a half-finished edit): wait for the next change instead of quitting.
      child = null;
      console.log(`[dev] The app exited with code ${code}. Waiting for a change to restart...`);
    } else {
      process.exit(0); // window closed
    }
  });
}

fs.watch(ROOT, { recursive: true }, (_event, file) => {
  if (!file || !RESTART_ON.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`[dev] ${file} changed, restarting the app...`);
    if (!child) return start();
    restarting = true;
    child.kill();
  }, 200);
});

console.log('[dev] Starting Terrarium Manager with live reload. Data folder: .dev-data');
start();
