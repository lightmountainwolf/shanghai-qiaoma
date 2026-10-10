import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errs.push('CONSOLE: ' + m.text());
});

await page.goto('http://localhost:5182/', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// 快进：让 AI 们多打几轮，积累牌河
const box = await page.locator('#board').boundingBox();

async function tapTile(i, n = 13) {
  const pt = await page.evaluate(([idx, cnt]) => {
    const areas = window.__qm.areas().filter((a) => a.kind === 'hand');
    if (!areas[idx]) return null;
    const c = document.getElementById('board');
    const r = c.getBoundingClientRect();
    const R = window.__qm.renderer();
    return {
      px: r.left + (areas[idx].x + areas[idx].w / 2) * (r.width / R.W),
      py: r.top + (areas[idx].y + areas[idx].h / 2) * (r.height / R.H),
    };
  }, [i, n]);
  if (!pt) return false;
  await page.touchscreen.tap(pt.px, pt.py);
  return true;
}

// 打 30 步，累积牌河
for (let s = 0; s < 45; s++) {
  const st = await page.evaluate(() => {
    const g = window.__qm.game();
    return {
      turn: g.turn,
      phase: g.phase,
      btns: Array.from(document.querySelectorAll('#actions button')).map((b) => b.textContent),
    };
  });
  if (st.phase === 'claim') {
    const passBtn = await page.$('#actions button.secondary');
    if (passBtn) await passBtn.click().catch(() => {});
    await page.waitForTimeout(200);
    continue;
  }
  if (st.turn === 0) {
    if (st.btns.length > 0) {
      const qi = st.btns.findIndex((t) => t.startsWith('敲'));
      const kong = st.btns.findIndex((t) => t.includes('杠'));
      const pick = kong >= 0 ? kong : qi >= 0 ? qi : -1;
      if (pick >= 0) {
        await page.evaluate((i) => document.querySelectorAll('#actions button')[i].click(), pick);
        await page.waitForTimeout(200);
        continue;
      }
    }
    const i = s % 13;
    await tapTile(i);
    await page.waitForTimeout(60);
    await tapTile(i);
    await page.waitForTimeout(280);
    continue;
  }
  await page.waitForTimeout(280);
}

const state = await page.evaluate(() => {
  const g = window.__qm.game();
  return {
    piles: [0, 1, 2, 3].map((p) => g.pileOf(p).length),
    flowers: [0, 1, 2, 3].map((p) => g.players[p].flowers.length),
    melds: [0, 1, 2, 3].map((p) => g.players[p].melds.length),
    wallLeft: g.wall.remaining,
    logTail: Array.from(document.querySelectorAll('#log div')).slice(-8).map((d) => d.textContent),
  };
});

console.log('=== 牌局状态 ===');
console.log('各家门牌数:', state.piles, '（牌河）');
console.log('各家补花数:', state.flowers);
console.log('各家副露数:', state.melds);
console.log('牌墙剩余:', state.wallLeft);
console.log('\n日志尾部:');
state.logTail.forEach((l) => console.log('  ', l));

await page.screenshot({ path: 'piles-mobile.png' });
console.log('\n错误:', errs.length ? errs.slice(0, 3) : '无');
await browser.close();