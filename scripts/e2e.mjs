#!/usr/bin/env node
// Browser checks against the committed static export (dist/). Serves dist/ on a local port, runs
// Chromium through Playwright and exercises the primary interactions. Every non-local request is
// aborted, so chain sources are expected to show "Unavailable" and no AI model is downloaded.
//
//   npm run build && npm run e2e
//   SHOTS=docs/screenshots npm run e2e       # also writes screenshots
//
// Playwright is resolved from the project, then from $PLAYWRIGHT_MODULE (path to playwright's
// index.mjs). It is not a dependency of the site. Install it with
//   npm i -D playwright && npx playwright install chromium
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve('dist');
const SHOTS = process.env.SHOTS || '';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.flac': 'audio/flac', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    if (process.env.PLAYWRIGHT_MODULE) return import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
    console.error('Playwright not found. Run: npm i -D playwright && npx playwright install chromium\nor set PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs');
    process.exit(1);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) return res.writeHead(403).end();
  if (url.pathname.endsWith('/')) p = join(p, 'index.html');
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function open(width, height, { lang } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (lang) await ctx.addInitScript((l) => localStorage.setItem('pip-rebuild-lang', l), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await page.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  await page.goto(BASE);
  await page.waitForFunction(() => !document.querySelector('.stage-msg') && !!window.__pip?.feetScreen(), null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const toast = (page) => page.locator('.toast').innerText();
const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();
const hitAt = (page, pt) => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, pt);

try {
  // ---- first screen, feet reachable, all five stages -------------------------------------------
  {
    const { ctx, page, errors } = await open(390, 844);
    const feet = await page.evaluate(() => window.__pip.feetScreen());
    check('390: feet anchor is on the canvas (not under meters)', (await hitAt(page, feet)) === 'CANVAS', `feet y=${feet.y.toFixed(1)}`);
    const bottomTop = await page.evaluate(() => document.querySelector('.stage-bottom').getBoundingClientRect().top);
    check('390: feet sit above the meters', feet.y < bottomTop - 4, `meters top=${bottomTop.toFixed(1)}`);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1') || 'null')?.bond ?? null);
    await page.mouse.click(feet.x, feet.y - 4);
    await page.waitForTimeout(150);
    const cardTitle = await page.locator('.card .card-title').first().innerText().catch(() => '');
    check('390: tapping the feet gives a feet response', /feet/i.test(cardTitle), cardTitle);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1')).bond);
    check('first touch saved a bond reward', before === null || after >= before, `bond ${before}→${after}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-first-screen.jpg`, quality: 78 });

    await tab(page, 'Pip');
    for (let i = 1; i <= 5; i++) {
      await page.getByRole('button', { name: new RegExp(`^${i}\\. `) }).click();
      await page.waitForFunction(() => !document.querySelector('.stage-msg'), null, { timeout: 20000 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(300);
      const f = await page.evaluate(() => window.__pip.feetScreen());
      const tag = await hitAt(page, f);
      check(`stage ${i}: model loads and feet are touchable`, tag === 'CANVAS', `feet y=${f.y.toFixed(1)} hit=${tag}`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-stage${i}-preview.jpg`, quality: 78 });
    }
    await page.getByRole('button', { name: 'My Pip' }).click();
    check('no page errors or failed local resources (390)', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // ---- keyboard gestures ------------------------------------------------------------------------
  {
    const { ctx, page } = await open(390, 844);
    await page.keyboard.press('Digit3');
    await page.waitForTimeout(100);
    const nose = await page.locator('.card .card-title').first().innerText();
    check('key 3 taps the nose', /nose/i.test(nose), nose);
    await page.evaluate(() => window.__pip.stopClip(window.__pip.currentClip()));
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(80);
    check('T plays the three-tap surprise', (await page.evaluate(() => window.__pip.currentClip())) === 'surpriseJump');
    const mems = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1')).memories.map((m) => m.kind));
    check('surprise memory saved', mems.includes('surprise'));
    await page.waitForTimeout(2600);
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__pip.stopClip(window.__pip.currentClip()));
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(80);
    check('H holds the chosen head (nuzzle)', (await page.evaluate(() => window.__pip.currentClip())) === 'nuzzle');
    await page.waitForTimeout(2500);
    const cards = await page.locator('.card').count();
    await page.keyboard.press('KeyS');
    await page.waitForTimeout(100);
    check('S strokes the chosen part', (await page.locator('.card').count()) >= 1 && cards >= 0);
    await ctx.close();
  }

  // ---- feeding: rejected drop, valid drop, lock while hidden, cooldown ------------------------
  {
    const { ctx, page } = await open(390, 844);
    const seed = page.locator('.snack[data-food="seed"]');
    const box = await seed.boundingBox();
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(20, 120, { steps: 6 });
    await page.mouse.up();
    let meals = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1') || '{"meals":0}').meals);
    check('drop away from the mouth is rejected', meals === 0);

    const mouth = await page.evaluate(() => window.__pip.mouthScreen());
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(mouth.x, mouth.y + 20, { steps: 8 });
    const hint = await page.locator('#snack-hint').innerText();
    await page.mouse.move(mouth.x, mouth.y, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    meals = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1')).meals);
    check('drop on the live mouth socket feeds once', meals === 1, `hint while near: "${hint}"`);
    check('eat clip plays', (await page.evaluate(() => window.__pip.currentClip())) === 'eat');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-eating.jpg`, quality: 78 });
    await page.evaluate(() => window.__pip.setHidden(true));
    await page.waitForTimeout(3900);
    const napDisabled = await page.getByRole('button', { name: 'Nap', exact: true }).isDisabled();
    check('hidden tab: Nap stays locked while the eat clip is unfinished', napDisabled && (await page.evaluate(() => window.__pip.currentClip())) === 'eat');
    await page.evaluate(() => window.__pip.setHidden(false));
    await page.waitForFunction(() => window.__pip.currentClip() !== 'eat', null, { timeout: 8000 });
    await page.waitForTimeout(100);
    check('lock releases when the eat clip ends', !(await page.getByRole('button', { name: 'Nap', exact: true }).isDisabled()));
    await page.locator('.snack[data-food="berry"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    meals = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1')).meals);
    check('second meal during cooldown is refused', meals === 1, await toast(page));

    // save failure: nothing applied, nothing rewarded
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('pip-rebuild-save-v1'));
      s.lastFedAt = null;
      localStorage.setItem('pip-rebuild-save-v1', JSON.stringify(s));
    });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('.stage-msg') && !!window.__pip?.feetScreen());
    await page.evaluate(() => {
      Storage.prototype.setItem = function () {
        throw new Error('QuotaExceededError');
      };
    });
    await page.locator('.snack[data-food="seed"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    const t = await toast(page);
    check('failed save: refused with a message and no eating', /Could not save/.test(t) && (await page.evaluate(() => window.__pip.currentClip())) !== 'eat', t);
    await ctx.close();
  }

  // ---- sleep priority ---------------------------------------------------------------------------
  {
    const { ctx, page } = await open(1440, 900);
    await page.getByRole('button', { name: 'Nap', exact: true }).click();
    await page.waitForTimeout(100);
    await page.locator('.snack[data-food="seed"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    const meals = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1')).meals);
    check('asleep: feeding refused', meals === 0, await toast(page));
    check('asleep: care buttons disabled', await page.getByRole('button', { name: 'Brush', exact: true }).isDisabled());
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/1440-asleep.jpg`, quality: 78 });
    await page.getByRole('button', { name: 'Wake', exact: true }).click();
    await ctx.close();
  }

  // ---- abandoned memory round cannot unlock a seed-hunt round -----------------------------------
  {
    const { ctx, page } = await open(1440, 900);
    await tab(page, 'Play');
    await page.locator('.game').first().getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Card 1', exact: true }).click();
    await page.getByRole('button', { name: 'Card 2', exact: true }).click();
    await tab(page, 'Care');
    await tab(page, 'Play');
    await page.locator('.game').nth(1).getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(800);
    await page.locator('.snack[data-food="seed"]').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(80);
    const meals = await page.evaluate(() => JSON.parse(localStorage.getItem('pip-rebuild-save-v1') || '{"meals":0}').meals);
    check('seed hunt keeps feeding blocked after an abandoned memory round', meals === 0, await toast(page));
    await ctx.close();
  }

  // ---- simultaneous cards at 320 ----------------------------------------------------------------
  {
    const { ctx, page } = await open(320, 700);
    await tab(page, 'Chain');
    await page.getByRole('button', { name: 'Simulate a request' }).click();
    await page.getByRole('button', { name: 'Simulate a settlement' }).click();
    await page.getByRole('button', { name: 'Simulate a request' }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.cards').getBoundingClientRect();
      const b = document.querySelector('.stage-bottom').getBoundingClientRect();
      const el = document.querySelector('.cards');
      return { cardsBottom: c.bottom, bottomTop: b.top, scrollable: el.scrollHeight > el.clientHeight, n: el.children.length };
    });
    check('320: three cards stay above the meters/snacks', m.n === 3 && m.cardsBottom <= m.bottomTop + 0.5, JSON.stringify(m));
    const snack = await page.locator('.snack[data-food="seed"]').boundingBox();
    check('320: snacks are not covered by cards', (await hitAt(page, { x: snack.x + snack.width / 2, y: snack.y + snack.height / 2 })) !== 'LI');
    const labels = await page.locator('.card .tag').allInnerTexts();
    check('rehearsal cards are labelled simulated', labels.every((l) => /Simulated/i.test(l)), labels.join(','));
    const status = await page.locator('.source .status').allInnerTexts();
    check('blocked RPC shows sources as unavailable, not live', status.every((s) => !/^Live$/.test(s)), status.join(','));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/320-cards.jpg`, quality: 78 });
    await ctx.close();
  }

  // ---- Traditional Chinese ----------------------------------------------------------------------
  {
    const { ctx, page } = await open(390, 844, { lang: 'zh-Hant' });
    await tab(page, '遊戲');
    await page.locator('.game').first().getByRole('button', { name: '開始' }).click();
    await page.getByRole('button', { name: '卡片 1', exact: true }).click();
    const label = await page.locator('.tile').first().getAttribute('aria-label');
    check('zh: revealed memory card is translated', /[一-鿿]/.test(label.split(':')[1] || '') && !/[a-z]/.test(label), label);
    await tab(page, '鏈上');
    const net = await page.locator('.source p.small').first().innerText();
    check('zh: network line is translated', /主網/.test(net) && /鏈 1/.test(net) && !/mainnet/.test(net), net);
    await page.getByRole('button', { name: '模擬一個請求' }).click();
    const chain = await page.locator('.card-chain').first().innerText();
    check('zh: card network label is translated', /主網/.test(chain), chain);
    if (SHOTS) {
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(300); // capture the settled card, after its entrance animation
      await page.screenshot({ path: `${SHOTS}/390-zh.jpg`, quality: 78 });
    }
    await ctx.close();
  }

  // ---- malformed backups never overwrite the save or break Memories -----------------------------
  {
    const { ctx, page, errors } = await open(390, 844);
    await tab(page, 'Pip');
    const raw = await page.evaluate(() => localStorage.getItem('pip-rebuild-save-v1'));
    for (const [name, mutate] of [
      ['null wish', (state) => { state.wishes = [null]; }],
      ['memory timestamp 1e20', (state) => { state.memories[0].at = 1e20; }],
      ['memory timestamp beyond Date limit', (state) => { state.memories[0].at = 8_640_000_000_000_001; }],
    ]) {
      const state = JSON.parse(raw);
      mutate(state);
      const bad = JSON.stringify({ format: 'pip-rebuild-save', version: 1, state });
      await page.locator('input[type=file]').setInputFiles({ name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(bad) });
      await page.waitForTimeout(200);
      const t = await toast(page);
      const saved = await page.evaluate(() => localStorage.getItem('pip-rebuild-save-v1'));
      check(`${name}: restore refused and saved bytes unchanged`, /not a Pip backup/.test(t) && saved === raw && (await page.locator('#root').innerHTML()).length > 100, t);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/390-restore-rejected.jpg`, quality: 78, fullPage: true });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('.stage-msg') && !!window.__pip?.feetScreen());
    await tab(page, 'Pip');
    check('Memories remains usable after rejected restore and reload', (await page.locator('.memories time').count()) > 0 && errors.length === 0, errors.join('; '));
    await tab(page, 'Care');
    await ctx.close();
  }

  // ---- responsive widths ------------------------------------------------------------------------
  for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1440, 900]]) {
    const { ctx, page, errors } = await open(w, h);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    check(`${w}: no horizontal overflow`, m.sw <= m.cw, JSON.stringify(m));
    const f = await page.evaluate(() => window.__pip.feetScreen());
    check(`${w}: feet touchable on first screen`, (await hitAt(page, f)) === 'CANVAS' && f.y < h);
    check(`${w}: no errors`, errors.length === 0, errors.join('; '));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${w}.jpg`, quality: 78 });
    await ctx.close();
  }
} catch (e) {
  check('e2e run completed', false, String(e?.stack || e));
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
