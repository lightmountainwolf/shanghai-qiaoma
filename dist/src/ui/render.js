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
    feltA: '#1e4a3c',
    feltB: '#0f2820',
    gold: '#d4af6a',
    goldDim: '#8a7040',
    tileTop: '#fffdf6',
    tileBot: '#f0e8d5',
    tileSide: '#c4b699',
    tileEdge: '#8f8264',
    red: '#b83c2e',
    green: '#177a48',
    blue: '#26578f',
    ink: '#33301f',
    text: '#f2e8d4',
    dim: '#a3977e',
    shadow: 'rgba(0,0,0,.4)',
};
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
            // 竖屏：牌桌比例接近 9:13，手牌区占底部约 22%
            this.H = Math.max(560, Math.min(availH, availW * 1.45));
            this.W = availW;
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
                topY: 58,
                sideY,
                sideX: 44,
            };
        }
        else {
            this.W = availW;
            this.H = Math.min(availH, availW * 0.62);
            const tw = Math.min(52, (this.W - 40 - 13 * 3) / 14);
            const th = tw * 1.38;
            this.L = {
                tileW: tw, tileH: th, gap: 3,
                // 手牌贴底，上方留出花牌/徽标空间
                handY: this.H - th - 10,
                oppTw: 22, oppTh: 30,
                topY: 74,
                sideY: this.H * 0.42,
                sideX: Math.max(120, this.W * 0.13),
            };
        }
        this.canvas.width = this.W;
        this.canvas.height = this.H;
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
        const grad = g.createRadialGradient(this.W / 2, this.H * 0.42, 40, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75);
        grad.addColorStop(0, C.feltA);
        grad.addColorStop(1, C.feltB);
        g.fillStyle = grad;
        g.fillRect(0, 0, this.W, this.H);
        // 中心微光
        g.save();
        const gl = g.createRadialGradient(this.W / 2, this.H * 0.45, 10, this.W / 2, this.H * 0.45, this.W * 0.4);
        gl.addColorStop(0, 'rgba(212,175,106,.06)');
        gl.addColorStop(1, 'rgba(212,175,106,0)');
        g.fillStyle = gl;
        g.fillRect(0, 0, this.W, this.H);
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
    drawTopPlayer(p, myId) {
        const tiles = this.tilesOf(p);
        const { oppTw: tw, oppTh: th, gap, topY } = this.L;
        const total = tiles.length * (tw + gap) - gap;
        const x0 = this.W / 2 - total / 2;
        this.drawPlayerTag(this.W / 2, topY - 30, p, myId);
        for (let i = 0; i < tiles.length; i++) {
            this.drawTileBack(x0 + i * (tw + gap), topY, tw, th, p.hasQi);
        }
        if (p.melds.length) {
            const mx = this.W / 2 - (p.melds.length * (tw + 6)) / 2;
            for (let i = 0; i < p.melds.length; i++) {
                this.drawTile(mx + i * (tw + 6), topY + th + 6, tw, th, p.melds[i].tile, false);
            }
        }
        // 对家补好的花牌
        if (p.flowers.length) {
            const fs = Math.max(11, tw * 0.8);
            const totalM = p.melds.length > 0 ? p.melds.length * (tw + 6) - 6 : 0;
            this.drawFlowerTiles(p.flowers, this.W / 2 + totalM / 2 + 8, topY + th + 6, fs, 1);
        }
    }
    drawSidePlayer(p, cx, cy, myId) {
        const tiles = this.tilesOf(p);
        const { oppTw: tw, oppTh: th, gap } = this.L;
        const total = tiles.length * (tw + gap) - gap;
        const x0 = cx - total / 2;
        this.drawPlayerTag(cx, cy - 34, p, myId);
        for (let i = 0; i < tiles.length; i++) {
            this.drawTileBack(x0 + i * (tw + gap), cy, tw, th, p.hasQi);
        }
        if (p.melds.length) {
            for (let i = 0; i < p.melds.length; i++) {
                this.drawTile(x0 + i * (tw + 5), cy + th + 8, tw, th, p.melds[i].tile, false);
            }
        }
        // 左右家补好的花牌
        if (p.flowers.length) {
            const fs = Math.max(11, tw * 0.8);
            this.drawFlowerTiles(p.flowers, x0, cy + th + 8 + th + 6, fs, 1);
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
        this.drawPlayerTag(this.W / 2, 32, p, myId);
        for (let i = 0; i < tiles.length; i++) {
            this.drawTileBack(x0 + i * (tw + 2), y0, tw, th, p.hasQi);
        }
        if (p.melds.length) {
            const mw = Math.min(tw + 4, (availW - (p.melds.length - 1) * 4) / p.melds.length);
            const totalM = p.melds.length * (mw + 4) - 4;
            const mx = this.W / 2 - totalM / 2;
            for (let i = 0; i < p.melds.length; i++) {
                this.drawTile(mx + i * (mw + 4), y0 + th + 5, mw, mw * 1.35, p.melds[i].tile, false);
            }
        }
        // 对家补好的花牌（横向排在副露右侧，因为上方空间是横向的）
        if (p.flowers.length) {
            const fs = Math.max(11, Math.min(tw, this.L.oppTw) * 0.8);
            const totalM = p.melds.length > 0 ? p.melds.length * (tw + 4) - 4 : 0;
            this.drawFlowerTiles(p.flowers, this.W / 2 + totalM / 2 + 8, y0 + th + 5, fs, 1);
        }
    }
    drawSidePortrait(p, cx, cy, myId) {
        const tiles = this.tilesOf(p);
        const tw = this.L.oppTw;
        const cardH = Math.min(this.L.oppTh, 15);
        const vGap = 3;
        // 牌堆高度受可用空间限制，超出则压缩密度
        const maxH = Math.min(this.L.tileH * 3.2, (this.L.sideY - this.L.topY) * 0.62);
        let rows = Math.ceil(tiles.length / 2);
        let totalH = rows * (cardH + vGap) - vGap;
        const compressed = totalH > maxH;
        if (compressed) {
            // 压缩：改为单列密排，并限制最多显示 12 张
            const shown = Math.min(tiles.length, 12);
            rows = shown;
            totalH = shown * (cardH * 0.62 + vGap) - vGap;
        }
        const startY = cy - totalH / 2;
        this.drawPlayerTag(cx, startY - 24, p, myId);
        const x0 = cx - tw - 1.5;
        for (let i = 0; i < Math.min(tiles.length, rows * (compressed ? 1 : 2)); i++) {
            const c = compressed ? 0 : i < rows ? 0 : 1;
            const row = compressed ? i : i < rows ? i : i - rows;
            const h = compressed ? cardH * 0.62 : cardH;
            this.drawTileBack(x0 + c * (tw + 3), startY + row * (h + vGap), tw, h, p.hasQi);
        }
        // 超出部分用计数标注
        if (tiles.length > (compressed ? rows : rows * 2)) {
            const gg = this.ctx;
            gg.save();
            gg.font = '9px "PingFang SC", sans-serif';
            gg.fillStyle = C.dim;
            gg.textAlign = 'center';
            gg.textBaseline = 'middle';
            gg.fillText(`${tiles.length}张`, cx, startY + totalH + 9);
            gg.restore();
        }
        if (p.melds.length) {
            const n = Math.min(p.melds.length, 3);
            const mw = tw + 2;
            const totalM = n * (mw + 3) - 3;
            const mx = cx - totalM / 2;
            for (let i = 0; i < n; i++) {
                this.drawTile(mx + i * (mw + 3), startY + totalH + 20, mw, mw * 1.3, p.melds[i].tile, false);
            }
        }
        // 左右家补好的花牌（摆在副露下方）
        if (p.flowers.length) {
            const fs = Math.max(11, tw * 0.85);
            const my = p.melds.length > 0 ? startY + totalH + 20 + (tw + 2) * 1.3 + 6 : startY + totalH + 20;
            this.drawFlowerTiles(p.flowers, cx - 16, my, fs, 2);
        }
    }
    drawPlayerTag(cx, cy, p, myId) {
        const g = this.ctx;
        const isTurn = this.game.turn === p.id;
        const flowers = this.game.playerFlowers(p.id);
        g.save();
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (isTurn) {
            g.fillStyle = 'rgba(212,175,106,.14)';
            g.beginPath();
            g.arc(cx, cy, this.portrait ? 34 : 44, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = C.gold;
            g.lineWidth = 1.4;
            g.stroke();
        }
        g.font = `600 ${this.portrait ? 12 : 13}px "PingFang SC", sans-serif`;
        g.fillStyle = isTurn ? C.gold : C.text;
        g.fillText(`P${p.id}${p.id === myId ? '（你）' : ''}`, cx, cy - 8);
        // 第二行：已敲 / 手牌张数
        g.font = `${this.portrait ? 10 : 10.5}px "PingFang SC", sans-serif`;
        if (p.hasQi) {
            g.fillStyle = '#e8b04b';
            g.fillText('已敲', cx, cy + 6);
        }
        else {
            // 注意：p.hand 是长度 34 的计数数组，不能直接取 .length
            const tileCount = this.game.tilesInHand(p.id);
            g.fillStyle = C.dim;
            g.fillText(`${tileCount} 张`, cx, cy + 6);
        }
        // 第三行：得分 + 花数（花数是门槛指标，必须让对手可见）
        g.font = `${this.portrait ? 11 : 12}px "PingFang SC", sans-serif`;
        g.fillStyle = p.score > 0 ? '#7dd6a0' : p.score < 0 ? '#e58a8a' : C.dim;
        g.fillText(p.score > 0 ? `+${p.score}` : `${p.score}`, cx - 10, cy + 19);
        g.fillStyle =
            flowers >= this.game.config.ronMinFlowers ? C.gold
                : flowers >= this.game.config.selfDrawMinFlowers ? '#7fc7a5'
                    : '#d68a7a';
        g.fillText(`花${flowers}`, cx + 14, cy + 19);
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
        let cursorY = handY - th - 5;
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
        // ③ 花数徽标
        this.drawFlowerCounter(playerId, me, cursorY - 13);
        cursorY -= 28;
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
            const lift = isSel ? th * 0.26 : canSel ? th * 0.1 : 0;
            this.drawTile(tx, handY - lift + dy, tw, th, t, isSel, canSel);
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
    drawFlowerCounter(playerId, p, y) {
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
        const cx = this.W / 2;
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
        // 横屏时左右两家是横向大排手牌，牌河要落在它们内侧，否则会压住手牌
        const x0 = portrait
            ? Math.max(86, this.W * 0.215)
            : Math.max(L.sideX + 170, this.W * 0.30);
        const x1 = this.W - x0;
        const y0 = L.topY + L.oppTh + (portrait ? 50 : 46);
        // 下边界贴着手牌区上方留白：副露/花牌/听口提示越多，牌河区就越小
        const y1 = Math.max(y0 + 44, this.handTopY - 12);
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
        // ---- 牌墙进度：右上角小徽标，不压牌河也不挡玩家信息 ----
        const barW = portrait ? Math.min(84, this.W * 0.22) : 96;
        const barH = 4;
        const bx = this.W - 12 - barW;
        const by = 20;
        g.save();
        g.textAlign = 'right';
        g.textBaseline = 'middle';
        g.font = `${portrait ? 10 : 11}px "PingFang SC", sans-serif`;
        g.fillStyle = C.dim;
        g.fillText(`牌墙 ${this.game.wall.remaining}`
            + (this.game.huangFan > 0 ? ` · 荒番 ×${this.game.huangFan}` : ''), this.W - 12, by - 8);
        g.fillStyle = 'rgba(0,0,0,.38)';
        this.roundRect(bx, by, barW, barH, 2);
        g.fill();
        const ratio = Math.min(1, this.game.wall.remaining / 144);
        const bg = g.createLinearGradient(bx, 0, bx + barW, 0);
        if (ratio > 0.3) {
            bg.addColorStop(0, '#8a7040');
            bg.addColorStop(1, C.gold);
        }
        else {
            bg.addColorStop(0, '#7a2f22');
            bg.addColorStop(1, '#c0392b');
        }
        g.fillStyle = bg;
        this.roundRect(bx, by, Math.max(2, barW * ratio), barH, 2);
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
        const grad = g.createLinearGradient(x, y, x + w, y + h);
        if (qi) {
            grad.addColorStop(0, '#4a7d67');
            grad.addColorStop(1, '#2d5748');
        }
        else {
            grad.addColorStop(0, '#41678a');
            grad.addColorStop(1, '#28455c');
        }
        g.fillStyle = grad;
        this.roundRect(x, y, w, h - 2, r);
        g.fill();
        g.strokeStyle = qi ? C.gold : '#6f92b0';
        g.lineWidth = 0.6;
        this.roundRect(x + 0.3, y + 0.3, w - 0.6, h - 2.6, r);
        g.stroke();
        g.globalAlpha = qi ? 0.4 : 0.16;
        g.fillStyle = qi ? C.gold : '#ffffff';
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
