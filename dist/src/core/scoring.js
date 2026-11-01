/**
 * 上海敲麻 · 花数与番数计算
 *
 * 花数构成（敲麻核心计分体系）：
 *   花牌（春夏秋冬、梅兰竹菊）    1 花 / 张
 *   中发白                       1 花 / 张
 *   风牌刻子（含碰/明杠/暗杠）    1 / 2 / 3 花
 *   普通杠明杠 1 花、暗杠 2 花
 *   底花                        2 花（配置项）
 *   无花果（花数为 0）          记 10 花
 *
 * 倍数 = 花数 × 2^(番数) × 荒番倍数，自摸 ×3
 */
import { ALL_KINDS, countsCopy, isSuited, isWind, isDragon, tileName, isSeasonFlower } from './tiles.js';
export const DEFAULT_CONFIG = {
    baseFlower: 2,
    baseScore: 1,
    capMultiplier: 128,
    selfDrawTriple: true,
    selfDrawMinFlowers: 2,
    ronMinFlowers: 3,
};
/** 副露的牌组（供界面显示） */
export function meldTiles(m) {
    if (m.tiles && m.tiles.length > 0)
        return m.tiles;
    const n = m.type === 'minkan' || m.type === 'ankan' ? 4 : 3;
    if (m.type === 'chow') {
        // 按 tile 为最小牌推导顺子
        return [m.tile, m.tile + 1, m.tile + 2];
    }
    return Array(n).fill(m.tile);
}
/**
 * 计算一个玩家的花数明细。
 *
 * 花牌共 20 张：季节花 8 张 + 中发白 12 张，摸到即亮出，都记 1 花/张。
 * 另外风牌刻子/杠与普通明暗杠也计花。
 *
 * @param collectedFlowers 已亮出的花牌（季节花为负数 id，中发白为 31-33）
 */
export function computeFlowers(hand, melds, collectedFlowers) {
    const detail = [];
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
        if (m.type === 'chow')
            continue;
        // 风牌：刻 1 花、明杠/补杠 2 花、暗杠 3 花
        if (isWind(m.tile)) {
            const v = m.type === 'ankan' ? 3 : m.type === 'pon' ? 1 : 2;
            f += v;
            const label = m.type === 'ankan' ? '风暗杠' : m.type === 'pon' ? '风刻' : '风杠';
            detail.push(`${tileName(m.tile)}${label} = ${v} 花`);
        }
        else if (m.type === 'ankan') {
            f += 2;
            detail.push(`${tileName(m.tile)}暗杠 = 2 花`);
        }
        else if (m.type === 'pon') {
            // 普通刻子不计花，只有风刻计花
            detail.push(`${tileName(m.tile)}碰（不计花）`);
        }
        else {
            f += 1;
            detail.push(`${tileName(m.tile)}明杠 = 1 花`);
        }
    }
    return { flowers: f, detail, isNoFlower: f === 0 };
}
/**
 * 手牌能否全部由「刻子 + 一对将」组成（碰碰胡的手牌部分）。
 * 递归拆解：对首个非零牌，先试作将（仅一次），再试作刻子。
 */
function canAllTriplets(counts, needPair) {
    let i = -1;
    for (let t = 0; t < ALL_KINDS; t++) {
        if (counts[t] > 0) {
            i = t;
            break;
        }
    }
    if (i < 0)
        return !needPair;
    if (needPair && counts[i] >= 2) {
        counts[i] -= 2;
        if (canAllTriplets(counts, false)) {
            counts[i] += 2;
            return true;
        }
        counts[i] += 2;
    }
    if (counts[i] >= 3) {
        counts[i] -= 3;
        if (canAllTriplets(counts, needPair)) {
            counts[i] += 3;
            return true;
        }
        counts[i] += 3;
    }
    return false;
}
/** 判断牌型特征 */
export function analyzePattern(hand, melds) {
    let suited = 0;
    let honor = 0;
    for (let t = 0; t < ALL_KINDS; t++) {
        const n = hand[t];
        if (!n)
            continue;
        if (isSuited(t))
            suited++;
        else
            honor++;
    }
    for (const m of melds) {
        if (isSuited(m.tile))
            suited++;
        else
            honor++;
    }
    const suits = new Set();
    for (let t = 0; t < ALL_KINDS; t++) {
        if (hand[t] > 0 && isSuited(t))
            suits.add(Math.floor(t / 9));
    }
    for (const m of melds)
        if (isSuited(m.tile))
            suits.add(Math.floor(m.tile / 9));
    // 碰碰胡：副露无刻子以外的组（不能有吃），且手牌可全拆成刻子 + 将
    const allTriplets = melds.every((m) => m.type !== 'chow') && canAllTriplets(countsCopy(hand), true);
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
export function calculateWin(ctx) {
    const cfg = ctx.config;
    const names = [];
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
    }
    else {
        flowers += cfg.baseFlower;
        flowerLines.push(`底花 ${cfg.baseFlower} 花`);
    }
    const pat = analyzePattern(ctx.hand, ctx.melds);
    if (ctx.huangZhuang) {
        names.push('黄庄');
        exponent += 1;
    }
    if (ctx.afterKong) {
        names.push('杠开');
        exponent += 1;
    }
    if (ctx.exposedCount === 0) {
        names.push('门清');
        exponent += 1;
    }
    if (ctx.exposedCount === 4) {
        names.push('大吊车');
        exponent += 1;
    }
    if (pat.isPengPeng) {
        names.push('碰碰胡');
        exponent += 1;
    }
    if (pat.isHunYiSe) {
        names.push('混一色');
        exponent += 1;
    }
    if (pat.isQingYiSe) {
        names.push('清一色');
        exponent += 2;
    }
    if (pat.isHunPeng) {
        names.push('混碰');
        exponent += 2;
    }
    if (pat.isQingPeng) {
        names.push('清碰');
        exponent += 3;
    }
    let multiplier = flowers * Math.pow(2, exponent) * ctx.huangMultiplier;
    if (ctx.selfDraw && cfg.selfDrawTriple)
        multiplier *= 3;
    if (ctx.robKong)
        multiplier *= 3;
    let capped = false;
    const cap = cfg.capMultiplier * cfg.baseScore;
    if (multiplier > cap) {
        multiplier = cap;
        capped = true;
    }
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
export function meetsFlowerThreshold(hand, melds, collectedFlowers, selfDraw, config = DEFAULT_CONFIG) {
    const fb = computeFlowers(hand, melds, collectedFlowers);
    const flowers = fb.flowers + config.baseFlower;
    const required = selfDraw ? config.selfDrawMinFlowers : config.ronMinFlowers;
    return { ok: flowers >= required, flowers, required };
}
