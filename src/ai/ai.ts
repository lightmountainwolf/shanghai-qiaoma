/**
 * 上海敲麻 · AI
 *
 * 三层策略：
 *   1. 进攻分：牌型效率（进向数、留牌价值）
 *   2. 防守分：向听牌的危险度（对手已敲 →高危）
 *   3. 敲或不敲：听口质量 + 风险评估
 *
 * 敲麻的特殊性：敲了必须胡、不能改口，所以「什么时候敲」是
 * AI 最关键的决策点，比「打哪张」重要得多。
 */

import {
  ALL_KINDS, HandCounts, newCounts, winningTiles, isSuited, isWind, isDragon,
  isFlower, rankOf, suitOf, countsTotal, tileName,
} from '../core/tiles.js';
import { Game, PlayerState } from '../core/game.js';

export interface AIConfig {
  /** 激进度：越高越倾向进攻，越低越重视防守 */
  aggression: number;
  /** 危险牌阈值：剩余张数 <= 此值视为危险 */
  dangerThreshold: number;
  /** 剩余牌少于多少时进入防守 */
  defenseTurns: number;
}

export const DEFAULT_AI: AIConfig = {
  aggression: 0.6,
  dangerThreshold: 2,
  defenseTurns: 8,
};

/**
   * 单张牌的形状价值。
   * 注意：中发白是花牌，摸到即被亮出，不会出现在手牌里，
   * 因此此处只需考虑万筒条与风牌。
   */
function shapeValue(hand: HandCounts, t: number): number {
  const n = hand[t];
  if (n === 0) return 0;
  const suited = isSuited(t);
  let v = n >= 3 ? 6 : n === 2 ? 3 : 1; // 刻/对天然有用

  if (suited) {
    const r = rankOf(t);
    if (r >= 2 && hand[t - 1] > 0) v += 2;
    if (r <= 8 && hand[t + 1] > 0) v += 2;
    if (r >= 3 && hand[t - 2] > 0) v += 1;
    if (r <= 7 && hand[t + 2] > 0) v += 1;
  } else {
    // 风牌：只有刻子价值，无顺子；但风刻计 1 花，有保底价值
    v -= 1;
    if (isWind(t)) v += 1.5;
  }
  return v;
}

/**
 * 弃牌后手牌的向听进度评估。
 * 返回值越大越好（越接近听牌/胡牌）。
 */
function evaluateDiscard(
  hand: HandCounts,
  discard: number,
  meldCount: number,
  unseen: Int8Array,
): number {
  hand[discard]--;
  let score = 0;

  const total = countsTotal(hand);

  // 已听牌：能胡就是最优
  if (total % 3 === 2) {
    if (winningTiles(hand, meldCount).length > 0) {
      score += 1000;
    } else {
      score += 100;
    }
  }

  // 未听：按进向数给分（离听牌还有几步）
  score += meldProgress(hand, meldCount) * 10;

  // 留牌价值：手中剩余牌的形状总分
  for (let t = 0; t < ALL_KINDS; t++) {
    if (t === discard || hand[t] === 0) continue;
    score += shapeValue(hand, t) * (unseen[t] > 0 ? 1 : 0.3);
  }

  // 字牌与数牌的平衡：孤立的字牌（剩余 0 张）惩罚
  if (!isSuited(discard) && unseen[discard] === 0) {
    // 打完这张字牌没有再生资源，略微惩罚
    score -= 2;
  }

  hand[discard]++;
  return score;
}

/** 粗略的向听进度：能组成的完整面子越多越好 */
function meldProgress(hand: HandCounts, meldCount: number): number {
  let pairs = 0;
  let trips = 0;
  let runs = 0;

  for (let t = 0; t < ALL_KINDS; t++) {
    const n = hand[t];
    if (n >= 3) trips++;
    else if (n === 2) pairs++;
  }
  // 数牌顺子计数（不重复计数）
  const seen = new Set<string>();
  for (let t = 0; t < 27; t++) {
    if (hand[t] === 0) continue;
    const r = rankOf(t);
    for (let s = r; s <= r + 2 && s <= 9; s++) {
      const key = `${Math.floor(t / 9)}-${s}`;
      if (seen.has(key)) continue;
      const base = Math.floor(t / 9) * 9 + (s - 1);
      if (hand[base] > 0 && hand[base + 1] > 0 && hand[base + 2] > 0) {
        seen.add(key);
        runs++;
      }
    }
  }
  return runs + trips + pairs * 0.5;
}

