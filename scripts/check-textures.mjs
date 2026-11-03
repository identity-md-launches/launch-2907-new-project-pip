// Production-export regression and repeatable post-publication check. No visitor profile,
// wallet, persistent browser directory, save import or TLS bypass is used.
// PLAYWRIGHT_MODULE=/tmp/.../playwright/index.mjs node scripts/check-textures.mjs
// SHOTS=docs/screenshots REPORT=docs/texture-results.json node scripts/check-textures.mjs
// node scripts/check-textures.mjs --url https://<canonical-public-url>/
// --legacy reproduces the OLD public defect and probes its embedded image bytes directly.
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { PUBLICATION_CSP } from './publication-policy.mjs';

const args = process.argv.slice(2);
const remote = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const legacy = args.includes('--legacy');
if (remote && new URL(remote).protocol !== 'https:') throw new Error('Public verification requires a normal HTTPS URL');
const engines = args.includes('--browser') ? [args[args.indexOf('--browser') + 1]] : ['chromium', 'webkit'];
if (engines.some((name) => !['chromium', 'webkit'].includes(name))) throw new Error('--browser must be chromium or webkit');
const shots = process.env.SHOTS;
const reportPath = process.env.REPORT;
const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.flac': 'audio/flac' };
const results = { date: new Date().toISOString(), target: remote || 'exact dist/ at /preview/ with observed publication CSP', legacy, browsers: [], checks: [] };
const check = (name, value, detail) => {
  results.checks.push({ name, pass: !!value, ...(detail === undefined ? {} : { detail }) });
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`);
  assert.ok(value, `${name}: ${JSON.stringify(detail)}`);
};
const hash = (b) => createHash('sha256').update(b).digest('hex');
let server;
let base = remote;
if (!remote) {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (!pathname.startsWith('/preview/')) return res.writeHead(404).end();
      const file = resolve(root, pathname.slice('/preview/'.length) || 'index.html');
      if (!file.startsWith(root + '/')) return res.writeHead(403).end();
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': PUBLICATION_CSP, 'X-Content-Type-Options': 'nosniff' }).end(bytes);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/preview/`;
}
if (!base.endsWith('/')) base += '/';
if (shots) await mkdir(shots, { recursive: true });
const pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const stageNames = ['Tiny bean', 'Milk mochi', 'Curious baby', 'Lively youngster', 'Little guardian'];

// Read the actual installed material images AND pixels from an actual rendered frame.
async function inspect(page) {
  return page.evaluate(() => {
    const s = window.__pip, m = s?.mesh;
    if (!m) return { mesh: false };
    const mat = m.material;
    const maps = Object.fromEntries(['map', 'normalMap', 'roughnessMap', 'metalnessMap'].map((k) => [k, {
      present: !!mat[k], width: mat[k]?.image?.width, height: mat[k]?.image?.height, colorSpace: mat[k]?.colorSpace,
    }]));
    const count = (data, stride) => {
      let golden = 0, dark = 0, opaque = 0;
      for (let i = 0; i < data.length; i += stride) {
        const [r, g, b, a] = data.subarray(i, i + 4);
        if (a < 200) continue;
        opaque++;
        if (r > 85 && r > g * 1.12 && g > b * 1.15) golden++;
        if (r < 65 && g < 65 && b < 65) dark++;
      }
      return { golden, dark, opaque };
    };
    let atlas;
    if (mat.map?.image) {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d'); ctx.drawImage(mat.map.image, 0, 0, 128, 128);
      atlas = count(ctx.getImageData(0, 0, 128, 128).data, 4);
    }
    // Render and read within one task: preserveDrawingBuffer is intentionally not enabled.
    s.renderer.render(s.scene, s.camera);
    const gl = s.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { mesh: true, maps, atlas, rendered: count(pixels, 16), flatShading: mat.flatShading,
      vertices: m.geometry.getAttribute('position').count, normals: m.geometry.getAttribute('normal')?.count,
      material: mat.uuid, message: document.querySelector('.stage-msg')?.textContent || null,
      normalVersion: m.geometry.getAttribute('normal').version, ready: s.isReady?.(), stage: s.stage,
      label: document.querySelector('.stage-name').textContent };
  });
}
function textured(name, state) {
  check(`${name}: four decoded maps, correct colour spaces and smooth normals`, state.mesh && state.ready &&
    Object.entries(state.maps).every(([k, v]) => v.present && v.width === 1024 && v.height === 1024 && v.colorSpace === (k === 'map' ? 'srgb' : '')) &&
    state.normals === state.vertices && !state.flatShading, state);
  check(`${name}: golden fur and dark facial pixels in atlas and rendered frame`, state.atlas.golden > 1000 && state.atlas.dark > 20 &&
    state.rendered.golden > 200 && state.rendered.dark > 20, { atlas: state.atlas, rendered: state.rendered });
}
async function ready(page, stage = 0) {
  await page.waitForFunction((expected) => document.querySelector('.stage')?.getAttribute('data-load') === 'ok' && window.__pip?.isReady() && window.__pip?.stage === expected, stage, { timeout: 30000 });
}
async function snap(page, name) {
  if (shots) await page.screenshot({ path: join(shots, name + '.jpg'), type: 'jpeg', quality: 76 });
}
async function files(dir, prefix = '') {
  const all = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) all.push(...await files(join(dir, entry.name), name + '/'));
    else all.push(name);
  }
  return all;
}

