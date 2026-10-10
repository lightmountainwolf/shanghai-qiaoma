import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errs.push('CONSOLE: ' + m.text());
});

await page.goto('http://localhost:5180/', { waitUntil: 'load' });
await page.waitForTimeout(1200);

const box = await page.locator('#board').boundingBox();
const sx = box.width / 1080, sy = box.height / 620;

/** 从页面拿真实的手牌可点击区域，点第 i 张 */
async function clickTile(i) {
  const pt = await page.evaluate((idx) => {
    const areas = (window).__qm.areas().filter((a) => a.kind === 'hand');
    const g = (window).__qm.game();
    const me = g.players[0];
    // 只点可弃的牌：手上有这张，且不在已敲锁定状态
    const a = areas[idx];
    if (!a) return null;
    const rect = document.getElementById('board').getBoundingClientRect();
    const kx = rect.width / 1080, ky = rect.height / 620;
    return {
      px: rect.left + (a.x + a.w / 2) * kx,
      py: rect.top + (a.y + a.h / 2) * ky,
      tile: a.tile,
      handTotal: me.hand.reduce((a2, b) => a2 + b, 0),
    };
  }, i);
  if (!pt) return null;
  await page.mouse.click(pt.px, pt.py);
  return pt;
}

let steps = 0, gameNo = 0;

while (steps < 500 && gameNo < 3) {
  steps++;

  const st = await page.evaluate(() => {
    const g = (window).__qm.game();
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
      result: document.getElementById('result').textContent.replace(/\s+/g, ' ').trim().slice(0, 300),
      scores: Array.from(document.querySelectorAll('.score-box')).map(
        (b) => b.querySelector('.name').textContent + '=' + b.querySelector('.val').textContent),
      lastLog: Array.from(document.querySelectorAll('#log div')).slice(-5).map((d) => d.textContent),
    }));
    console.log(`\n===== 第 ${gameNo + 1} 局结束（累计 ${steps} 步）=====`);
    console.log('结算:', info.result);
    console.log('得分:', info.scores.join('  '));
    info.lastLog.forEach((l) => console.log('   ', l));

    await page.click('#actions button');
    await page.waitForTimeout(900);
    gameNo++;
    continue;
  }

  // 我方有声明权
  if (st.claimMine.length > 0) {
    const pref = st.claimMine.find((t) => t === 'win') || st.claimMine[0];
    await page.evaluate((type) => {
      const g = (window).__qm.game();
      const o = g.pending.options.find((x) => x.player === 0 && x.type === type);
      g.claim(0, { type: o.type, chow: o.chow });
    }, pref);
    await page.waitForTimeout(250);
    continue;
  }

  // 轮到我：优先点按钮（胡/敲/杠）
  if (st.turn === 0) {
    if (st.btns.length > 0) {
      const win = st.btns.findIndex((t) => t.startsWith('胡'));
      const qi = st.btns.findIndex((t) => t.startsWith('敲'));
      const kong = st.btns.findIndex((t) => t.includes('杠'));
      const pick = win >= 0 ? win : kong >= 0 ? kong : qi >= 0 ? qi : -1;
      if (pick >= 0) {
        await page.evaluate((i) => document.querySelectorAll('#actions button')[i].click(), pick);
        await page.waitForTimeout(250);
        continue;
      }
    }
    // 出牌：选一张点两次
    const r = await clickTile(steps % 12);
    if (!r) { await page.waitForTimeout(200); continue; }
    await page.waitForTimeout(60);
    await clickTile(steps % 12);
    await page.waitForTimeout(260);
    continue;
  }

  await page.waitForTimeout(220);
}

console.log(`\n===== 总计 ${steps} 步，完成 ${gameNo} 局 =====`);
console.log('JS 错误:', errs.length ? errs.slice(0, 5) : '无');
await page.screenshot({ path: 'shot-final.png' });
await browser.close();