/**
 * 上海敲麻 · 牌面模型
 *
 * 编码方案：0-33 索引
 *   0- 8  万子 1-9
 *   9-17  筒子 1-9
 *  18-26  条子 1-9
 *  27-30  风牌 东南西北
 *  31-33  箭牌 中发白
 *
 * 花牌：共 20 张，摸到即亮出并向牌墙补一张，不进手牌、不能打出、不能碰杠。
 *   - 春夏秋冬、梅兰竹菊 8 张，用负数 id（-1 .. -8）表示
 *   - 中发白 12 张（每种 4 张），id 仍为 31-33
 * 因此牌墙 144 张中，有 124 张「常规牌」（万筒条 + 风牌）+ 20 张花牌。
 */

export const WAN = 0;
export const TONG = 9;
export const TIAO = 18;
export const FENG = 27;
export const JIAN = 31;

export const NUM_SUIT = 27; // 三门数牌
export const ALL_KINDS = 34; // 万筒条 + 风 + 箭（中发白虽为花牌，仍占编码位）
/** 常规牌种类数（不含中发白）：万筒条 27 + 风 4 = 31 */
export const NORMAL_KINDS = 31;

/** 八张季节花牌：各1 张，固定 id = -1..-8 */
export const FLOWERS = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'] as const;
export const FLOWER_BASE = -1;

/**
 * 是否花牌。花牌 = 8 张季节花 + 中发白。
 * 花牌不进手牌，摸到即亮出补牌。
 */
export function isFlower(t: number): boolean {
  return t < 0 || t >= JIAN;
}

/** 是否为季节花牌（负数 id） */
export function isSeasonFlower(t: number): boolean {
  return t < 0;
}

export type Suit = 'w' | 't' | 's' | 'z';

export function suitOf(t: number): Suit {
  if (t < TONG) return 'w';
  if (t < TIAO) return 't';
  if (t < FENG) return 's';
  return 'z';
}

/** 数牌返回 1-9，字牌返回 1-7（东南西北中发白） */
export function rankOf(t: number): number {
  return (t % 9) + 1;
}

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_ZI = ['东', '南', '西', '北', '中', '发', '白'];

export function tileName(t: number): string {
  if (t < 0) return FLOWERS[-(t + 1)];
  const r = rankOf(t);
  if (t < FENG) return CN_NUM[r - 1] + ['万', '筒', '条'][['w', 't', 's'].indexOf(suitOf(t))];
  return CN_ZI[t - FENG];
}

export function tileChar(t: number): string {
  if (t < 0) return FLOWERS[-(t + 1)];
  const r = rankOf(t);
  if (t < FENG) return CN_NUM[r - 1];
  return CN_ZI[t - FENG];
}

export function isSuited(t: number): boolean {
  return t >= 0 && t < NUM_SUIT;
}

export function isHonor(t: number): boolean {
  return t >= FENG && t < ALL_KINDS;
}

export function isWind(t: number): boolean {
  return t >= FENG && t < JIAN;
}

export function isDragon(t: number): boolean {
  return t >= JIAN;
}

/** 是否字牌且非风（箭牌）—— 上海敲麻里中发白算花 */
export function isDragonTile(t: number): boolean {
  return t >= JIAN;
}

/**
 * 手牌表示：长度 34 的计数数组，index 0-33 为各牌张数。
 * 花牌不进入手牌（摸到即补），只单独记录 flowerCount。
 */
export type HandCounts = Int8Array;

export function newCounts(): HandCounts {
  return new Int8Array(ALL_KINDS);
}

export function countsFrom(tiles: number[]): HandCounts {
  const c = newCounts();
  for (const t of tiles) if (t >= 0) c[t]++;
  return c;
}

export function countsTotal(c: HandCounts): number {
  let n = 0;
  for (let i = 0; i < ALL_KINDS; i++) n += c[i];
  return n;
}

export function countsCopy(c: HandCounts): HandCounts {
  return Int8Array.from(c) as HandCounts;
}

export function tilesOf(c: HandCounts): number[] {
  const out: number[] = [];
  for (let i = 0; i < ALL_KINDS; i++) for (let k = 0; k < c[i]; k++) out.push(i);
  return out;
}

/**
 * 和牌型递归拆解：判断 counts 能否拆成 n 组面子 + 1 对将。
 * 从最小牌开始，避免排列爆炸。
 */
export function canMeld(counts: Int8Array, needSets: number): boolean {
  // 找第一张牌
  let i = 0;
  while (i < ALL_KINDS && counts[i] === 0) i++;
  if (i === ALL_KINDS) return needSets === 0;

  // 尝试刻子（3 张）
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = canMeld(counts, needSets - 1);
    counts[i] += 3;
    if (ok) return true;
  }
  // 尝试顺子（3 张，仅数牌且不跨门）
  if (isSuited(i) && rankOf(i) <= 7 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    const ok = canMeld(counts, needSets - 1);
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/**
 * 和牌判定：手牌（已含副露）共 3n+2 张，n = (手牌张数 - 2) / 3。
 * meldCount 为副露组数，则手牌张数 = (4 - meldCount) * 3 + 2。
 */
export function isWinning(counts: HandCounts, meldCount: number): boolean {
  const total = countsTotal(counts);
  const expected = (4 - meldCount) * 3 + 2;
  if (total !== expected) return false;
  const needSets = 4 - meldCount;

  for (let p = 0; p < ALL_KINDS; p++) {
    if (counts[p] < 2) continue;
    counts[p] -= 2;
    const ok = canMeld(counts, needSets);
    counts[p] += 2;
    if (ok) return true;
  }
  return false;
}

/**
 * 听牌表预计算核心：给定 3n+1 张手牌，返回所有能胡的牌索引。
 * 这是整个项目最热的路径，用记忆化 + 编码缓存。
 */
const winCache = new Map<string, number[]>();

export function winningTiles(counts: HandCounts, meldCount: number): number[] {
  const key = `${meldCount}:${Array.from(counts).join(',')}`;
  const hit = winCache.get(key);
  if (hit) return hit;

  const out: number[] = [];
  const probe = countsCopy(counts) as Int8Array;
  for (let t = 0; t < ALL_KINDS; t++) {
    if (probe[t] >= 4) continue;
    probe[t]++;
    if (isWinning(probe as HandCounts, meldCount)) out.push(t);
    probe[t]--;
  }
  if (winCache.size < 400000) winCache.set(key, out);
  return out;
}