let failed = false;
try {
  for (const engine of engines) {
    const browser = await pw[engine].launch(engine === 'chromium' ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {});
    results.browsers.push({ engine, version: browser.version() });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [], violations = [], badNetwork = [], delivered = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error' && /texture|decode|content security|blob:|WebGL|shader/i.test(m.text())) errors.push(m.text()); });
      page.on('requestfailed', (r) => { if (r.url().startsWith(base)) badNetwork.push(r.url()); });
      page.on('response', (r) => { if (r.url().startsWith(base)) { delivered.push({ url: r.url(), status: r.status() }); if (r.status() >= 400) badNetwork.push(`${r.status()} ${r.url()}`); } });
      await page.exposeFunction('texturePolicyViolation', (v) => violations.push(v));
      await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.texturePolicyViolation({ directive: e.effectiveDirective, blocked: e.blockedURI })));
      // Local validation is offline for optional AI/RPC. Public mode leaves networking normal.
      if (!remote) await page.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
      const response = await page.goto(base);
      check(`${engine}: HTML response and policy observed`, response.ok(), { status: response.status(), csp: response.headers()['content-security-policy'], tls: await response.securityDetails() });
      if (remote && !legacy) {
        const expectedHtmlSha256 = hash(await readFile(join(root, 'index.html')));
        const receivedHtmlSha256 = hash(await response.body());
        check(`${engine}: canonical URL serves this export`, receivedHtmlSha256 === expectedHtmlSha256, { expectedHtmlSha256, receivedHtmlSha256 });
      }
      if (legacy) {
        await page.waitForFunction(() => !!window.__pip?.mesh);
        await page.waitForTimeout(500);
        const state = await inspect(page);
        check(`${engine}: old export material state observed (Chromium reproduces the defect)`, engine !== 'chromium' || (!state.maps.map.present && !state.message), state);
        const probe = await page.evaluate(async () => {
          const bytes = await (await fetch(new URL('models/01-tiny-bean.glb', location.href))).arrayBuffer();
          const v = new DataView(bytes), n = v.getUint32(12, true);
          const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, n)));
          const decoded = [];
          for (const image of json.images) {
            const b = json.bufferViews[image.bufferView];
            const bitmap = await createImageBitmap(new Blob([bytes.slice(28 + n + (b.byteOffset || 0), 28 + n + (b.byteOffset || 0) + b.byteLength)], { type: image.mimeType }));
            decoded.push({ format: image.mimeType, width: bitmap.width, height: bitmap.height }); bitmap.close();
          }
          return decoded;
        });
        check(`${engine}: embedded WebP bytes decode directly without blob fetch`, probe.length === 3 && probe.every((im) => im.width === 1024), probe);
        check(`${engine}: old policy behaviour observed (Chromium blocks blob fetches)`, engine !== 'chromium' || violations.some((v) => v.directive === 'connect-src' && v.blocked.startsWith('blob')), violations);
        await snap(page, `${engine}-public-before`);
        await context.close();
        continue;
      }
      await ready(page);
      textured(`${engine} first screen`, await inspect(page));
      check(`${engine}: first phone screen contains Pip and snacks`, await page.locator('.snack').last().evaluate((el) => el.getBoundingClientRect().bottom <= 844));
      await snap(page, `${engine}-390`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('tab', { name: 'Pip', exact: true }).click();
      const saved = await page.evaluate(() => localStorage.getItem('pip-rebuild-save-v1'));
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: new RegExp(`^${i + 1}\\. `) }).click();
        await ready(page, i);
        await page.evaluate(() => scrollTo(0, 0));
        await page.waitForTimeout(250);
        const state = await inspect(page);
        textured(`${engine} stage ${i + 1} ${stageNames[i]}`, state);
        check(`${engine} stage ${i + 1}: correct preview label`, state.stage === i && state.label.startsWith(stageNames[i]), state.label);
        await snap(page, `${engine}-stage${i + 1}`);
      }
      // Exercise stale-load isolation while changing models quickly.
      await page.getByRole('button', { name: /^1\. / }).click();
      await page.getByRole('button', { name: /^5\. / }).click();
      await page.getByRole('button', { name: /^2\. / }).click();
      await ready(page, 1);
      check(`${engine}: rapid switches settle on requested model`, (await inspect(page)).stage === 1);
      check(`${engine}: preview never writes the visitor save`, await page.evaluate(() => localStorage.getItem('pip-rebuild-save-v1')) === saved);
      await page.getByRole('button', { name: 'My Pip', exact: true }).click();
      await ready(page);
      await page.getByRole('tab', { name: 'Care', exact: true }).click();
      await page.evaluate(() => scrollTo(0, 0));
      await snap(page, `${engine}-desktop`);
      const before = await inspect(page);
      const foot = await page.evaluate(() => window.__pip.feetScreen());
      await page.mouse.click(foot.x, foot.y - 4);
      await page.waitForFunction(() => document.querySelector('.card-title')?.textContent.toLowerCase().includes('feet'));
      textured(`${engine} after direct petting`, await inspect(page));
      // Turn mode changes the mesh orientation, then return it to feed at the live socket.
      await page.getByRole('button', { name: 'Turn', exact: true }).click();
      const yaw = await page.evaluate(() => window.__pip.turnYaw);
      await page.mouse.move(foot.x, foot.y - 70); await page.mouse.down();
      await page.mouse.move(foot.x + 70, foot.y - 70, { steps: 7 }); await page.mouse.up();
      check(`${engine}: direct dragging turns Pip`, await page.evaluate(() => window.__pip.turnYaw) !== yaw);
      await page.getByRole('button', { name: 'Pet', exact: true }).click();
      await page.evaluate((original) => window.__pip.turnBy(original - window.__pip.turnYaw), yaw);
      const snack = await page.locator('.snack[data-food="seed"]').boundingBox();
      await page.mouse.move(snack.x + snack.width / 2, snack.y + snack.height / 2); await page.mouse.down();
      const mouth = await page.evaluate(() => window.__pip.mouthScreen());
      await page.mouse.move(mouth.x, mouth.y, { steps: 8 }); await page.mouse.up();
      await page.waitForFunction(() => window.__pip.currentClip() === 'eat');
      textured(`${engine} while nibbling`, await inspect(page));
      check(`${engine}: deformation keeps the installed material and normals`, (await inspect(page)).material === before.material && (await inspect(page)).normalVersion === before.normalVersion);
      await snap(page, `${engine}-nibbling`);
      check(`${engine}: no relevant console, CSP or asset failures`, !errors.length && !violations.length && !badNetwork.length, { errors, violations, badNetwork });
      check(`${engine}: fifteen external WebP requests delivered`, new Set(delivered.filter((r) => r.url.endsWith('.webp') && r.status === 200).map((r) => r.url)).size === 15);

      // Confirm the live publication is exactly this complete export, not just a 200 homepage.
      if (remote && engine === 'chromium') {
        for (const file of await files(root)) {
          const r = await context.request.get(new URL(file, base).href);
          check(`published bytes: ${file}`, r.ok() && hash(await r.body()) === hash(await readFile(join(root, file))));
        }
      }
      await context.close();
      // A corrupt image must produce an actionable error, no ready hamster, no saved meal;
      // after restoring the response Retry must load fully. Repeat for all three image roles.
      if (!remote) for (const [index, role] of ['basecolor', 'normal', 'rm', 'basecolor'].entries()) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
        if (index === 1) await ctx.addInitScript(() => localStorage.setItem('pip-rebuild-lang', 'zh-Hant'));
        const p = await ctx.newPage();
        let corrupt = true;
        await p.route('**/*', (route) => {
          if (corrupt && route.request().url().endsWith(`-${role}.webp`)) return route.fulfill({ status: index === 3 ? 404 : 200, contentType: 'image/webp', body: 'not a valid image' });
          return route.request().url().startsWith(base) ? route.continue() : route.abort();
        });
        await p.goto(base);
        await p.waitForFunction(() => document.querySelector('.stage')?.getAttribute('data-load') === 'failed');
        check(`${engine}: ${index === 3 ? 'HTTP 404' : 'corrupt'} ${role} refuses ready and feeding`, await p.evaluate(() => !window.__pip.isReady() && !window.__pip.mouthScreen() && [...document.querySelectorAll('.snack')].every((s) => s.disabled)));
        check(`${engine}: ${index === 1 ? 'Traditional Chinese' : 'English'} error explains retry`, /textures|貼圖/.test(await p.locator('.stage-msg').innerText()));
        await p.locator('.stage-msg button').focus();
        await p.keyboard.press('Shift+Tab');
        await p.keyboard.press('Tab');
        if (index === 1) await snap(p, `${engine}-error-zh`);
        const raw = await p.evaluate(() => localStorage.getItem('pip-rebuild-save-v1'));
        corrupt = false;
        await p.locator('.stage-msg button').focus();
        await p.keyboard.press('Enter');
        await ready(p);
        textured(`${engine} ${role} retry`, await inspect(p));
        check(`${engine}: retry preserves save bytes`, await p.evaluate(() => localStorage.getItem('pip-rebuild-save-v1')) === raw);
        await ctx.close();
      }
    } finally { await browser.close(); }
  }
} catch (e) {
  failed = true;
  results.error = String(e.stack || e).replaceAll(process.cwd(), '.').replace(/\u001b\[[0-9;]*m/g, '');
  console.error(results.error);
} finally {
  if (server) await new Promise((r) => server.close(r));
  results.passed = results.checks.filter((c) => c.pass).length;
  results.failed = results.checks.filter((c) => !c.pass).length + (failed && results.checks.every((c) => c.pass) ? 1 : 0);
  if (reportPath) await writeFile(reportPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`${results.passed} passed, ${results.failed} failed`);
}
process.exitCode = failed ? 1 : 0;
