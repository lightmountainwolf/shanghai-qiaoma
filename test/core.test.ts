import { test } from 'node:test';
import assert from 'node:assert';
import { countsFrom, newCounts, isWinning, winningTiles } from '../src/core/tiles.js';
import { Game } from '../src/core/game.js';
import { computeFlowers, calculateWin, meetsFlowerThreshold, DEFAULT_CONFIG } from '../src/core/scoring.js';
import { Wall } from '../src/core/wall.js';

function countsLen(c: Int8Array): number {
  return c.reduce((a: number, b: number) => a + b, 0);
}

function setHand(p: any, tiles: number[]) {
  const c = newCounts();
  for (const t of tiles) c[t]++;
  p.hand = c;
}

// ---------- 和牌判定 ----------

test('基本胡牌：123万 456万 789万 123筒 99筒', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  assert.equal(isWinning(c, 0), true);
});

test('不成立：13 张无法拆成 4 面子 + 1 将', () => {
  const c = countsFrom([0, 1, 2, 5, 6, 7, 8, 9, 10, 18, 19, 20, 21]);
  assert.equal(isWinning(c, 0), false);
});

test('字牌只能成刻或对，不能成顺', () => {
  const ok = countsFrom([31, 31, 31, 27, 27, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(isWinning(ok, 0), true);
  const bad = countsFrom([27, 28, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 17, 17]);
  assert.equal(isWinning(bad, 0), false);
  // 中发白各一张不构成刻子
  const noTriplet = countsFrom([31, 32, 33, 27, 27, 9, 9, 9, 10, 10, 10]);
  assert.equal(isWinning(noTriplet, 1), false);
});

test('副露1 组时手牌需11 张', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 8, 8, 9, 9, 9]);
  assert.equal(countsLen(c), 11);
  assert.equal(isWinning(c, 1), true);
});

test('听牌表：清一色多面听', () => {
  const c = countsFrom([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
  assert.deepEqual(winningTiles(c, 0), [1, 2, 3, 4, 5]);
});

test('听牌表：单钓听口唯一', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
  assert.deepEqual(winningTiles(c, 0), [13]);
});

// ---------- 牌墙：144 张 ----------

test('牌墙：144 张 = 124 常规 + 20 花牌', () => {
  const w = new Wall(12345);
  assert.equal(w.remaining, 144);
  const c = w.remainingCounts();
  // 常规牌（万筒条 + 风）各 4 张；中发白是花牌，不计入常规
  for (let i = 0; i < 31; i++) assert.equal(c[i], 4, `常规牌 ${i} 应为 4 张`);
  assert.equal(c[31], 0, '中发白是花牌，不在常规牌计数中');
  assert.equal(w.remainingFlowers, 20, '应有 20 张花牌（中发白 12 + 季节花 8）');
  assert.equal(w.remainingNormal, 124, '应有 124 张常规牌');
});

test('牌墙：季节花各 1 张，中发白各 4 张', () => {
  const w = new Wall(999);
  const flowers: number[] = [];
  const dragons = new Map<number, number>();
  for (let i = 0; i < 144; i++) {
    const t = w.draw();
    if (t === null) continue;
    if (t < 0) flowers.push(t);
    if (t >= 31) dragons.set(t, (dragons.get(t) ?? 0) + 1);
  }
  assert.equal(flowers.length, 8, '季节花 8 张');
  assert.deepEqual(flowers.sort((a, b) => a - b), [-8, -7, -6, -5, -4, -3, -2, -1]);
  assert.equal(dragons.get(31), 4, '中 4 张');
  assert.equal(dragons.get(32), 4, '发 4 张');
  assert.equal(dragons.get(33), 4, '白 4 张');
});

test('牌墙：确定性种子可复现', () => {
  const a = new Wall(999);
  const b = new Wall(999);
  for (let i = 0; i < 20; i++) assert.equal(a.draw(), b.draw());
});

// ---------- 花数计算 ----------

test('花数：中发白作为花牌各 1 花', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  // 中发白在 flowers 数组里（它们是花牌，不在手牌）
  const fb = computeFlowers(c, [], [31, 32, 33]);
  assert.equal(fb.flowers, 3, '中发白 3 张 = 3 花');
  // 季节花也计入
  const fb2 = computeFlowers(c, [], [-1, -2, 31]);
  assert.equal(fb2.flowers, 3, '2 季节花 + 1 中发白 = 3 花');
});