/** 某张牌的危险度：0 安全，1 极危险 */
export function dangerLevel(
  g: Game,
  tile: number,
  fromPlayer: number,
): number {
  let danger = 0;

  for (let d = 1; d < 4; d++) {
    const pid = (fromPlayer + d) % 4;
    const p = g.players[pid];
    if (p.melds.length >= 3) continue; // 已副露太多，不太可能听牌

    // 剩余可见张数越少越危险
    const remaining = 4 - g.visibleCount(tile);
    let t = Math.max(0, (3 - remaining)) / 3;

    // 已敲的玩家极危险
    if (p.hasQi) {
      t = Math.max(t, 0.75);
      if (p.qiTiles.includes(tile)) return 1; // 明确在听这张
    }

    // 副露多张牌（如碰过）暗示要成型
    if (p.melds.length >= 2) t = Math.max(t, 0.55);

    // 自身也有该牌，不能算危险（放炮也胡不了）
    if (p.hand[tile] > 0) t *= 0.2;

    danger = Math.max(danger, t);
  }
  return danger;
}

/** AI 决策入口 */
export class MahjongAI {
  config: AIConfig;
  constructor(config: Partial<AIConfig> = {}) {
    this.config = { ...DEFAULT_AI, ...config };
  }

  /** 选择动作 */
  decide(g: Game, playerId: number): { type: string; tile?: number; chow?: number[] } {
    const p = g.players[playerId];
    const actions = g.turnActions(playerId);

    // 1. 能胡必胡（敲后有和必和，漏胡倒赔）
    const win = actions.find((a) => a.type === 'win');
    if (win) return { type: 'win', tile: win.tile };

    // 2. 杠优先（有杠必杠）
    const kong = actions.find((a) => a.type === 'ankan' || a.type === 'shouminkan');
    if (kong) return { type: kong.type, tile: kong.tile };

    // 3. 决定是否敲
    const qiAction = actions.find((a) => a.type === 'qi');
    if (qiAction) {
      return this.decideQi(g, playerId);
    }

    // 4. 弃牌
    return this.decideDiscard(g, playerId);
  }

  /** 敲不敲：这是敲麻 AI 最关键的决策 */
  private decideQi(g: Game, playerId: number) {
    const p = g.players[playerId];
    const waits = g.qiTilesOf(playerId);

    // 已敲过：不重复
    if (p.hasQi) return { type: 'discard', tile: this.bestDiscard(g, playerId) };

    const q = this.evaluateQi(g, playerId, waits);

    if (q >= 0.55) {
      return { type: 'qi', tile: this.bestDiscard(g, playerId) };
    }
    return { type: 'discard', tile: this.bestDiscard(g, playerId) };
  }

  /** 敲的质量评估：0-1，越高越该敲 */
  evaluateQi(g: Game, playerId: number, waits: number[]): number {
    const p = g.players[playerId];
    const unseen = g.wall.remainingCounts();

    // 听口宽度：多面听更值钱
    let q = Math.min(waits.length, 5) / 8;

    // 剩余张数：听口牌还有几张没现
    let alive = 0;
    for (const w of waits) alive += unseen[w];
    q += Math.min(alive / 12, 0.35);

    // 剩余牌墙：太晚敲风险大
    const left = g.wall.remaining;
    if (left < 20) q -= 0.25;
    if (left < 10) q -= 0.3;

    // 已有副露难敲（已失门清，且副露牌型受限）
    if (p.exposedCount > 0) q -= p.exposedCount * 0.05;

    // 听口价值：字牌听口更稀缺（更可能是断幺/混一色）
    const honorWaits = waits.filter((w) => !isSuited(w)).length;
    if (honorWaits > 0) q += 0.08;

    // 花数门槛：敲了却达不到胡牌门槛，等于白敲
    // 底花已计入，自摸需≥2，点炮需≥3
    const flowers = g.flowerBreakdown(playerId).flowers + g.config.baseFlower;
    const needSelfDraw = g.config.selfDrawMinFlowers;
    const needRon = g.config.ronMinFlowers;
    if (flowers >= needRon) {
      q += 0.15;             // 门槛全过，敲了就能胡
    } else if (flowers >= needSelfDraw) {
      q -= 0.08;             // 只能自摸，门槛够但点炮不行
    } else {
      q -= 0.3;              // 连自摸都不够，敲了大概率打不响
    }

    // 手上的中发白多 → 门槛容易过
    let dragons = 0;
    for (let t = 31; t < 34; t++) dragons += p.hand[t];
    if (dragons > 0) q += Math.min(dragons * 0.06, 0.15);

    // 番数潜力：清一色/碰碰胡方向
    const hand = p.hand;
    const suits = new Set<number>();
    for (let t = 0; t < 27; t++) if (hand[t] > 0) suits.add(Math.floor(t / 9));
    if (suits.size === 1) q += 0.12; // 清一色路线

    return Math.max(0, Math.min(1, q));
  }

