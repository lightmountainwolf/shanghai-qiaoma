/**
 * 上海敲麻 · 响应式渲染器
 *
 * 竖屏（手机）与横屏（桌面）两套布局，由 isPortrait() 在运行时切换。
 * 竖屏要点：
 *   - 牌桌改为纵向 9:12比例，匹配麻将桌实际观感
 *   - 手牌自动缩放，保证 14 张始终在一屏内
 *   - 对手手牌竖排（牌背朝上，纵向堆叠），符合手机端习惯
 */
import { suitOf, tileChar, tileName, ALL_KINDS, } from '../core/tiles.js';
import { meldTiles } from '../core/scoring.js';
import { drawTileFace, drawTileBody, drawFlowerChip, } from './tileface.js';
const C = {
    // 牌桌配色参考 JJ 麻将：亮翡翠绿桌面 + 暖金色包边
    feltA: '#2f9e76',
    feltMid: '#1d825f',
    feltB: '#116b4b',
    tableEdge: '#0a2f23',
    gold: '#e3c07a',
    goldDim: '#8a7040',
    tileTop: '#fffdf6',
    tileBot: '#f0e8d5',
    tileSide: '#c4b699',
    tileEdge: '#8f8264',
    red: '#b83c2e',
    green: '#177a48',
    blue: '#26578f',
    ink: '#33301f',
    text: '#f4ecda',
    dim: '#b9ae94',
    shadow: 'rgba(0,0,0,.4)',
};
/** 座位昵称（JJ 风格：座位卡片上显示昵称而不是 P0/P1） */
const SEAT_NAMES = ['你', '阿飞', '小美', '老李'];
/** 每个座位的头像主色 */
const SEAT_COLORS = [
    { bg1: '#ffd27a', bg2: '#d99434', hair: '#3a2c1c', cloth: '#d9553f' },
    { bg1: '#8fc3ff', bg2: '#3f7fc0', hair: '#23262e', cloth: '#2f6fb8' },
    { bg1: '#ffb0d8', bg2: '#c85f96', hair: '#4a2b1e', cloth: '#cf5f9c' },
    { bg1: '#9fe0c2', bg2: '#3f9a72', hair: '#5c5c50', cloth: '#2f8f63' },
];
export class Renderer {
    canvas;
    ctx;
    game;
    hitAreas = [];
    selected = -1;
    portrait = false;
    W = 1080;
    H = 620;
    /** 补好的花牌块占用的高度（供上方元素定位） */
    flowerBlockH = 0;
    /** 自己的副露块占用的高度 */
    meldBlockH = 0;
    /** 自己手牌区（含副露/花牌/徽标/听口提示）的最高点，供中央牌河避让 */
    handTopY = 0;
    /** 对家副露/花牌块的最低点，供中央牌河避让 */
    oppTopBottom = 0;
    /** 最近补花的事件（用于闪烁提示），{player, flower, at} */
    lastFlowerEvent = null;
    seenFlowerCount = 0;
    /** 刚摸到的牌：单独摆在手牌最右侧，并带滑入动效 */
    drawnTile = -1;
    drawnAt = 0;
    /** 最近一次弃牌的标识与动效时间（中央最新弃牌的落位动画） */
    lastDiscardKey = '';
    discardFxAt = 0;
    /** 点击了不能打出的牌时的红色反馈 */
    invalidTile = -1;
    invalidAt = 0;
    /** 布局参数，随模式变化 */
    L;
    constructor(canvas, game) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.game = game;
    }
    hitTest(x, y) {
        for (let i = this.hitAreas.length - 1; i >= 0; i--) {
            const h = this.hitAreas[i];
            if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)
                return h;
        }
        return null;
    }
    /** 新开一局时清空动效状态，避免残留上一局的动画 */
    resetFx() {
        this.drawnTile = -1;
        this.drawnAt = 0;
        this.lastDiscardKey = '';
        this.discardFxAt = 0;
        this.invalidTile = -1;
        this.invalidAt = 0;
        this.lastFlowerEvent = null;
        this.seenFlowerCount = 0;
    }
    /** 点击了当前不能打出的牌：短暂红色描边反馈 */
    flashInvalid(t) {
        this.invalidTile = t;
        this.invalidAt = Date.now();
    }
    /** 是否还有动效在播放（主循环据此决定要不要继续重绘） */
    animActive() {
        const now = Date.now();
        return (now - this.drawnAt < 300
            || now - this.discardFxAt < 320
            || now - this.invalidAt < 420
            || (this.lastFlowerEvent !== null && now - this.lastFlowerEvent.at < 2200));
    }
    /** 根据视口重新计算画布尺寸与布局 */
    layout(availW, availH) {
        const portrait = availH > availW * 1.05;
        this.portrait = portrait;
        if (portrait) {
            // 竖屏：画布必须与容器等比，否则 CSS 拉伸会让牌面/头像变形
            this.W = availW;
            this.H = Math.max(400, availH);
            const maxHandW = this.W - 16;
            // 14 张 + 13 间隙 必须放得下
            let tw = (maxHandW - 13 * 2) / 14;
            tw = Math.min(tw, 46);
            const th = Math.min(tw * 1.38, 66);
            // 中部区域：对家 + 左右家 + 中央弃牌区
            // 手牌上方需留出：花牌块 + 花数徽标 + 已敲听口提示（约 82px）
            const handOverhead = 116;
            const topH = 96;
            // 中央区按「手牌 + 上方元素」的总高度来计算，保证不与手牌区重叠
            const usable = this.H - (th + handOverhead) - topH;
            const sideY = topH + usable * 0.5;
            this.L = {
                tileW: tw, tileH: th, gap: 2,
                // 手牌贴底，上方元素自然向上排
                handY: this.H - th - 12,
                oppTw: Math.min(26, this.W * 0.062),
                oppTh: Math.min(32, this.W * 0.076),
                oppMeldTw: Math.min(26, this.W * 0.062),
                topY: 58,
                sideY,
                sideX: 44,
            };
        }
        else {
            // 横屏：同样按容器实际高宽，避免画布被非等比拉伸
            this.W = availW;
            this.H = availH;
            // 横屏空间更宽裕，牌适当放大；同时给牌河与座位留出空间
            const byW = (this.W - 40 - 13 * 3) / 14;
            const byH = (this.H * 0.20) / 1.38;
            const tw = Math.max(24, Math.min(64, byW, byH));
            const th = tw * 1.38;
            const oppTw = Math.max(15, Math.min(26, tw * 0.40));
            // 对手副露只用于展示，尺寸明显小于手牌：
            // 否则矮横屏时对家两行副露会一路压到中央牌河（牌河徽标被叠住）
            const oppMeldTw = Math.max(13, Math.min(30, tw * 0.52));
            this.L = {
                tileW: tw, tileH: th, gap: 3,
                // 手牌贴底，上方留出花牌/徽标空间
                handY: this.H - th - 10,
                oppTw, oppTh: oppTw * 1.44,
                oppMeldTw,
                topY: Math.max(54, Math.min(74, this.H * 0.13)),
                sideY: this.H * 0.42,
                sideX: Math.max(112, this.W * 0.13),
            };
        }
        this.canvas.width = this.W;
        this.canvas.height = this.H;
    }
    /** 矮横屏（手机横放）：画布很矮，把花数徽标挪到左上角，给中央牌河腾高度 */
    get compactChrome() {
        return !this.portrait && this.H < 380;
    }
    draw(playerId, opts) {
        const g = this.ctx;
        const L = this.L;
        this.hitAreas = [];
        // 检测新的补花事件，用于高亮提示（"花牌自动亮出补牌"要让玩家看见）
        const evs = this.game.flowerEvents;
        if (evs.length > this.seenFlowerCount) {
            const e = evs[evs.length - 1];
            this.lastFlowerEvent = { player: e.player, flower: e.flower, at: Date.now() };
            this.seenFlowerCount = evs.length;
        }
        // 记录本次摸到的牌（用于单独摆放 + 滑入动效）
        const jd = this.game.phase === 'discard' && this.game.turn === playerId
            ? this.game.justDrawn : -1;
        if (jd !== this.drawnTile) {
            this.drawnTile = jd;
            this.drawnAt = Date.now();
        }
        // 弃牌发生变化：让中央那张牌从出牌方位滑入，打牌更有「落子」感
        const ld = this.game.lastDiscard;
        const ldKey = ld ? `${ld.player}|${ld.tile}|${this.game.discardPiles[ld.player].length}` : '';
        if (ldKey !== this.lastDiscardKey) {
            this.lastDiscardKey = ldKey;
            this.discardFxAt = ld ? Date.now() : 0;
        }
        // 桌面外的深色边框
        g.fillStyle = C.tableEdge;
        g.fillRect(0, 0, this.W, this.H);
        // 牌桌本体：亮翡翠绿渐变 + 金色包边（JJ 麻将的牌桌观感）
        const tx = 3;
        const ty = 3;
        const tw = this.W - 6;
        const th = this.H - 6;
        const felt = g.createLinearGradient(0, ty, 0, ty + th);
        felt.addColorStop(0, C.feltA);
        felt.addColorStop(0.55, C.feltMid);
        felt.addColorStop(1, C.feltB);
        this.roundRect(tx, ty, tw, th, 14);
        g.fillStyle = felt;
        g.fill();
        // 四周压暗，中间提亮，让视线集中在牌河
        const vign = g.createRadialGradient(this.W / 2, this.H * 0.45, 20, this.W / 2, this.H * 0.45, Math.max(this.W, this.H) * 0.78);
        vign.addColorStop(0, 'rgba(255,255,255,.10)');
        vign.addColorStop(0.45, 'rgba(255,255,255,.02)');
        vign.addColorStop(1, 'rgba(0,20,14,.42)');
        g.fillStyle = vign;
        this.roundRect(tx, ty, tw, th, 14);
        g.fill();
        // 金色包边 + 内侧细线
        g.save();
        g.strokeStyle = 'rgba(227,192,122,.62)';
        g.lineWidth = 2;
        this.roundRect(tx, ty, tw, th, 14);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.10)';
        g.lineWidth = 1;
        this.roundRect(tx + 4, ty + 4, tw - 8, th - 8, 11);
        g.stroke();
        g.restore();
        // 桌面水印（JJ 麻将桌面同款居中暗纹）
        g.save();
        g.globalAlpha = 0.07;
        g.fillStyle = '#ffffff';
        g.font = `700 ${this.portrait ? 42 : 54}px "PingFang SC", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('上海敲麻', this.W / 2, this.H * (this.portrait ? 0.42 : 0.44));
        g.restore();
        const me = this.game.players[playerId];
        const right = this.game.players[(playerId + 1) % 4];
        const across = this.game.players[(playerId + 2) % 4];
        const left = this.game.players[(playerId + 3) % 4];
        if (this.portrait) {
            this.drawTopPortrait(across, playerId);
            this.drawSidePortrait(left, L.sideX, L.sideY, playerId);
            this.drawSidePortrait(right, this.W - L.sideX, L.sideY, playerId);
        }
        else {
            this.drawTopPlayer(across, playerId);
            this.drawSidePlayer(left, L.sideX, L.sideY, playerId);
            this.drawSidePlayer(right, this.W - L.sideX, L.sideY, playerId);
        }
        this.drawMyHand(me, playerId, opts);
        this.drawCenter(playerId);
        this.drawWallBadge();
        // 矮横屏：花数徽标挂在左上角「剩余牌张」右侧
        if (this.compactChrome) {
            this.drawFlowerCounter(playerId, me, 20, 122);
        }
        this.drawFlowerFlash(playerId);
    }
    /** 补花提示：谁的什么花被亮出并补了牌，短暂高亮 */
    drawFlowerFlash(myId) {
        const ev = this.lastFlowerEvent;
        if (!ev)
            return;
        const age = Date.now() - ev.at;
        if (age > 2200)
            return;
        const g = this.ctx;
        const alpha = age < 1800 ? 1 : 1 - (age - 1800) / 400;
        const who = ev.player === myId ? '你' : `P${ev.player}`;
        const text = `${who} 亮出「${tileChar(ev.flower)}」，从牌墙补一张`;
        g.save();
        g.globalAlpha = alpha;
        g.font = `${this.portrait ? 12 : 13}px "PingFang SC", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const w = g.measureText(text).width;
        const x = this.W / 2;
        const y = this.portrait ? 18 : 24;
        g.fillStyle = 'rgba(212,175,106,.92)';
        this.roundRect(x - w / 2 - 14, y - 12, w + 28, 24, 12);
        g.fill();
        g.fillStyle = '#3a2c14';
        g.fillText(text, x, y);
        g.restore();
    }
    // ---------- 对手：横屏 ----------
    // ---------- 对手副露：整组显示，放不下就换行 ----------
    /**
     * 计算副露排版：每组都保持完整的 3/4 张牌，绝不折叠成一张。
     * 一行放不下就换到下一行（上下排布）。
     */
    meldBlock(p, baseTw, maxW) {
        const gap = Math.max(1, Math.round(baseTw * 0.08));
        const groupGap = Math.max(3, Math.round(baseTw * 0.24));
        const vGap = 4;
        const maxGroup = Math.max(1, ...p.melds.map((m) => meldTiles(m).length));
        // 极窄的竖屏侧栏放不下一个杠（4 张）时，只把该家副露整体微调一点，
        // 保证不越界；正常宽度下不缩放。
        const mw = Math.max(8, Math.min(baseTw, (maxW - (maxGroup - 1) * gap) / maxGroup));
        const mh = mw * 1.36;
        const rows = [];
        let groups = [];
        let rowW = 0;
        for (const m of p.melds) {
            const g = meldTiles(m);
            const gw = g.length * mw + (g.length - 1) * gap;
            if (groups.length && rowW + groupGap + gw > maxW) {
                rows.push({ groups, w: rowW });
                groups = [];
                rowW = 0;
            }
            rowW += (groups.length ? groupGap : 0) + gw;
            groups.push(g);
        }
        if (groups.length)
            rows.push({ groups, w: rowW });
        const w = rows.reduce((a, r) => Math.max(a, r.w), 0);
        const h = rows.length ? rows.length * mh + (rows.length - 1) * vGap : 0;
        return { rows, w, h, mw, mh, gap, groupGap, vGap };
    }
    /**
     * 画出对手的全部副露：每行居中，行内保留组间距。
     * @returns 占用的宽度与高度，供花牌与中央牌河避让
     */
    drawMeldBlock(p, centerX, topY, baseTw, maxW) {
        const b = this.meldBlock(p, baseTw, maxW);
        let y = topY;
        for (const row of b.rows) {
            let x = centerX - row.w / 2;
            for (const g of row.groups) {
                for (const t of g) {
                    this.drawTile(x, y, b.mw, b.mh, t, false);
                    x += b.mw + b.gap;
                }
                x += b.groupGap - b.gap;
            }
            y += b.mh + b.vGap;
        }
        return { w: b.w, h: b.h };
    }
    drawTopPlayer(p, myId) {
        const tiles = this.tilesOf(p);
        const { oppTw: tw, oppTh: th, gap, topY } = this.L;
        const total = tiles.length * (tw + gap) - gap;
        const x0 = this.W / 2 - total / 2;
        this.drawSeat(this.W / 2, topY - 30, p, myId, 'center');
        for (let i = 0; i < tiles.length; i++) {
            this.drawTileBack(x0 + i * (tw + gap), topY, tw, th, p.hasQi);
        }
        const my = topY + th + 6;
        let meldW = 0;
        let meldH = 0;
        if (p.melds.length) {
            const b = this.drawMeldBlock(p, this.W / 2, my, this.L.oppMeldTw, this.W - 32);
            meldW = b.w;
            meldH = b.h;
        }
        let bottom = my + meldH;
        // 对家补好的花牌：优先摆在副露右侧，放不下就排在副露下方
        if (p.flowers.length) {
            const fs = Math.max(11, this.L.oppMeldTw * 0.8);
            const fw = p.flowers.length * (fs + 2) - 2;
            const rightX = this.W / 2 + meldW / 2 + 8;
            if (meldW > 0 && rightX + fw <= this.W - 10) {
                this.drawFlowerTiles(p.flowers, rightX, my, fs, 1);
                bottom = Math.max(bottom, my + fs);
            }
            else {
                const fy = my + meldH + (meldH > 0 ? 4 : 0);
                this.drawFlowerTiles(p.flowers, this.W / 2 - fw / 2, fy, fs, 1);
                bottom = Math.max(bottom, fy + fs);
            }
        }
        this.oppTopBottom = bottom;
    }
    drawSidePlayer(p, cx, cy, myId) {
        const tiles = this.tilesOf(p);
        const { oppTw: tw, oppTh: th, gap } = this.L;
        const total = tiles.length * (tw + gap) - gap;
        // 左右家的手牌贴着画布边缘向内排，避免超出屏幕被裁掉
        const x0 = cx < this.W / 2 ? 10 : this.W - total - 10;
        this.drawSeat(cx, cy - 34, p, myId, cx < this.W / 2 ? 'left' : 'right');
        for (let i = 0; i < tiles.length; i++) {
            this.drawTileBack(x0 + i * (tw + gap), cy, tw, th, p.hasQi);
        }
        const my = cy + th + 8;
        let bottom = my;
        if (p.melds.length) {
            // 副露以手牌块为中心向两侧展开，但不越过中央牌河
            const center = x0 + total / 2;
            const maxW = Math.max(tw * 3 + 8, cx < this.W / 2
                ? 2 * (this.W * 0.30 - 6 - center)
                : 2 * (center - this.W * 0.70 - 6));
            const b = this.drawMeldBlock(p, center, my, this.L.oppMeldTw, maxW);
            bottom = my + b.h;
        }
        // 左右家补好的花牌（横排排在副露下方）
        if (p.flowers.length) {
            const fs = Math.max(11, this.L.oppMeldTw * 0.8);
            const fw = p.flowers.length * (fs + 2) - 2;
            this.drawFlowerTiles(p.flowers, x0 + total / 2 - fw / 2, bottom + 4, fs, 1);
        }
    }
    // ---------- 对手：竖屏（牌竖排，更接近手机习惯） ----------
    drawTopPortrait(p, myId) {
        const tiles = this.tilesOf(p);
        // 按可用宽度反推单牌宽度，保证不溢出
        const availW = this.W - 24;
        let tw = (availW - (tiles.length - 1) * 2) / Math.max(1, tiles.length);
        tw = Math.min(tw, this.L.oppTw);
        const th = Math.min(tw * 1.3, this.L.oppTh);
        const total = tiles.length * (tw + 2) - 2;
        const x0 = this.W / 2 - total / 2;
        const y0 = this.L.topY;
        this.drawSeat(this.W / 2, 32, p, myId, 'center');
        for (let i = 0; i < tiles.length; i++) {
            this.drawTileBack(x0 + i * (tw + 2), y0, tw, th, p.hasQi);
        }
        const my = y0 + th + 5;
        let meldW = 0;
        let bottom = my;
        if (p.melds.length) {
            // 整组副露完整显示（一条二条三条 要能看出是顺子），放不下就换行
            const b = this.drawMeldBlock(p, this.W / 2, my, Math.min(tw, this.L.oppTw), availW);
            meldW = b.w;
            bottom = my + b.h;
        }
        // 对家补好的花牌：副露右侧放得下就排右侧，否则排到副露下方
        if (p.flowers.length) {
            const fs = Math.max(11, Math.min(tw, this.L.oppTw) * 0.8);
            const fw = p.flowers.length * (fs + 2) - 2;
            const rightX = this.W / 2 + meldW / 2 + 8;
            if (meldW > 0 && rightX + fw <= this.W - 8) {
                this.drawFlowerTiles(p.flowers, rightX, my, fs, 1);
            }
            else {
                const fy = bottom + (meldW > 0 ? 4 : 0);
                this.drawFlowerTiles(p.flowers, this.W / 2 - fw / 2, fy, fs, 1);
                bottom = fy + fs;
            }
        }
        this.oppTopBottom = bottom;
    }
    drawSidePortrait(p, cx, cy, myId) {
        const tiles = this.tilesOf(p);
        const tw = this.L.oppTw;
        const vGap = 3;
        const cols = tiles.length > 1 ? 2 : 1;
        // 两列竖排；高度放不下时按行数压缩单牌高度，保证始终完整显示所有牌
        const maxH = Math.min(this.L.tileH * 3.2, (this.L.sideY - this.L.topY) * 0.62);
        const rows = Math.ceil(tiles.length / cols);
        let cardH = Math.min(this.L.oppTh, 15);
        let totalH = rows * (cardH + vGap) - vGap;
        if (totalH > maxH) {
            cardH = Math.max(5, (maxH - (rows - 1) * vGap) / rows);
            totalH = rows * (cardH + vGap) - vGap;
        }
        const startY = cy - totalH / 2;
        this.drawSeat(cx, startY - 24, p, myId, cx < this.W / 2 ? 'left' : 'right');
        const blockW = cols * (tw + 3) - 3;
        const x0 = cx - blockW / 2;
        for (let i = 0; i < tiles.length; i++) {
            const c = Math.floor(i / rows);
            const row = i % rows;
            this.drawTileBack(x0 + c * (tw + 3), startY + row * (cardH + vGap), tw, cardH, p.hasQi);
        }
        const my = startY + totalH + 20;
        let bottom = my;
        if (p.melds.length) {
            // 中央牌河从 W*0.215 开始：副露以手牌块为中心排，放不下就上下换行
            const riverStart = Math.max(86, this.W * 0.215);
            const maxW = Math.max(40, 2 * (riverStart - 6 - cx));
            const b = this.drawMeldBlock(p, cx, my, tw + 2, maxW);
            bottom = my + b.h;
        }
        // 左右家补好的花牌（摆在副露下方）
        if (p.flowers.length) {
            const fs = Math.max(11, tw * 0.85);
            this.drawFlowerTiles(p.flowers, cx - 16, bottom + 6, fs, 2);
        }
    }
    /**
     * 座位卡片（JJ 麻将同款）：圆头像 + 昵称 + 豆/分 + 花数，
     * 回合中的座位用金色描边和光晕高亮。
     * @param align center 顶部对家居中；left/right 左右家贴边，避免被裁掉
     */
    drawSeat(cx, cy, p, myId, align) {
        const g = this.ctx;
        const portrait = this.portrait;
        const isTurn = this.game.turn === p.id;
        const flowers = this.game.playerFlowers(p.id);
        const cardW = portrait ? 108 : 126;
        const cardH = portrait ? 34 : 36;
        const x = align === 'center' ? cx - cardW / 2
            : align === 'left' ? 6 : this.W - cardW - 6;
        const y = cy - cardH / 2;
        g.save();
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        // 卡片底
        this.roundRect(x, y, cardW, cardH, cardH / 2);
        g.fillStyle = 'rgba(4,26,19,.74)';
        g.fill();
        if (isTurn) {
            const bg = g.createLinearGradient(x, y, x, y + cardH);
            bg.addColorStop(0, 'rgba(255,228,160,.30)');
            bg.addColorStop(1, 'rgba(212,175,106,.10)');
            g.fillStyle = bg;
            this.roundRect(x, y, cardW, cardH, cardH / 2);
            g.fill();
            g.save();
            g.shadowColor = 'rgba(227,192,122,.8)';
            g.shadowBlur = 10;
            g.strokeStyle = C.gold;
            g.lineWidth = 1.8;
            this.roundRect(x, y, cardW, cardH, cardH / 2);
            g.stroke();
            g.restore();
        }
        else {
            g.strokeStyle = 'rgba(227,192,122,.42)';
            g.lineWidth = 1;
            this.roundRect(x, y, cardW, cardH, cardH / 2);
            g.stroke();
        }
        // 头像
        const r = cardH / 2 - 3;
        const ax = x + r + 4;
        this.drawAvatar(ax, cy, r, p, isTurn);
        // 昵称
        const tx = ax + r + 7;
        g.font = `600 ${portrait ? 11 : 11.5}px "PingFang SC", sans-serif`;
        g.fillStyle = isTurn ? C.gold : C.text;
        g.fillText(SEAT_NAMES[p.id], tx, cy - 6);
        // 分数 + 花数
        g.font = `${portrait ? 9.5 : 10}px "PingFang SC", sans-serif`;
        const scoreTxt = p.score > 0 ? `+${p.score}` : `${p.score}`;
        g.fillStyle = p.score > 0 ? '#8be7b8' : p.score < 0 ? '#f2a3a3' : C.dim;
        g.fillText(scoreTxt, tx, cy + 7);
        const sw = g.measureText(scoreTxt).width;
        g.fillStyle =
            flowers >= this.game.config.ronMinFlowers ? C.gold
                : flowers >= this.game.config.selfDrawMinFlowers ? '#8fd6b0'
                    : '#e09a88';
        g.fillText(`· 花${flowers}`, tx + sw + 3, cy + 7);
        // 右侧状态：已敲 / 手牌张数
        g.textAlign = 'right';
        g.font = `${portrait ? 9.5 : 10}px "PingFang SC", sans-serif`;
        if (p.hasQi) {
            g.fillStyle = '#f2c15a';
            g.fillText('已敲', x + cardW - 8, cy - 6);
        }
        else {
            g.fillStyle = C.dim;
            // 注意：p.hand 是长度 34 的计数数组，不能直接取 .length
            g.fillText(`${this.game.tilesInHand(p.id)}张`, x + cardW - 8, cy - 6);
        }
        g.restore();
    }
    /** 座位头像：渐变底色 + 简易卡通脸，无图片资源也能有 JJ 的卡通感 */
    drawAvatar(cx, cy, r, p, isTurn) {
        const g = this.ctx;
        const col = SEAT_COLORS[p.id];
        g.save();
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.clip();
        // 底色
        const bg = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
        bg.addColorStop(0, col.bg1);
        bg.addColorStop(1, col.bg2);
        g.fillStyle = bg;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
        // 肩部
        g.fillStyle = col.cloth;
        g.beginPath();
        g.arc(cx, cy + r * 0.98, r * 0.82, 0, Math.PI);
        g.fill();
        // 脸
        g.fillStyle = '#f7d7b2';
        g.beginPath();
        g.arc(cx, cy + r * 0.02, r * 0.56, 0, Math.PI * 2);
        g.fill();
        // 头发
        g.fillStyle = col.hair;
        g.beginPath();
        g.arc(cx, cy - r * 0.16, r * 0.60, Math.PI, Math.PI * 2);
        g.fill();
        // 眼睛 + 嘴
        g.fillStyle = '#33261a';
        g.beginPath();
        g.arc(cx - r * 0.18, cy + r * 0.02, r * 0.075, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.arc(cx + r * 0.18, cy + r * 0.02, r * 0.075, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#a8745a';
        g.lineWidth = Math.max(1, r * 0.07);
        g.beginPath();
        g.arc(cx, cy + r * 0.20, r * 0.18, Math.PI * 0.18, Math.PI * 0.82);
        g.stroke();
        g.restore();
        // 外圈：回合金色，已敲青绿，普通暖白
        g.save();
        if (isTurn) {
            g.shadowColor = 'rgba(227,192,122,.85)';
            g.shadowBlur = 9;
        }
        g.strokeStyle = isTurn ? C.gold : p.hasQi ? '#6fe0ae' : 'rgba(255,246,224,.78)';
        g.lineWidth = isTurn ? 2.3 : 1.5;
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
        g.restore();
    }
    // ---------- 自己的手牌 ----------
    /**
     * 绘制自己的手牌区。
     * 从手牌往上依次堆叠：手牌 → 副露 → 花牌 → 花数徽标 → 已敲听口提示。
     * 用游标（cursorY）逐层向上排，没有多余间距，也不会互相重叠。
     */
    drawMyHand(me, playerId, opts) {
        const g = this.ctx;
        const all = this.tilesOf(me);
        // 刚摸到的牌单独摆在最右侧，与手牌留出空隙（主流麻将游戏的做法，
        // 让玩家一眼分清「哪张是新摸的」）
        let hand = all;
        let drawn = -1;
        if (this.drawnTile >= 0) {
            const idx = all.lastIndexOf(this.drawnTile);
            if (idx >= 0) {
                hand = all.slice(0, idx).concat(all.slice(idx + 1));
                drawn = this.drawnTile;
            }
        }
        const { tileW: maxTw, tileH: maxTh, gap } = this.L;
        const n = hand.length + (drawn >= 0 ? 1 : 0);
        // 按花色分组，组间留出更宽的缝，扫一眼就能找到某一门的牌
        const groupGap = Math.max(5, maxTw * 0.26);
        let extra = 0;
        for (let i = 1; i < hand.length; i++) {
            if (suitOf(hand[i]) !== suitOf(hand[i - 1]))
                extra += groupGap;
        }
        if (drawn >= 0)
            extra += groupGap * 1.4;
        const avail = this.W - 16;
        const tw = Math.max(10, Math.min(maxTw, (avail - extra - (n - 1) * gap) / Math.max(1, n)));
        const th = Math.min(tw * 1.38, maxTh);
        const handY = this.L.handY + (maxTh - th);
        const total = n * tw + (n - 1) * gap + extra;
        let x = this.W / 2 - total / 2;
        // 游标：从手牌顶部再往上一点开始
        // 横屏高度更紧，留出的空白更少，把空间让给中央牌河
        let cursorY = handY - (this.portrait ? th + 5 : th * 0.42 + 5);
        // ① 副露（吃碰杠）—— 紧贴手牌，是打牌时最需要看的
        const meldH = this.drawMyMelds(me, cursorY);
        this.meldBlockH = meldH;
        if (meldH > 0)
            cursorY -= meldH + 4;
        // ② 补好的花牌（横排，自动折行）
        let flowerH = 0;
        if (me.flowers.length > 0) {
            const fh = Math.max(11, Math.min(th * 0.26, 17));
            const fstep = fh + 2;
            const perRow = Math.max(6, Math.floor((this.W - 24) / fstep));
            const rows = Math.ceil(me.flowers.length / perRow);
            flowerH = rows * fstep;
            const fyBase = cursorY - flowerH;
            for (let i = 0; i < me.flowers.length; i++) {
                const row = Math.floor(i / perRow);
                const col = i % perRow;
                const inRow = Math.min(me.flowers.length - row * perRow, perRow);
                const rowW = inRow * fstep - 2;
                const fx = this.W / 2 - rowW / 2 + col * fstep;
                this.drawMiniFlowerTile(fx, fyBase + row * fstep, fh, me.flowers[i]);
            }
            cursorY -= flowerH + 2;
        }
        this.flowerBlockH = flowerH;
        // ③ 花数徽标（矮横屏时挪到左上角，见 draw()，给中央牌河腾出高度）
        if (!this.compactChrome) {
            this.drawFlowerCounter(playerId, me, cursorY - 13);
            cursorY -= 28;
        }
        // ④ 已敲听口提示
        if (me.hasQi) {
            g.save();
            g.font = `${this.portrait ? 12 : 13}px "PingFang SC", sans-serif`;
            g.fillStyle = C.gold;
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(`已敲 · 听 ${me.qiTiles.map((t) => tileName(t)).join(' ')}`, this.W / 2, cursorY);
            g.restore();
        }
        // 记录手牌区最上方（含副露/花牌/花数徽标/听口提示），中央牌河以此避让
        this.handTopY = me.hasQi ? cursorY - 8 : cursorY + 4;
        // ⑤ 手牌本体（最后画，保证盖住下方元素）
        // 轮到自己出牌时，把「不能打出的牌」压暗，可选牌自然凸显
        const isDiscardTurn = opts.selectable.size > 0;
        const faceH = th - Math.max(2, th * 0.055);
        const drawOne = (t, tx, dy = 0) => {
            const canSel = opts.selectable.has(t);
            const isSel = this.selected === t && canSel;
            const isRec = canSel && opts.recommended === t;
            const lift = isSel ? th * 0.26 : canSel ? th * 0.1 : 0;
            this.drawTile(tx, handY - lift + dy, tw, th, t, isSel, canSel);
            // 推荐弃牌（JJ 手牌上的「荐」标）：金色光晕 + 角标
            if (isRec) {
                g.save();
                g.shadowColor = 'rgba(255,214,120,.85)';
                g.shadowBlur = 10;
                g.strokeStyle = 'rgba(255,226,150,.9)';
                g.lineWidth = 1.5;
                this.roundRect(tx + 1, handY - lift + dy + 1, tw - 2, th - 3, Math.max(3, tw * 0.12));
                g.stroke();
                g.restore();
                const bw = Math.max(13, tw * 0.46);
                const bh = Math.max(12, th * 0.19);
                const bx = tx + tw - bw - 2;
                // 角标放在牌面上方，不遮挡牌面图案
                const by = handY - lift + dy - bh - 1;
                g.save();
                g.fillStyle = '#2f6fc4';
                this.roundRect(bx, by, bw, bh, 3);
                g.fill();
                g.strokeStyle = 'rgba(255,255,255,.65)';
                g.lineWidth = 0.8;
                this.roundRect(bx, by, bw, bh, 3);
                g.stroke();
                g.fillStyle = '#ffffff';
                g.font = `600 ${Math.max(8, bh * 0.78)}px "PingFang SC", sans-serif`;
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillText('荐', bx + bw / 2, by + bh / 2);
                g.restore();
            }
            if (isDiscardTurn && !canSel) {
                g.save();
                g.fillStyle = 'rgba(6,14,10,.42)';
                this.roundRect(tx, handY - lift + dy, tw, faceH, Math.max(3, tw * 0.12));
                g.fill();
                g.restore();
            }
            // 点错 / 打不出的牌：红色描边闪一下
            if (this.invalidTile === t) {
                const age = Date.now() - this.invalidAt;
                if (age < 380) {
                    g.save();
                    g.globalAlpha = 1 - age / 380;
                    g.strokeStyle = '#e2685a';
                    g.lineWidth = 2;
                    this.roundRect(tx - 1, handY - lift + dy - 1, tw + 2, th + 1, 5);
                    g.stroke();
                    g.restore();
                }
            }
            this.hitAreas.push({
                playerId, tile: t, x: tx, y: handY - lift + dy - 6,
                w: tw, h: th + 6, kind: 'hand',
            });
        };
        for (let i = 0; i < hand.length; i++) {
            if (i > 0 && suitOf(hand[i]) !== suitOf(hand[i - 1]))
                x += groupGap;
            drawOne(hand[i], x);
            x += tw + gap;
        }
        // 摸入的牌：独立摆放 + 从下方滑入 + 轻微金色光晕
        if (drawn >= 0) {
            x += groupGap * 1.4 - gap;
            const age = Date.now() - this.drawnAt;
            const p = Math.min(1, age / 260);
            const e = 1 - Math.pow(1 - p, 3);
            const rise = (1 - e) * 20; // 从下方滑入到最终位置
            g.save();
            g.shadowColor = 'rgba(212,175,106,.5)';
            g.shadowBlur = 9;
            drawOne(drawn, x, rise);
            g.restore();
        }
    }
    /** 花数徽标：显示当前花数与门槛（y 由调用方按游标给出） */
    drawFlowerCounter(playerId, p, y, boxLeft) {
        const g = this.ctx;
        const game = this.game;
        const fb = game.flowerBreakdown(playerId);
        const total = fb.flowers + game.config.baseFlower;
        const cfg = game.config;
        g.save();
        g.font = `${this.portrait ? 10.5 : 11.5}px "PingFang SC", sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const label = `花 ${total} · 自摸≥${cfg.selfDrawMinFlowers} · 点炮≥${cfg.ronMinFlowers}`;
        const w = g.measureText(label).width;
        // boxLeft 给了就左对齐到该位置，否则居中
        const cx = boxLeft !== undefined ? boxLeft + 10 + w / 2 : this.W / 2;
        g.fillStyle = 'rgba(0,0,0,.45)';
        this.roundRect(cx - w / 2 - 10, y - 11, w + 20, 22, 7);
        g.fill();
        g.strokeStyle =
            total >= cfg.ronMinFlowers ? C.gold
                : total >= cfg.selfDrawMinFlowers ? '#7fc7a5'
                    : 'rgba(210,130,115,.95)';
        g.lineWidth = 1;
        this.roundRect(cx - w / 2 - 10, y - 11, w + 20, 22, 7);
        g.stroke();
        g.fillStyle = C.text;
        g.fillText(label, cx, y);
        g.restore();
    }
    /**
     * 绘制自己的副露（吃碰杠）。
     * 摆在自己手牌正上方，按组排列，组间留空隙便于区分。
     * 返回该块占用的高度（0 表示无副露）。
     */
    drawMyMelds(me, bottomY) {
        if (me.melds.length === 0)
            return 0;
        const g = this.ctx;
        // 副露牌略小于手牌，但要比花牌大，保证看得清
        const { tileW: tw, tileH: th } = this.L;
        const mw = Math.max(16, Math.min(tw * 0.82, th * 0.66));
        const mh = mw * 1.36;
        const innerGap = Math.max(1, mw * 0.04);
        const groupGap = Math.max(6, mw * 0.42);
        const groups = me.melds.map((m) => meldTiles(m));
        const totalTiles = groups.reduce((a, t) => a + t.length, 0);
        const totalW = totalTiles * (mw + innerGap) + (groups.length - 1) * groupGap;
        let mx = this.W / 2 - totalW / 2;
        const my = bottomY - mh;
        // 全部用正面显示（玩家需要看到自己碰/杠的是什么牌）
        // 暗杠额外加金色边框，与明刻区分
        me.melds.forEach((m, gi) => {
            const tiles = groups[gi];
            const isAnkan = m.type === 'ankan';
            for (let k = 0; k < tiles.length; k++) {
                this.drawTile(mx, my, mw, mh, tiles[k], false, false, isAnkan);
                mx += mw + innerGap;
            }
            mx += groupGap;
        });
        return mh;
    }
    /** 迷你花牌（用于展示补好的花）：季节花与中发白都用红字小牌 */
    drawMiniFlowerTile(x, y, s, t) {
        drawFlowerChip(this.ctx, x, y, s, t);
    }
    // ---------- 中央：弃牌 + 牌墙 ----------
    /**
     * 绘制四家牌河与牌墙进度。
     *
     * 旧版四家牌河会互相压住（左右两家的竖排直接叠在上下两家的横排上），
     * 而且小牌是「花色小标 + 数字」的简略图，不像真正的麻将。
     * 现在改为：
     *   1. 先划出一块不与任何手牌 / 副露相交的「牌河区」；
     *   2. 四个牌河按十字分布：自己在下、对家在上、下家在右、上家在左，
     *      每个牌块各自居中并朝自己的方位生长，互不重叠；
     *   3. 每张弃牌都用完整经典牌面，最新打出的一张加金色描边并做落位缩放；
     *   4. 牌多到放不下时只缩小该牌块，保证不越界、不压别家。
     */
    drawCenter(playerId) {
        const g = this.ctx;
        const L = this.L;
        const portrait = this.portrait;
        const cx = this.W / 2;
        // ---- 牌河区：避开四家手牌、自己的副露/花牌与顶部玩家信息 ----
        // 横屏时左右家的手牌贴边横排，牌河区要让开它们的实际宽度
        const sideSpan = 13 * (L.oppTw + L.gap) + 12;
        const x0 = portrait
            ? Math.max(86, this.W * 0.215)
            : Math.max(L.sideX + 170, this.W * 0.30, 10 + sideSpan);
        const x1 = this.W - x0;
        const y1 = this.handTopY - 10;
        const y0raw = Math.max(L.topY + L.oppTh + (portrait ? 50 : 46), this.oppTopBottom + 10);
        // 与花数徽标冲突时，宁可让牌河贴近对家副露，也不能压住自己的手牌信息
        const y0 = Math.min(y0raw, y1 - 24);
        // 下边界贴着手牌区上方留白：副露/花牌/听口提示越多，牌河区就越小
        // 横屏很矮时也优先保住花数徽标，不为了牌河强行越过手牌区
        const cy = (y0 + y1) / 2;
        // 单张弃牌的尺寸：按牌河区反推，保证上下各 4 行、左右各 3 列都放得下
        const rw = Math.max(10, Math.min(portrait ? 19 : 24, Math.min((x1 - x0) / 15.5, (y1 - y0) / 11.5)));
        const rh = rw * 1.38;
        const gap = Math.max(1, rw * 0.08);
        const midGap = Math.max(4, rw * 0.45);
        // 左右牌河的宽度上限：把中间一条留给上下牌河，防止两者横向挤在一起
        const sideSlotW = Math.min((x1 - x0) / 2 - midGap, Math.max(rw * 2.5, (x1 - x0) * 0.22));
        const last = this.game.lastDiscard;
        const now = Date.now();
        // 画一张弃牌：经典完整牌面；最新的一张带金色描边 + 落位缩放
        const put = (x, y, w, h, t, newest) => {
            if (!newest) {
                this.drawTile(x, y, w, h, t, false, false, false);
                return;
            }
            const age = now - this.discardFxAt;
            const p = this.discardFxAt ? Math.min(1, age / 260) : 1;
            const s = 1.14 - 0.14 * (1 - Math.pow(1 - p, 3));
            const nw = w * s, nh = h * s;
            g.save();
            g.shadowColor = 'rgba(212,175,106,.5)';
            g.shadowBlur = 8;
            this.drawTile(x - (nw - w) / 2, y - (nh - h) / 2, nw, nh, t, false, false, true);
            g.restore();
        };
        // 相对方位：0 自己(下) 1 下家(右) 2 对家(上) 3 上家(左)
        for (let rel = 0; rel < 4; rel++) {
            const pid = (playerId + rel) % 4;
            const pile = this.game.pileOf(pid);
            if (pile.length === 0)
                continue;
            const horizontal = rel === 0 || rel === 2;
            // 可用空间：横排要给左右牌河让位；竖排只能用左右各自的槽位宽度
            const availW = horizontal
                ? (x1 - x0) - 2 * (sideSlotW + midGap)
                : sideSlotW;
            const availH = horizontal ? (y1 - y0) / 2 - midGap : (y1 - y0);
            // 每行/每列张数：默认横排 6、竖排 8；空间不够时先加宽，
            // 尽量别把牌压得太小
            const capW = Math.max(1, Math.floor((availW + gap) / (rw + gap)));
            const capH = Math.max(1, Math.floor((availH + gap) / (rh + gap)));
            const perLine = horizontal
                ? Math.min(capW, Math.max(6, Math.ceil(pile.length / capH)))
                : Math.min(capH, Math.max(8, Math.ceil(pile.length / capW)));
            const lines = Math.ceil(pile.length / perLine);
            const inFirst = Math.min(pile.length, perLine);
            // 牌块在横向 / 纵向各占几格
            const cellsW = horizontal ? inFirst : lines;
            const cellsH = horizontal ? lines : inFirst;
            let w = rw, h = rh, gp = gap;
            const needW = cellsW * (w + gp) - gp;
            const needH = cellsH * (h + gp) - gp;
            // 放不下就整体等比缩小，绝不越界
            const s = Math.min(1, availW / Math.max(1, needW), availH / Math.max(1, needH));
            if (s < 1) {
                w *= s;
                h *= s;
                gp *= s;
            }
            const stepX = w + gp;
            const stepY = h + gp;
            const blockH = cellsH * stepY - gp;
            for (let i = 0; i < pile.length; i++) {
                const line = Math.floor(i / perLine);
                const idx = i % perLine;
                const inLine = Math.min(pile.length - line * perLine, perLine);
                const newest = last !== null && last.player === pid && i === pile.length - 1;
                if (horizontal) {
                    // 每行按本行实际张数居中；自己往下生长，对家往上生长
                    const rowW = inLine * stepX - gp;
                    const px = cx - rowW / 2 + idx * stepX;
                    const py = rel === 0
                        ? cy + midGap + line * stepY
                        : cy - midGap - blockH + line * stepY;
                    put(px, py, w, h, pile[i], newest);
                }
                else {
                    // 每列按本列实际张数垂直居中；下家在右（向左生长），上家在左（向右生长）
                    const colH = inLine * stepY - gp;
                    const px = rel === 1 ? x1 - w - line * stepX : x0 + line * stepX;
                    const py = cy - colH / 2 + idx * stepY;
                    put(px, py, w, h, pile[i], newest);
                }
            }
        }
    }
    /**
     * 左上角「剩余牌张」信息牌：JJ 麻将同款位置，
     * 大号数字 + 底部进度条，荒番时额外标注。
     */
    drawWallBadge() {
        const g = this.ctx;
        const portrait = this.portrait;
        const remain = this.game.wall.remaining;
        const w = portrait ? 94 : 106;
        const h = 36;
        const x = 8;
        const y = 8;
        g.save();
        g.fillStyle = 'rgba(4,26,19,.80)';
        this.roundRect(x, y, w, h, 9);
        g.fill();
        g.strokeStyle = 'rgba(227,192,122,.55)';
        g.lineWidth = 1;
        this.roundRect(x, y, w, h, 9);
        g.stroke();
        // 小牌背图标
        const ix = x + 8;
        const iy = y + 9;
        const iw = 13;
        const ih = 17;
        const back = g.createLinearGradient(ix, iy, ix + iw, iy + ih);
        back.addColorStop(0, '#54c99c');
        back.addColorStop(1, '#1d8a63');
        g.fillStyle = back;
        this.roundRect(ix, iy, iw, ih, 3);
        g.fill();
        g.strokeStyle = 'rgba(255,246,220,.55)';
        this.roundRect(ix, iy, iw, ih, 3);
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,.30)';
        this.roundRect(ix + 3, iy + 4, iw - 6, ih - 8, 1.5);
        g.fill();
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = `${portrait ? 8.5 : 9}px "PingFang SC", sans-serif`;
        g.fillStyle = C.dim;
        g.fillText('剩余牌张', ix + iw + 7, y + 12);
        g.font = `700 ${portrait ? 15 : 16}px "PingFang SC", sans-serif`;
        g.fillStyle = C.gold;
        g.fillText(`${remain}`, ix + iw + 7, y + 25);
        // 荒番（有才显示）
        if (this.game.huangFan > 0) {
            g.textAlign = 'right';
            g.font = `${portrait ? 8.5 : 9}px "PingFang SC", sans-serif`;
            g.fillStyle = '#f2b0a0';
            g.fillText(`荒番×${this.game.huangFan}`, x + w - 8, y + 12);
        }
        // 进度条
        const bx = x + 8;
        const bw = w - 16;
        const by = y + h - 6;
        g.fillStyle = 'rgba(0,0,0,.38)';
        this.roundRect(bx, by, bw, 3, 1.5);
        g.fill();
        const ratio = Math.min(1, remain / 144);
        const bar = g.createLinearGradient(bx, 0, bx + bw, 0);
        if (ratio > 0.3) {
            bar.addColorStop(0, '#8a7040');
            bar.addColorStop(1, C.gold);
        }
        else {
            bar.addColorStop(0, '#7a2f22');
            bar.addColorStop(1, '#c0392b');
        }
        g.fillStyle = bar;
        this.roundRect(bx, by, Math.max(2, bw * ratio), 3, 1.5);
        g.fill();
        g.restore();
    }
    /**
     * 画出一家亮出的花牌（补花摊在桌面上）。
     * @param cols 每列张数（超过则换列）
     */
    drawFlowerTiles(flowers, x, y, size, cols) {
        for (let i = 0; i < flowers.length; i++) {
            const c = Math.floor(i / cols);
            const r = i % cols;
            this.drawMiniFlowerTile(x + c * (size + 2), y + r * (size + 2), size, flowers[i]);
        }
    }
    tilesOf(p) {
        const out = [];
        for (let t = 0; t < ALL_KINDS; t++)
            for (let k = 0; k < p.hand[t]; k++)
                out.push(t);
        return out;
    }
    // ---------- 牌面绘制 ----------
    /**
     * 绘制一张正面牌。
     * 牌面外观由 tileface.ts 负责（经典麻将外观，带离屏缓存）。
     */
    drawTile(x, y, w, h, t, selected, canSel = false, discard = false) {
        const g = this.ctx;
        const r = Math.max(3, w * 0.12);
        const depth = Math.max(2, h * 0.055);
        const faceH = h - depth;
        g.save();
        // 牌身（阴影 + 侧面厚度）
        drawTileBody(g, x, y, w, faceH);
        // 可选中的牌加一层暖色底，提示可以点
        if (canSel && !selected) {
            g.fillStyle = 'rgba(212,175,106,.14)';
            this.roundRect(x, y, w, faceH, r);
            g.fill();
        }
        // 牌面图案
        drawTileFace(g, x, y, w, faceH, t);
        if (discard) {
            g.strokeStyle = C.gold;
            g.lineWidth = 1.6;
            this.roundRect(x + 1, y + 1, w - 2, faceH - 2, r);
            g.stroke();
        }
        if (selected) {
            g.strokeStyle = C.gold;
            g.lineWidth = 2.6;
            this.roundRect(x + 1.2, y + 1.2, w - 2.4, faceH - 2.4, r);
            g.stroke();
            // 选中时上浮高亮
            g.fillStyle = 'rgba(212,175,106,.18)';
            this.roundRect(x, y, w, faceH, r);
            g.fill();
        }
        g.restore();
    }
    drawTileBack(x, y, w, h, qi) {
        const g = this.ctx;
        const r = Math.max(2, w * 0.12);
        g.save();
        g.fillStyle = C.shadow;
        this.roundRect(x + 0.8, y + 1.6, w, h, r);
        g.fill();
        // JJ 风格：亮翡翠绿牌背（已敲换成香槟金，一眼区分）
        const grad = g.createLinearGradient(x, y, x + w, y + h);
        if (qi) {
            grad.addColorStop(0, '#e8c37a');
            grad.addColorStop(1, '#a8792f');
        }
        else {
            grad.addColorStop(0, '#54c99c');
            grad.addColorStop(1, '#1d8a63');
        }
        g.fillStyle = grad;
        this.roundRect(x, y, w, h - 2, r);
        g.fill();
        // 顶部受光边
        g.globalAlpha = 0.55;
        g.fillStyle = 'rgba(255,255,255,.75)';
        this.roundRect(x + w * 0.08, y + 1.2, w * 0.84, Math.max(1.2, h * 0.06), 1);
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = qi ? 'rgba(255,240,190,.75)' : 'rgba(255,246,220,.55)';
        g.lineWidth = 0.6;
        this.roundRect(x + 0.3, y + 0.3, w - 0.6, h - 2.6, r);
        g.stroke();
        g.globalAlpha = qi ? 0.42 : 0.24;
        g.fillStyle = qi ? '#fff4cf' : 'rgba(255,255,255,.9)';
        this.roundRect(x + w * 0.24, y + h * 0.24, w * 0.52, h * 0.44, 2);
        g.fill();
        g.restore();
    }
    roundRect(x, y, w, h, r) {
        const g = this.ctx;
        const rr = Math.min(r, w / 2, h / 2);
        g.beginPath();
        g.moveTo(x + rr, y);
        g.arcTo(x + w, y, x + w, y + h, rr);
        g.arcTo(x + w, y + h, x, y + h, rr);
        g.arcTo(x, y + h, x, y, rr);
        g.arcTo(x, y, x + w, y, rr);
        g.closePath();
    }
}
