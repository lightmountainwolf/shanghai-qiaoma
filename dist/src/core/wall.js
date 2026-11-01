/**
 * 上海敲麻 · 牌墙
 *
 * 144 张：
 *   万筒条各 1-9 共 27 种 × 4 = 108
 *   风牌东南西北 4 种 × 4 = 16
 *   中发白 3 种 × 4 = 12
 *   季节花牌春夏秋冬、梅兰竹菊 8 种各 1 = 8
 *
 * 其中「常规牌」124 张（万筒条 + 风牌），「花牌」20 张（中发白 + 季节花）。
 * 花牌摸到即亮出并向牌墙补一张，不进手牌。
 */
import { ALL_KINDS, FLOWERS, isFlower } from './tiles.js';
export const WALL_SIZE = 144;
/** 花牌总数：中发白 12 + 季节花 8 */
export const TOTAL_FLOWERS = 20;
export class Wall {
    tiles;
    pos = 0;
    constructor(seed) {
        const rng = seed !== undefined ? mulberry32(seed) : Math.random;
        this.tiles = [];
        // 136 张牌（含中发白）
        for (let t = 0; t < ALL_KINDS; t++) {
            for (let k = 0; k < 4; k++)
                this.tiles.push(t);
        }
        // 8 张季节花牌，各 1 张
        for (let i = 0; i < FLOWERS.length; i++)
            this.tiles.push(-1 - i);
        shuffle(this.tiles, rng);
    }
    draw() {
        if (this.pos >= this.tiles.length)
            return null;
        return this.tiles[this.pos++];
    }
    /** 剩余总张数（含花牌） */
    get remaining() {
        return this.tiles.length - this.pos;
    }
    /** 剩余常规牌数（不含花牌） */
    get remainingNormal() {
        let n = 0;
        for (let i = this.pos; i < this.tiles.length; i++) {
            if (!isFlower(this.tiles[i]))
                n++;
        }
        return n;
    }
    /** 剩余花牌数（含中发白） */
    get remainingFlowers() {
        let n = 0;
        for (let i = this.pos; i < this.tiles.length; i++) {
            if (isFlower(this.tiles[i]))
                n++;
        }
        return n;
    }
    /** 剩余常规牌计数，用于 AI 推理（不含花牌） */
    remainingCounts() {
        const c = new Int8Array(ALL_KINDS);
        for (let i = this.pos; i < this.tiles.length; i++) {
            const t = this.tiles[i];
            if (!isFlower(t))
                c[t]++;
        }
        return c;
    }
}
export function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
