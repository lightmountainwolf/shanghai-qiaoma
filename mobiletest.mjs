import { chromium, devices } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});

const errs = [];

// 测试多种手机尺寸
const targets = [
  { name: 'iPhone SE', viewport: { width: 375, height: 667 }, dpr: 2 },
  { name: 'iPhone 14', viewport: { width: 390, height: 844 }, dpr: 3 },
  { name: '小米/Android 常见', viewport: { width: 393, height: 873 }, dpr: 2.75 },
  { name: 'iPad 竖屏', viewport: { width: 768, height: 1024 }, dpr: 2 },
];

for (const t of targets) {
  const ctx = await browser.newContext({
    viewport: t.viewport,
    deviceScaleFactor: t.dpr,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`[${t.name}] ${e.message}`));

  await page.goto('http://localhost:5182/', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const info = await page.evaluate(() => {
    const wrap = document.getElementById('canvas-wrap');
    const c = document.getElementById('board');
    const areas = window.__qm ? window.__qm.areas().filter(a => a.kind === 'hand') : [];
    const g = window.__qm ? window.__qm.game() : null;
    const me = g ? g.players[0] : null;
    // 手牌实际占宽 vs 容器宽
    const handW = areas.length ? (areas[areas.length - 1].x + areas[areas.length - 1].w - areas[0].x) : 0;
    return {
      wrapW: wrap.clientWidth, wrapH: wrap.clientHeight,
      canvasW: c.width, canvasH: c.height,
      cssW: Math.round(c.getBoundingClientRect().width),
      cssH: Math.round(c.getBoundingClientRect().height),
      portrait: window.__qm ? undefined : undefined,
      handTiles: areas.length,
      handWidthPx: Math.round(handW),
      fitsHorizontally: areas.length ? areas[areas.length - 1].x + areas[areas.length - 1].w <= wrap.clientWidth + 1 : false,
      handBottom: areas.length ? Math.round(areas[0].y + areas[0].h) : 0,
      wrapH2: wrap.clientHeight,
      scores: document.querySelectorAll('.score-box').length,
      bodyOverflow: document.body.scrollHeight > window.innerHeight + 2,
    };
  });

  const ok = info.fitsHorizontally && !info.bodyOverflow;
  console.log(`\n${t.name} (${t.viewport.width}x${t.viewport.height} @${t.dpr}x)`);
  console.log(`  画布区: ${info.wrapW}x${info.wrapH}  canvas: ${info.canvasW}x${info.canvasH}  CSS: ${info.cssW}x${info.cssH}`);
  console.log(`  手牌: ${info.handTiles} 张, 宽 ${info.handWidthPx}px, 横向不溢出=${info.fitsHorizontally ? 'OK' : '溢出!'}`);
  console.log(`  手牌底部 ${info.handBottom} / 容器高 ${info.wrapH2}  页面溢出=${info.bodyOverflow ? '是(有问题)' : '否'}`);
  console.log(`  结果: ${ok ? 'PASS' : 'FAIL'}`);

  await page.screenshot({ path: `mobile-${t.name.replace(/[^\w]/g, '_')}.png` });
  await ctx.close();
}

console.log('\n页面错误:', errs.length ? errs : '无');
await browser.close();