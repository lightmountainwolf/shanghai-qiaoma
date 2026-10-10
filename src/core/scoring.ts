/**
 * 上海敲麻 · 花数与番数计算
 *
 * 花数构成（敲麻核心计分体系）：
 *   花牌（春夏秋冬、梅兰竹菊）    1 花 / 张
 *   中发白                       1 花 / 张
 *   风牌刻子（含碰/明杠/暗杠）    1 / 2 / 3 花
 *   普通杠明杠 1 花、暗杠 2 花
 *   底花                        1 花（配置项）
 *   无花果（花数为 0）          记 10 花
 *
 * 倍数 = 花数 × 2^(番数) × 荒番倍数，自摸 ×3
 */

import { ALL_KINDS, HandCounts, isSuited, isWind, isDragon, tileName, isSeasonFlower } from './tiles.js';

export interface ScoringConfig {
  /** 底花：配置为 2 时，2 花以上才能自摸、3 花以上才能吃铳 */
  baseFlower: number;
  /** 底分 */
  baseScore: number;
  /** 单局封顶倍数（相对底分） */
  capMultiplier: number;
  /** 自摸是否三倍 */
  selfDrawTriple: boolean;
  /** 自摸所需最低花数（含底花） */
  selfDrawMinFlowers: number;
  /** 吃铳（点炮胡）所需最低花数（含底花） */
  ronMinFlowers: number;
}

export const DEFAULT_CONFIG: ScoringConfig = {
  baseFlower: 2,
  baseScore: 1,
  capMultiplier: 128,
  selfDrawTriple: true,
  selfDrawMinFlowers: 2,
  ronMinFlowers: 3,
};

export interface MeldInfo {
  type: 'chow' | 'pon' | 'minkan' | 'shouminkan' | 'ankan';
  /** 代表牌（用于计花判定） */
  tile: number;
  /**
   * 完整牌组，用于界面显示。
   * 吃是三张不同类型（如 3筒4筒5筒），碰杠是同一张重复。
   * 缺省时由界面按 type + tile 推导。
   */
  tiles?: number[];
  flowers: number;
}

/** 副露的牌组（供界面显示） */
export function meldTiles(m: MeldInfo): number[] {
  if (m.tiles && m.tiles.length > 0) return m.tiles;
  const n = m.type === 'minkan' || m.type === 'ankan' ? 4 : 3;
  if (m.type === 'chow') {
    // 按 tile 为最小牌推导顺子
    return [m.tile, m.tile + 1, m.tile + 2];
  }
  return Array(n).fill(m.tile);
}

export interface FlowerBreakdown {
  /** 不含底花的花数 */
  flowers: number;
  detail: string[];
  /** 是否触发无花果（不含底花为 0） */
  isNoFlower: boolean;
}

/**
 * 计算一个玩家的花数明细。
 *
 * 花牌共 20 张：季节花 8 张 + 中发白 12 张，摸到即亮出，都记 1 花/张。
 * 另外风牌刻子/杠与普通明暗杠也计花。
 *
 * @param collectedFlowers 已亮出的花牌（季节花为负数 id，中发白为 31-33）
 */
export function computeFlowers(
  hand: HandCounts,
  melds: MeldInfo[],
  collectedFlowers: number[],
): FlowerBreakdown {
  const detail: string[] = [];
  let f = 0;

  // 已亮出的花牌：季节花与中发白都各 1 花
  if (collectedFlowers.length > 0) {
    const season = collectedFlowers.filter((t) => isSeasonFlower(t));
    const dragons = collectedFlowers.filter((t) => isDragon(t));
    if (season.length > 0) {
      f += season.length;
      detail.push(`季节花 ${season.length} 张 = ${season.length} 花`);
    }
    if (dragons.length > 0) {
      f += dragons.length;
      detail.push(`补到中发白 ${dragons.length} 张 = ${dragons.length} 花`);
    }
  }

  // 副露带来的花（中发白是花牌，不会被碰杠，故此处只会出现万筒条与风牌）
  for (const m of melds) {
    if (m.type === 'chow') continue;
    // 风牌：刻 1 花、明杠/补杠 2 花、暗杠 3 花
    if (isWind(m.tile)) {
      const v = m.type === 'ankan' ? 3 : m.type === 'pon' ? 1 : 2;
      f += v;
      const label =
        m.type === 'ankan' ? '风暗杠' : m.type === 'pon' ? '风刻' : '风杠';
      detail.push(`${tileName(m.tile)}${label} = ${v} 花`);
    } else if (m.type === 'ankan') {
      f += 2;
      detail.push(`${tileName(m.tile)}暗杠 = 2 花`);
    } else if (m.type === 'pon') {
      // 普通刻子不计花，只有风刻计花
      detail.push(`${tileName(m.tile)}碰（不计花）`);
    } else {
      f += 1;
      detail.push(`${tileName(m.tile)}明杠 = 1 花`);
    }
  }

  return { flowers: f, detail, isNoFlower: f === 0 };
}

