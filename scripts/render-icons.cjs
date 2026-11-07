/**
 * Renders the app icon from build/icon.svg (and build/icon-small.svg for tiny
 * sizes) into PNG files and a multi-size Windows .ico, using Electron's own
 * Chromium so no extra tools are needed.
 *
 *   npm run icons
 *
 * Writes build/icon.png, build/icon.ico and resources/icon.png, plus the tray
 * icons resources/tray-16.png and resources/tray-32.png. `npm run icons -- --tray-only`
 * writes only the tray icons.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Keep Electron's caches for this one-off script in a temporary folder. Chromium still holds
// it open while quitting, so each run removes the leftovers of earlier runs instead.
for (const name of fs.readdirSync(os.tmpdir())) {
  if (name.startsWith('mjournal-icons-')) {
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      // Still in use; the next run will try again.
    }
  }
}
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'mjournal-icons-')));

const root = path.join(__dirname, '..');
const fullSvg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
const smallSvg = fs.readFileSync(path.join(root, 'build', 'icon-small.svg'), 'utf8');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

async function render(win, svg, size) {
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(source)};
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = ${size};
    canvas.height = ${size};
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    return canvas.toDataURL('image/png');
  })()`);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** An .ico file whose images are stored as PNG (supported since Windows Vista). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const trayOnly = process.argv.includes('--tray-only');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<!doctype html><title>icons</title>');

  // The tray (notification area) icon: the small drawing at 16 px, and at 32 px for high-density screens.
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'resources', 'tray-16.png'), await render(win, smallSvg, 16));
  fs.writeFileSync(path.join(root, 'resources', 'tray-32.png'), await render(win, smallSvg, 32));
  console.log('Wrote the tray icons.');
  if (trayOnly) {
    app.quit();
    return;
  }

  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(win, size <= 24 ? smallSvg : fullSvg, size) });
  const large = await render(win, fullSvg, 512);

  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), buildIco(images));
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), large);
  fs.writeFileSync(path.join(root, 'resources', 'icon.png'), images.find((i) => i.size === 256).png);
  console.log(`Wrote ${ICO_SIZES.length} icon sizes.`);

  // Optional contact sheet (ICON_PREVIEW=path.png) for checking small sizes by eye.
  if (process.env.ICON_PREVIEW) {
    const tiles = images
      .map(({ size, png }) => {
        const src = `data:image/png;base64,${png.toString('base64')}`;
        return `<figure><img src="${src}" width="${size}"><img src="${src}" width="${Math.max(size, 64) * 2}" style="image-rendering:pixelated"><figcaption>${size}</figcaption></figure>`;
      })
      .join('');
    const html = `<!doctype html><style>body{margin:0;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:12px;padding:12px}
      figure{margin:0;display:grid;gap:6px;justify-items:center;padding:8px;background:#f4efe9;border-radius:8px}
      figure:nth-child(even){background:#26212b;color:#eee}</style>${tiles}`;
    const sheet = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true } });
    await sheet.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(process.env.ICON_PREVIEW, (await sheet.webContents.capturePage()).toPNG());
  }
  app.quit();
});
