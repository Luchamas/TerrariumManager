// Renders build/icon.png (512x512) from the SVG below. Run with: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#E4F0E6"/>
      <stop offset="1" stop-color="#BFD6C5"/>
    </linearGradient>
    <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6B4A2E"/>
      <stop offset="1" stop-color="#4A3220"/>
    </linearGradient>
    <clipPath id="inside">
      <path d="M150 104h212v34c68 30 104 90 104 160v88c0 50-36 86-86 86H132c-50 0-86-36-86-86v-88c0-70 36-130 104-160z"/>
    </clipPath>
  </defs>
  <!-- cork -->
  <rect x="176" y="40" width="160" height="78" rx="18" fill="#B8976A"/>
  <rect x="176" y="96" width="160" height="22" fill="#9C7D55"/>
  <!-- jar -->
  <path d="M150 104h212v34c68 30 104 90 104 160v88c0 50-36 86-86 86H132c-50 0-86-36-86-86v-88c0-70 36-130 104-160z" fill="url(#glass)"/>
  <g clip-path="url(#inside)">
    <rect x="0" y="380" width="512" height="140" fill="url(#soil)"/>
    <rect x="0" y="366" width="512" height="22" fill="#8C9A5B"/>
    <path d="M256 380c0-90 26-150 116-176-8 90-50 138-116 150" fill="#3E7C4F"/>
    <path d="M256 380c0-66-26-110-96-128 0 66 34 102 96 112" fill="#5E9E6E"/>
    <path d="M256 384V300" stroke="#2E6340" stroke-width="10" stroke-linecap="round"/>
  </g>
  <path d="M150 104h212v34c68 30 104 90 104 160v88c0 50-36 86-86 86H132c-50 0-86-36-86-86v-88c0-70 36-130 104-160z" fill="none" stroke="#1F3A2E" stroke-width="16" stroke-linejoin="round"/>
  <!-- reflection -->
  <path d="M104 250c-10 30-12 70-8 110" fill="none" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="14" stroke-linecap="round"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${SVG}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.resize({ width: 512, height: 512 }).toPNG());
  console.log('Wrote', out);
  app.quit();
});