/** 某副露应有的花数（供UI 展示与一致性检查） */
export function meldFlowers(m: MeldInfo): number {
  if (m.type === 'chow') return 0;
  if (isWind(m.tile)) return m.type === 'ankan' ? 3 : 2;
  if (m.type === 'ankan') return 2;
  return 1;
}

export interface WinContext {
  hand: HandCounts;
  melds: MeldInfo[];
  collectedFlowers: number[];
  selfDraw: boolean;
  afterKong: boolean;
  robKong: boolean;
  huangZhuang: boolean;
  huangMultiplier: number;
  exposedCount: number;
  config: ScoringConfig;
}

export interface FanResult {
  names: string[];
  /** 番数总和，以 2^n 形式应用 */
  exponent: number;
  /** 含底花的最终花数 */
  flowers: number;
  flowersDetail: string[];
  totalMultiplier: number;
  capped: boolean;
  points: number;
}

/** 判断牌型特征 */
export function analyzePattern(hand: HandCounts, melds: MeldInfo[]) {
  let suited = 0;
  let honor = 0;
  let totalMelds = 0;

  for (let t = 0; t < ALL_KINDS; t++) {
    const n = hand[t];
    if (!n) continue;
    if (isSuited(t)) suited++;
    else honor++;
    if (n === 3) totalMelds++;
  }
  for (const m of melds) {
    if (isSuited(m.tile)) suited++;
    else honor++;
    totalMelds++;
  }

  const suits = new Set<number>();
  for (let t = 0; t < ALL_KINDS; t++) {
    if (hand[t] > 0 && isSuited(t)) suits.add(Math.floor(t / 9));
  }
  for (const m of melds) if (isSuited(m.tile)) suits.add(Math.floor(m.tile / 9));

  const allTriplets = totalMelds === 4;

  return {
    suitedKinds: suited,
    honorKinds: honor,
    suitCount: suits.size,
    isPengPeng: allTriplets,
    isQingYiSe: suited > 0 && honor === 0 && suits.size === 1,
    isHunYiSe: suited > 0 && honor > 0 && suits.size === 1,
    isQingPeng: allTriplets && suited > 0 && honor === 0 && suits.size === 1,
    isHunPeng: allTriplets && suited > 0 && honor > 0 && suits.size === 1,
  };
}

export function calculateWin(ctx: WinContext): FanResult {
  const cfg = ctx.config;
  const names: string[] = [];
  let exponent = 0;

  const fb = computeFlowers(ctx.hand, ctx.melds, ctx.collectedFlowers);
  let flowers = fb.flowers;
  const flowerLines = [...fb.detail];

  // 无花果：不计底花，直接记 10 花
  const noFlower = flowers === 0;
  if (noFlower) {
    flowers = 10;
    flowerLines.push('无花果 = 10 花');
    names.push('无花果');
  } else {
    flowers += cfg.baseFlower;
    flowerLines.push(`底花 ${cfg.baseFlower} 花`);
  }

  const pat = analyzePattern(ctx.hand, ctx.melds);

  if (ctx.huangZhuang) { names.push('黄庄'); exponent += 1; }
  if (ctx.afterKong) { names.push('杠开'); exponent += 1; }
  if (ctx.exposedCount === 0) { names.push('门清'); exponent += 1; }
  if (ctx.exposedCount === 4) { names.push('大吊车'); exponent += 1; }

  if (pat.isPengPeng) { names.push('碰碰胡'); exponent += 1; }
  if (pat.isHunYiSe) { names.push('混一色'); exponent += 1; }
  if (pat.isQingYiSe) { names.push('清一色'); exponent += 2; }
  if (pat.isHunPeng) { names.push('混碰'); exponent += 2; }
  if (pat.isQingPeng) { names.push('清碰'); exponent += 3; }

  let multiplier = flowers * Math.pow(2, exponent) * ctx.huangMultiplier;
  if (ctx.selfDraw && cfg.selfDrawTriple) multiplier *= 3;
  if (ctx.robKong) multiplier *= 3;

  let capped = false;
  const cap = cfg.capMultiplier * cfg.baseScore;
  if (multiplier > cap) { multiplier = cap; capped = true; }

  const points = Math.round(multiplier * cfg.baseScore);

  return {
    names, exponent, flowers, flowersDetail: flowerLines,
    totalMultiplier: multiplier, capped, points,
  };
}

/**
 * 判断当前是否满足胡牌的花数门槛。
 * @param selfDraw true=自摸（需 ≥2 花），false=点炮（需 ≥3 花）
 */
export function meetsFlowerThreshold(
  hand: HandCounts,
  melds: MeldInfo[],
  collectedFlowers: number[],
  selfDraw: boolean,
  config: ScoringConfig = DEFAULT_CONFIG,
): { ok: boolean; flowers: number; required: number } {
  const fb = computeFlowers(hand, melds, collectedFlowers);
  const flowers = fb.flowers + config.baseFlower;
  const required = selfDraw ? config.selfDrawMinFlowers : config.ronMinFlowers;
  return { ok: flowers >= required, flowers, required };
}