test('花数：风牌刻 1 花、风明杠 2 花、风暗杠 3 花', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  assert.equal(computeFlowers(c, [{ type: 'pon', tile: 27, flowers: 1 }], []).flowers, 1);
  assert.equal(computeFlowers(c, [{ type: 'minkan', tile: 27, flowers: 2 }], []).flowers, 2);
  assert.equal(computeFlowers(c, [{ type: 'ankan', tile: 27, flowers: 3 }], []).flowers, 3);
  // 普通碰不计花
  assert.equal(computeFlowers(c, [{ type: 'pon', tile: 5, flowers: 0 }], []).flowers, 0);
});

test('花数：普通明杠 1 花、暗杠 2 花', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  assert.equal(computeFlowers(c, [{ type: 'minkan', tile: 5, flowers: 1 }], []).flowers, 1);
  assert.equal(computeFlowers(c, [{ type: 'ankan', tile: 5, flowers: 2 }], []).flowers, 2);
});

test('花数：已补的花牌计入', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  // 2 张季节花 + 1 张中发白 = 3 花
  assert.equal(computeFlowers(c, [], [-1, -2, 31]).flowers, 3);
});

test('无花果：花数为 0 记 10 花', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  const r = calculateWin({
    hand: c, melds: [], collectedFlowers: [],
    selfDraw: false, afterKong: false, robKong: false,
    huangZhuang: false, huangMultiplier: 1, exposedCount: 0,
    config: { ...DEFAULT_CONFIG, baseFlower: 0 },
  });
  assert.ok(r.names.includes('无花果'));
  assert.equal(r.flowers, 10);
});

// ---------- 花数门槛（Q5） ----------

test('门槛：底花 2 花 → 自摸需≥2，点炮需≥3', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  const sd = meetsFlowerThreshold(c, [], [], true, DEFAULT_CONFIG);
  assert.equal(sd.flowers, 2);
  assert.equal(sd.ok, true, '2 花可自摸');

  const ron = meetsFlowerThreshold(c, [], [], false, DEFAULT_CONFIG);
  assert.equal(ron.ok, false, '2 花不能点炮');
  assert.equal(ron.required, 3);
});

test('门槛：1 张中发白补到 3 花可点炮', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 16, 16]);
  // 中发白是花牌，在 flowers 数组里
  const r = meetsFlowerThreshold(c, [], [31], false, DEFAULT_CONFIG);
  assert.equal(r.flowers, 3, '中发白 1 + 底花 2 = 3');
  assert.equal(r.ok, true, '3 花可点炮');
});

test('门槛：补 2 张花牌也达标', () => {
  const c = countsFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 16]);
  const r = meetsFlowerThreshold(c, [], [-1, -2], false, DEFAULT_CONFIG);
  assert.equal(r.flowers, 4);
  assert.equal(r.ok, true);
});

// ---------- 敲的约束（Q4） ----------

test('敲：13 张可敲，锁定听口，不能重复敲', () => {
  const g = new Game(DEFAULT_CONFIG, 7);
  g.deal();
  const p = g.players[0];
  setHand(p, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
  p.hasQi = false;
  assert.equal(g.canQi(0), true);

  g.justDrawn = 13;
  g.act(0, { type: 'qi', tile: 13 });
  assert.equal(p.hasQi, true);
  assert.deepEqual(p.qiTiles, [13]);
  assert.equal(g.canQi(0), false, '已敲不能重复敲');
});

test('敲：未敲不能胡', () => {
  const g = new Game(DEFAULT_CONFIG, 7);
  g.deal();
  const p = g.players[0];
  setHand(p, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 13]);
  p.hasQi = false;
  g.justDrawn = 13;
  assert.equal(isWinning(p.hand, 0), true, '牌型可胡');
  assert.equal(g.canWinNow(0), false, '未敲不能胡');
});

