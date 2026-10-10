import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errs.push('CONSOLE: ' + m.text());
});

await page.goto('https://shanghai-qiaoma-85962.app.workbuddy.host/', { waitUntil: 'load' });
await page.waitForTimeout(1500);

/** 用真实 touch 事件点击某张手牌 */
async function tapTile(i) {
  const pos = await page.evaluate((idx) => {
    const areas = window.__qm.areas().filter((a) => a.kind === 'hand');
    if (!areas[idx]) return null;
    const c = document.getElementById('board');
    const r = c.getBoundingClientRect();
    const g = window.__qm.game();
    // renderer 内部坐标 → 页面坐标
    const R = window.__qm.renderer();
    const kx = r.width / R.W, ky = r.height / R.H;
    return {
      px: r.left + (areas[idx].x + areas[idx].w / 2) * kx,
      py: r.top + (areas[idx].y + areas[idx].h / 2) * ky,
      tile: areas[idx].tile,
    };
  }, i);
  if (!pos) return null;
  await page.touchscreen.tap(pos.px, pos.py);
  return pos;
}

let steps = 0, games = 0;
while (steps < 400 && games < 2) {
  steps++;

  const st = await page.evaluate(() => {
    const g = window.__qm.game();
    return {
      done: document.getElementById('result').classList.contains('show'),
      phase: g.phase,
      turn: g.turn,
      btns: Array.from(document.querySelectorAll('#actions button')).map((b) => b.textContent),
      claimMine: g.phase === 'claim' && g.pending
        ? g.pending.options.filter((o) => o.player === 0).map((o) => o.type) : [],
    };
  });

  if (st.done) {
    const info = await page.evaluate(() => ({
      result: document.getElementById('result').textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
      scores: Array.from(document.querySelectorAll('.score-box')).map(
        (b) => b.querySelector('.name').textContent + '=' + b.querySelector('.val').textContent),
    }));
    console.log(`\n=== 第 ${games + 1} 局结束（${steps} 步）===`);
    console.log('结算:', info.result);
    console.log('得分:', info.scores.join(''));
    await page.tap('#actions button');
    await page.waitForTimeout(900);
    games++;
    continue;
  }

  if (st.claimMine.length > 0) {
    await page.evaluate((type) => {
      const g = window.__qm.game();
      const o = g.pending.options.find((x) => x.player === 0 && x.type === type);
      g.claim(0, { type: o.type, chow: o.chow });
    }, st.claimMine[0]);
    await page.waitForTimeout(250);
    continue;
  }

  if (st.turn === 0) {
    if (st.btns.length > 0) {
      const win = st.btns.findIndex((t) => t.startsWith('胡'));
      const kong = st.btns.findIndex((t) => t.includes('杠'));
      const qi = st.btns.findIndex((t) => t.startsWith('敲'));
      const pick = win >= 0 ? win : kong >= 0 ? kong : qi >= 0 ? qi : -1;
      if (pick >= 0) {
        await page.tap(`#actions button >> nth=${pick}`);
        await page.waitForTimeout(250);
        continue;
      }
    }
    const i = steps % 12;
    await tapTile(i);
    await page.waitForTimeout(70);
    await tapTile(i);
    await page.waitForTimeout(250);
    continue;
  }

  await page.waitForTimeout(200);
}

console.log(`\n触摸交互测试：${steps} 步，完成 ${games} 局`);
console.log('错误:', errs.length ? errs.slice(0, 5) : '无');
await browser.close();