  /** 打出哪张 */
  bestDiscard(g: Game, playerId: number): number {
    const p = g.players[playerId];
    const unseen = g.wall.remainingCounts();
    const meldCount = p.melds.length;

    // 已敲：只能打出刚摸/刚碰的那张，不能选
    if (p.hasQi) {
      if (g.justDrawn >= 0 && p.hand[g.justDrawn] > 0) return g.justDrawn;
    }

    let best = -1;
    let bestScore = -Infinity;

    for (let t = 0; t < ALL_KINDS; t++) {
      if (p.hand[t] === 0) continue;
      // 花牌不在手牌里，防御性跳过
      if (isFlower(t)) continue;

      let score = evaluateDiscard(p.hand, t, meldCount, unseen) * this.config.aggression;

      // 防守：危险牌重罚
      const dg = dangerLevel(g, t, playerId);
      const remain = 4 - g.visibleCount(t);
      if (dg > 0 && remain <= this.config.dangerThreshold) {
        const risk = dg * (1 - this.config.aggression) * 30;
        score -= risk;
      }

      // 牌墙晚期，更保守
      if (g.wall.remaining < 18) {
        score -= dg * 12;
      }

      // 已被自己打过的牌，多打无损失（安全牌）
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }

    if (best < 0) best = g.justDrawn >= 0 ? g.justDrawn : 0;
    return best;
  }

  private decideDiscard(g: Game, playerId: number) {
    return { type: 'discard', tile: this.bestDiscard(g, playerId) };
  }

  /** 声明响应（吃碰杠胡） */
  decideClaim(
    g: Game,
    playerId: number,
    tile: number,
  ): { type: string; tile?: number; chow?: number[] } | null {
    if (!g.pending) return null;
    const opts = g.pending.options.filter((o) => o.player === playerId);
    if (opts.length === 0) return null;

    const p = g.players[playerId];
    const win = opts.find((o) => o.type === 'win');
    if (win) return { type: 'win' };

    const minkan = opts.find((o) => o.type === 'minkan');
    if (minkan) return { type: 'minkan', tile };

    const pon = opts.find((o) => o.type === 'pon');
    if (pon) {
      // 手牌已多，碰会暴露信息并减少牌效 → 保守碰
      if (p.exposedCount >= 2 && !p.hasQi) return null;
      // 字牌碰有价值（计花）
      if (isWind(tile)) return { type: 'pon' };
      return null;
    }

    const chow = opts.find((o) => o.type === 'chow');
    if (chow && !p.hasQi) {
      if (p.exposedCount >= 3) return null;
      return { type: 'chow', chow: chow.chow };
    }
    return null;
  }
}

/**
 * 无头模拟：让 4 个 AI 跑 N 局，用于统计 AI 强度和回归测试。
 */
export function simulateGames(n: number, seedBase: number, aiConfigs?: Partial<AIConfig>[]) {
  const stats = { games: 0, draws: 0, wins: [0, 0, 0, 0], points: [0, 0, 0, 0] };
  for (let i = 0; i < n; i++) {
    // 模拟中四家全部由 AI 控制（isAI=true，敲后自动胡）
    const g = new Game(undefined as any, seedBase + i, [0, 1, 2, 3]);
    g.deal();
    const ais = [0, 1, 2, 3].map(
      (id) => new MahjongAI(aiConfigs?.[id] ?? {}),
    );

    let guard = 0;
    while (g.phase !== 'game-over' && g.phase !== 'win-settle' && guard++ < 3000) {
      if (g.phase === 'claim' && g.pending) {
        const opt = g.pending.options[0];
        const claim = ais[opt.player].decideClaim(g, opt.player, g.pending.tile);
        if (claim) g.claim(opt.player, claim as any);
        else g.pass(opt.player);
        continue;
      }
      // 敲后若已达胡牌条件，AI 直接胡（与 act('qi') 内的 isAI 分支一致）
      if (g.pendingWinAfterQi) {
        g.pendingWinAfterQi = false;
        g.act(g.turn, { type: 'win', tile: g.justDrawn });
        continue;
      }
      const ai = ais[g.turn];
      const d = ai.decide(g, g.turn);
      if (d.type === 'discard') g.act(g.turn, { type: 'discard', tile: d.tile! });
      else g.act(g.turn, d as any);
    }

    stats.games++;
    if (g.phase === 'game-over') stats.draws++;
    else if (g.winner) stats.wins[g.winner.winner]++;
    for (let p = 0; p < 4; p++) stats.points[p] += g.players[p].score;
  }
  return stats;
}