test('敲：人工玩家敲后胡为可选（不自动胡）', () => {
  const g = new Game(DEFAULT_CONFIG, 7, []); // isAI 列表为空
  g.deal();
  const p = g.players[0];
  // 13 张听牌（111 222 333 万 + 4 万单张），听 1/2/3/5 万
  setHand(p, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
  p.flowers = [31]; // 1 张中发白 → 花数 1 + 底花 2 = 3，满足门槛
  assert.equal(countsLen(p.hand), 13, '起手 13 张');
  assert.equal(g.canQi(0), true, '13 张可敲');

  // 摸到听口牌 → 14 张，此时已敲，按规则应可胡
  const waits = g.qiTilesOf(0);
  assert.ok(waits.length > 0, '应有听口');
  p.hand[waits[0]]++;
  g.justDrawn = waits[0];
  p.hasQi = true;
  p.qiTiles = waits;

  assert.equal(g.canWinNow(0, true), true, '自摸：花数达标可胡');
  assert.equal(g.canWinNow(0, false), true, '点炮：3 花达标也可胡');
});

test('敲：AI 敲后自动胡', () => {
  const g = new Game(DEFAULT_CONFIG, 7); // 默认 P1/P2/P3 是 AI
  g.deal();
  const p = g.players[1];
  //直接构造「已敲 + 刚摸到听口牌」的胡牌局面，验证 AI 走 act('qi') 会自动结算
  setHand(p, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
  p.flowers = [31];
  g.turn = 1;
  assert.equal(g.canQi(1), true);
  const waits = g.qiTilesOf(1);
  // 先摸到听口牌再敲：模拟「摸牌→ 发现可胡 → 敲」
  p.hand[waits[0]]++;
  g.justDrawn = waits[0];
  p.hasQi = false;
  g.act(1, { type: 'qi', tile: waits[0] });
  assert.equal(p.hasQi, true);
  assert.equal(g.phase, 'win-settle', 'AI 敲后直接胡');
});

test('门槛：花数不够时点炮胡不成立', () => {
  const g = new Game(DEFAULT_CONFIG, 7, []);
  g.deal();
  const p = g.players[0];
  setHand(p, [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3]);
  p.flowers = []; // 无花，仅底花 2 花
  assert.equal(g.canQi(0), true, '牌型可听');

  const waits = g.qiTilesOf(0);
  p.hand[waits[0]]++;
  g.justDrawn = waits[0];
  p.hasQi = true;
  p.qiTiles = waits;
  assert.equal(g.canWinNow(0, true), true, '自摸 2 花达标');
  assert.equal(g.canWinNow(0, false), false, '点炮需 3 花，不达标');
});

// ---------- 优先级（Q3：碰 > 杠） ----------

test('优先级：碰排在杠之前', () => {
  const g = new Game(DEFAULT_CONFIG, 11);
  g.deal();
  const p0 = g.players[0], p1 = g.players[1];
  p0.hand[5] = 3;
  p1.hand[5] = 2;
  g.turn = 0;
  g.justDrawn = -1;
  g.act(0, { type: 'discard', tile: 5 });

  assert.ok(g.pending, '应有声明窗口');
  const types = g.pending!.options.map((o) => o.type);
  assert.ok(types.includes('pon'), '应有碰选项');
  assert.equal(types[0], 'pon', `碰应优先于杠，实际顺序：${types.join(',')}`);
});

// ---------- 对局流程 ----------

test('发牌：手牌不含花牌，中发白也直接亮出', () => {
  const g = new Game(DEFAULT_CONFIG, 42);
  g.deal();
  for (const p of g.players) {
    const handTotal = countsLen(p.hand);
    assert.ok(handTotal === 13 || handTotal === 14, `玩家 ${p.id} 手牌 ${handTotal} 张`);
    // 手牌里不应有任何花牌（季节花与中发白）
    for (let t = 0; t < 34; t++) {
      if (p.hand[t] > 0) {
        assert.ok(t < 31, `中发白(${t})是花牌，不该出现在手牌里`);
      }
    }
  }
  const totalFlowers = g.players.reduce((a, p) => a + p.flowers.length, 0);
  assert.ok(totalFlowers + g.wall.remainingFlowers === 20, '花牌总数应为 20');
});

test('补花：花牌不进手牌数组', () => {
  const g = new Game(DEFAULT_CONFIG, 2024);
  g.deal();
  for (const p of g.players) {
    assert.equal(p.hand.length, 34, '手牌计数数组长度应为 34');
    for (let t = 0; t < 34; t++) assert.ok(p.hand[t] >= 0);
  }
});

test('完整跑一局不崩溃', () => {
  const g = new Game(DEFAULT_CONFIG, 2024);
  g.deal();
  let guard = 0;
  while (g.phase !== 'game-over' && g.phase !== 'win-settle' && guard++ < 2000) {
    if (g.pendingWinAfterQi) {
      g.pendingWinAfterQi = false;
      g.act(g.turn, { type: 'win', tile: g.justDrawn });
      continue;
    }
    if (g.phase === 'claim' && g.pending) {
      const opt = g.pending.options[0];
      if (opt.type === 'win') {
        g.players[opt.player].hand[g.pending.tile]++;
        g.claim(opt.player, { type: 'win' });
      } else {
        g.claim(opt.player, { type: opt.type, chow: opt.chow });
      }
      continue;
    }
    const acts = g.turnActions(g.turn);
    if (acts.length === 0) break;
    const win = acts.find((a) => a.type === 'win');
    const qi = acts.find((a) => a.type === 'qi');
    const act = win ?? qi ?? acts.find((a) => a.type === 'discard');
    if (!act) break;
    g.act(g.turn, act);
  }
  assert.ok(guard < 2000, '对局应在合理步数内结束');
});

// ---------- 牌河记录 ----------

test('牌河：每次弃牌都记入该玩家牌河', () => {
  const g = new Game(DEFAULT_CONFIG, 11);
  g.deal();
  const before = g.players.map((p) => g.pileOf(p.id).length);
  assert.deepEqual(before, [0, 0, 0, 0], '开局牌河为空');

  g.turn = 0;
  g.justDrawn = -1;
  g.act(0, { type: 'discard', tile: 5 });
  assert.equal(g.pileOf(0).length, 1, 'P0 弃牌后牌河 1 张');
  assert.equal(g.pileOf(0)[0], 5, '记录的是五筒');
});

test('牌河：被吃碰的牌从原弃牌者牌河移除', () => {
  const g = new Game(DEFAULT_CONFIG, 11);
  g.deal();
  const p0 = g.players[0], p1 = g.players[1];
  p0.hand[5] = 3;
  p1.hand[5] = 2;
  g.turn = 0;
  g.justDrawn = -1;
  g.act(0, { type: 'discard', tile: 5 });

  assert.equal(g.pileOf(0).length, 1, 'P0 牌河有这张');
  g.claim(1, { type: 'pon' });
  assert.equal(g.pileOf(0).length, 0, '被碰后从 P0 牌河移除');
  assert.equal(p1.melds.length, 1, 'P1 副露区有这张');
});

test('牌河：多张累积且互不干扰', () => {
  const g = new Game(DEFAULT_CONFIG, 30);
  g.deal();
  const p0 = g.players[0];
  // 给 P0 塞足 5筒以支持多次弃牌
  p0.hand[5] = 4;

  for (let round = 0; round < 3; round++) {
    g.turn = 0;
    g.justDrawn = -1;
    g.act(0, { type: 'discard', tile: 5 });
  }
  assert.equal(g.pileOf(0).length, 3, '同一家累积 3 张');
  assert.equal(g.pileOf(1).length, 0, '其他家不受影响');
});

// ---------- 补花事件 ----------

test('补花：摸到花牌自动亮出并记录事件', () => {
  const g = new Game(DEFAULT_CONFIG, 2024);
  g.deal();
  const totalFlowerEvents = g.flowerEvents.length;
  const totalFlowers = g.players.reduce((a, p) => a + p.flowers.length, 0);
  assert.equal(totalFlowerEvents, totalFlowers, '每个亮出的花都应有事件记录');

  // 花牌总数 20 张（中发白 12 + 季节花 8）
  assert.ok(totalFlowers <= 20, `全场花牌 ${totalFlowers} 张，应≤20`);
  assert.equal(totalFlowers + g.wall.remainingFlowers, 20, '花牌守恒');
});

test('补花：花牌不进手牌，手牌数守恒', () => {
  const g = new Game(DEFAULT_CONFIG, 2024);
  g.deal();
  for (const p of g.players) {
    const handTotal = countsLen(p.hand);
    const isDealer = p.id === g.dealer;
    assert.equal(handTotal, isDealer ? 14 : 13, `P${p.id} 手牌应为 ${isDealer ? 14 : 13}`);
  }
});

// ---------- 中发白是花牌（回归测试） ----------

test('中发白：摸到即亮出，不进手牌', () => {
  const g = new Game(DEFAULT_CONFIG, 777, [0, 1, 2, 3]);
  g.deal();
  // 发牌后手牌里不该有任何中发白
  for (const p of g.players) {
    for (const t of [31, 32, 33]) {
      assert.equal(p.hand[t], 0, `P${p.id} 手牌不应有中发白(${t})`);
    }
  }
  // 跑一段对局，中发白仍不该出现在手牌
  let guard = 0;
  while (g.phase !== 'game-over' && g.phase !== 'win-settle' && guard++ < 300) {
    if (g.phase === 'claim' && g.pending) {
      const o = g.pending.options[0];
      if (o.type === 'win') {
        g.players[o.player].hand[g.pending.tile]++;
        g.claim(o.player, { type: 'win' });
      } else {
        g.claim(o.player, { type: o.type, chow: o.chow });
      }
      continue;
    }
    const acts = g.turnActions(g.turn);
    if (acts.length === 0) break;
    const act = acts.find((a) => a.type === 'win')
      ?? acts.find((a) => a.type === 'qi')
      ?? acts.find((a) => a.type === 'discard');
    if (!act) break;
    g.act(g.turn, act);

    for (const p of g.players) {
      for (const t of [31, 32, 33]) {
        assert.equal(p.hand[t], 0, '对局中 P' + p.id + ' 手牌不应出现中发白');
      }
    }
  }
});

test('中发白：不能被打出', () => {
  const g = new Game(DEFAULT_CONFIG, 777);
  g.deal();
  const acts = g.turnActions(0);
  const dragonDiscards = acts.filter(
    (a) => a.type === 'discard' && a.tile >= 31,
  );
  assert.equal(dragonDiscards.length, 0, '中发白是花牌，不应出现在可弃牌列表里');

  // 强行打出也应无效
  const before = g.pileOf(0).length;
  g.act(0, { type: 'discard', tile: 32 });
  assert.equal(g.pileOf(0).length, before, '打出中发白应被拒绝，牌河不变');
});

test('中发白：不能被碰杠', () => {
  const g = new Game(DEFAULT_CONFIG, 777);
  g.deal();
  const p0 = g.players[0], p1 = g.players[1];
  // 手动给 P1 塞两张中（模拟异常情况），P0 打出中
  p1.hand[31] = 2;
  p0.hand[31] = 3;
  g.turn = 0;
  g.justDrawn = -1;
  g.act(0, { type: 'discard', tile: 31 });
  // 中发白是花牌，不该发起碰的声明窗口
  const ponOpts = g.pending?.options.filter((o) => o.type === 'pon') ?? [];
  assert.equal(ponOpts.length, 0, '中发白不应可被碰');
});

test('补花：多局跑花牌守恒', () => {
  // 回归测试：曾出现补花循环未 return，导致同一张花牌被重复计入
  for (let s = 0; s < 30; s++) {
    const g = new Game(DEFAULT_CONFIG, 5000 + s * 37, [0, 1, 2, 3]);
    g.deal();
    let guard = 0;
    while (g.phase !== 'game-over' && g.phase !== 'win-settle' && guard++ < 400) {
      if (g.pendingWinAfterQi) {
        g.pendingWinAfterQi = false;
        g.act(g.turn, { type: 'win', tile: g.justDrawn });
        continue;
      }
      if (g.phase === 'claim' && g.pending) {
        const o = g.pending.options[0];
        if (o.type === 'win') {
          g.players[o.player].hand[g.pending.tile]++;
          g.claim(o.player, { type: 'win' });
        } else {
          g.claim(o.player, { type: o.type, chow: o.chow });
        }
        continue;
      }
      const acts = g.turnActions(g.turn);
      if (acts.length === 0) break;
      const act = acts.find((a) => a.type === 'win')
        ?? acts.find((a) => a.type === 'qi')
        ?? acts.find((a) => a.type === 'discard');
      if (!act) break;
      g.act(g.turn, act);
    }
    // 守恒：已亮的花牌 + 牌墙剩余花牌 = 20
    const shown = g.players.reduce((a, p) => a + p.flowers.length, 0);
    assert.equal(shown + g.wall.remainingFlowers, 20, `局 ${s} 花牌应守恒为 20`);

    const all: number[] = [];
    for (const p of g.players) all.push(...p.flowers);

    // 季节花（id 为负）各 1 张，不应重复
    const seasons = all.filter((t) => t < 0);
    assert.equal(new Set(seasons).size, seasons.length, `局 ${s} 季节花不应重复`);

    // 中发白每种恰好 4 张（id 相同，故不能用 Set 判重）
    for (const t of [31, 32, 33]) {
      const cnt = all.filter((x) => x === t).length;
      assert.ok(cnt <= 4, `局 ${s} 中发白(${t})已亮 ${cnt} 张，不应超过 4`);
    }
  }
});