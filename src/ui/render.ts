/**
 * 上海敲麻 · 响应式渲染器
 *
 * 竖屏（手机）与横屏（桌面）两套布局，由 isPortrait() 在运行时切换。
 * 竖屏要点：
 *   - 牌桌改为纵向 9:12比例，匹配麻将桌实际观感
 *   - 手牌自动缩放，保证 14 张始终在一屏内
 *   - 对手手牌竖排（牌背朝上，纵向堆叠），符合手机端习惯
 */

import {
  isSuited, isWind, isDragon, suitOf, rankOf, tileChar, ALL_KINDS, FLOWERS,
} from '../core/tiles.js';
import { Game, PlayerState } from '../core/game.js';
import { meldTiles } from '../core/scoring.js';
import {
  drawTileFace, drawTileBody, drawFlowerChip,
} from './tileface.js';

/** 牌面文字用的牌名（万筒条字牌与花牌） */
const CN_ZI = ['东', '南', '西', '北', '中', '发', '白'];
const COL_RED = '#b8342a';
const COL_GREEN = '#146b40';
const COL_BLUE = '#1f4f8a';

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
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  game: Game;
  hitAreas: { playerId: number; tile: number; x: number; y: number; w: number; h: number; kind: string }[] = [];
  selected = -1;
  portrait = false;
  W = 1080;
  H = 620;

  /** 补好的花牌块占用的高度（供上方元素定位） */
  private flowerBlockH = 0;
  /** 自己的副露块占用的高度 */
  private meldBlockH = 0;

  /** 最近补花的事件（用于闪烁提示），{player, flower, at} */
  private lastFlowerEvent: { player: number; flower: number; at: number } | null = null;
  private seenFlowerCount = 0;
  /** 布局参数，随模式变化 */
  private L!: {
    tileW: number; tileH: number; gap: number;
    handY: number; oppTw: number; oppTh: number;
    sideX: number; topY: number; sideY: number;
  };

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.game = game;
  }

  hitTest(x: number, y: number) {
    for (let i = this.hitAreas.length - 1; i >= 0; i--) {
      const h = this.hitAreas[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }

  /** 根据视口重新计算画布尺寸与布局 */
  layout(availW: number, availH: number) {
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
    } else {
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

  draw(playerId: number, opts: { selectable: Set<number> }) {
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

    const grad = g.createRadialGradient(
      this.W / 2, this.H * 0.42, 40, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.75,
    );
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
    } else {
      this.drawTopPlayer(across, playerId);
      this.drawSidePlayer(left, L.sideX, L.sideY, playerId);
      this.drawSidePlayer(right, this.W - L.sideX, L.sideY, playerId);
    }

    this.drawMyHand(me, playerId, opts);
    this.drawCenter();
    this.drawFlowerFlash(playerId);
  }

  /** 补花提示：谁的什么花被亮出并补了牌，短暂高亮 */
  private drawFlowerFlash(myId: number) {
    const ev = this.lastFlowerEvent;
    if (!ev) return;
    const age = Date.now() - ev.at;
    if (age > 2200) return;

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

  private drawTopPlayer(p: PlayerState, myId: number) {
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

  private drawSidePlayer(p: PlayerState, cx: number, cy: number, myId: number) {
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

  private drawTopPortrait(p: PlayerState, myId: number) {
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
      this.drawFlowerTiles(
        p.flowers,
        this.W / 2 + totalM / 2 + 8,
        y0 + th + 5,
        fs, 1,
      );
    }
  }

  private drawSidePortrait(p: PlayerState, cx: number, cy: number, myId: number) {
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

  private drawPlayerTag(cx: number, cy: number, p: PlayerState, myId: number) {
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
    } else {
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
  private drawMyHand(me: PlayerState, playerId: number, opts: { selectable: Set<number> }) {
    const g = this.ctx;
    const tiles = this.tilesOf(me);
    const { tileW: tw, tileH: th, gap, handY } = this.L;
    const n = tiles.length;
    const total = n * (tw + gap) - gap;
    const x0 = this.W / 2 - total / 2;

    // 游标：从手牌顶部再往上一点开始
    let cursorY = handY - th - 5;

    // ① 副露（吃碰杠）—— 紧贴手牌，是打牌时最需要看的
    const meldH = this.drawMyMelds(me, cursorY);
    this.meldBlockH = meldH;
    if (meldH > 0) cursorY -= meldH + 4;

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
      g.fillText(
        `已敲 · 听 ${me.qiTiles.map((t) => tileChar(t)).join(' ')}`,
        this.W / 2, cursorY,
      );
      g.restore();
    }

    // ⑤ 手牌本体（最后画，保证盖住下方元素）
    for (let i = 0; i < n; i++) {
      const t = tiles[i];
      const x = x0 + i * (tw + gap);
      const canSel = opts.selectable.has(t);
      const lift = this.selected === t ? th * 0.24 : canSel ? th * 0.1 : 0;
      this.drawTile(x, handY - lift, tw, th, t, this.selected === t, canSel);
      this.hitAreas.push({
        playerId, tile: t, x, y: handY - lift - 6,
        w: tw, h: th + 6, kind: 'hand',
      });
    }
  }

  /** 花数徽标：显示当前花数与门槛（y 由调用方按游标给出） */
  private drawFlowerCounter(playerId: number, p: PlayerState, y: number) {
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
  private drawMyMelds(me: PlayerState, bottomY: number): number {
    if (me.melds.length === 0) return 0;

    const g = this.ctx;
    // 副露牌略小于手牌，但要比花牌大，保证看得清
    const { tileW: tw, tileH: th } = this.L;
    const mw = Math.max(16, Math.min(tw * 0.82, th * 0.66));
    const mh = mw * 1.36;
    const innerGap = Math.max(1, mw * 0.04);
    const groupGap = Math.max(6, mw * 0.42);

    const groups = me.melds.map((m) => meldTiles(m));
    const totalTiles = groups.reduce((a, t) => a + t.length, 0);
    const totalW =
      totalTiles * (mw + innerGap) + (groups.length - 1) * groupGap;

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
  private drawMiniFlowerTile(x: number, y: number, s: number, t: number) {
    drawFlowerChip(this.ctx, x, y, s, t);
  }

  // ---------- 中央：弃牌 + 牌墙 ----------

  private drawCenter() {
    const g = this.ctx;
    const cx = this.W / 2;
    const cy = this.portrait ? this.L.sideY : this.H / 2 - 18;
    const { tileW: tw, tileH: th } = this.L;

    // 牌河占中央区域；提示条放在中央上方，三者不重叠
    const pw = Math.max(14, tw * 0.4);
    const ph = Math.max(19, th * 0.38);
    this.drawDiscardPiles(cx, cy, pw, ph, tw, th);

    // 中央高亮区：刚打出的那张牌
    if (this.game.lastDiscard) {
      const dw = tw * 0.8, dh = th * 0.8;
      this.drawTile(cx - dw / 2, cy - dh / 2, dw, dh, this.game.lastDiscard.tile, false, false, true);
    }

    // 牌墙进度条：中央上方
    const barW = Math.min(this.W * 0.42, 230);
    const barH = 5;
    const bx = cx - barW / 2;
    const by = cy - th * 0.62 - ph - 26;
    const ratio = this.game.wall.remaining / 144;

    g.save();
    g.fillStyle = 'rgba(0,0,0,.38)';
    this.roundRect(bx, by, barW, barH, 3);
    g.fill();
    const bg = g.createLinearGradient(bx, 0, bx + barW, 0);
    if (ratio > 0.3) { bg.addColorStop(0, '#8a7040'); bg.addColorStop(1, C.gold); }
    else { bg.addColorStop(0, '#7a2f22'); bg.addColorStop(1, '#c0392b'); }
    g.fillStyle = bg;
    this.roundRect(bx, by, barW * ratio, barH, 3);
    g.fill();

    g.font = '10px "PingFang SC", sans-serif';
    g.fillStyle = C.dim;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(
      `牌墙 ${this.game.wall.remaining}` +
        (this.game.huangFan > 0 ? ` · 荒番 ×${this.game.huangFan}` : ''),
      cx, by - 9,
    );
    g.restore();

    // 回合提示：牌墙条再上方
    g.save();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${this.portrait ? 12 : 13}px "PingFang SC", sans-serif`;
    g.fillStyle = this.game.turn === 0 ? C.gold : C.dim;
    g.fillText(
      this.game.turn === 0 ? '轮到你出牌' : `轮到 P${this.game.turn}`,
      cx, by - 26,
    );
    g.restore();
  }

  /**
   * 绘制四家牌河（弃牌堆）。
   * 每家占据中央的一个方位，互不重叠：
   *   自己(P0) → 中央下方；右家(P1) → 右；左家(P3) → 左；对家(P2) → 上方（牌墙条之上）
   */
  private drawDiscardPiles(cx: number, cy: number, pw: number, ph: number, tw: number, th: number) {
    const step = pw + 2;
    const vStep = ph + 2;
    const PER_ROW = 6;

    // 相对 P0：0=自己(bottom) 1=下家(right) 2=对家(top) 3=上家(left)
    const dirs: ('bottom' | 'right' | 'top' | 'left')[] = ['bottom', 'right', 'top', 'left'];

    for (let pid = 0; pid < 4; pid++) {
      const pile = this.game.pileOf(pid);
      if (pile.length === 0) continue;
      const dir = dirs[pid];

      if (dir === 'bottom' || dir === 'top') {
        // 横向排布，向上/向下逐行生长
        const grow = dir === 'bottom' ? 1 : -1;
        const baseY = dir === 'bottom' ? cy + th * 0.5 : cy - th * 0.5 - ph - vStep;
        // 对家(P2)往左偏一格，避免与自己(P0)的牌河视觉混淆
        const dx = dir === 'top' ? -PER_ROW * (pw + 2) * 0.24 : 0;
        for (let i = 0; i < pile.length; i++) {
          const row = Math.floor(i / PER_ROW);
          const col = i % PER_ROW;
          const inRow = Math.min(pile.length - row * PER_ROW, PER_ROW);
          const rowW = inRow * step - 2;
          const x = cx + dx - rowW / 2 + col * step;
          const y = baseY + grow * row * vStep;
          this.drawMiniPileTile(x, y, pw, ph, pile[i], pid === 0 && i === pile.length - 1, pid);
        }
      } else {
        // 左右两家：纵向排布，位置靠外侧避免与中央拥挤
        const sign = dir === 'right' ? 1 : -1;
        const baseX = dir === 'right' ? cx + tw * 1.55 : cx - tw * 1.55 - pw;
        for (let i = 0; i < pile.length; i++) {
          const col = Math.floor(i / 8);
          const row = i % 8;
          const inCol = Math.min(pile.length - col * 8, 8);
          const colH = inCol * step - 2;
          const x = baseX + sign * col * (ph * 0.6);
          const y = cy - colH / 2 + row * step;
          this.drawMiniPileTile(x, y, pw, ph, pile[i], false, pid);
        }
      }
    }
  }

  /** 各家牌河的边框色，用于区分归属 */
  private static readonly PILE_TINT = [
    'rgba(212,175,106,.55)',  // P0 自己：金
    'rgba(120,180,220,.45)',  // P1：蓝
    'rgba(150,200,140,.45)',  // P2：绿
    'rgba(210,150,190,.45)',  // P3：紫
  ];

  /**
   * 牌河里的小牌。
   * 尺寸太小画不下完整图案，因此用「花色小标 + 数字」的紧凑形式：
   * 万=方块、筒=圆、条=斜杠，配一个数字；字牌直接用大字。
   */
  private drawMiniPileTile(
    x: number, y: number, w: number, h: number,
    t: number, highlight: boolean, owner: number = 0,
  ) {
    const g = this.ctx;
    const r = Math.max(2, w * 0.14);
    g.save();

    // 阴影
    g.fillStyle = 'rgba(0,0,0,.26)';
    this.roundRect(x + 0.7, y + 1.2, w, h, r);
    g.fill();

    // 牌面
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#fffdf6');
    grad.addColorStop(1, '#efe6d0');
    g.fillStyle = grad;
    this.roundRect(x, y, w, h, r);
    g.fill();

    g.strokeStyle = highlight ? C.gold : (Renderer.PILE_TINT[owner] ?? '#a8977a');
    g.lineWidth = highlight ? 1.4 : 0.7;
    this.roundRect(x + 0.3, y + 0.3, w - 0.6, h - 0.6, r);
    g.stroke();

    // 内容：小牌用简化图形
    const cx = x + w / 2;
    const cy = y + h / 2;
    const sz = Math.min(w, h);

    if (isSuited(t)) {
      const suit = suitOf(t);
      const rank = rankOf(t);
      // 花色小图标（左上角）
      const ic = sz * 0.17;
      g.fillStyle = suit === 's' ? COL_GREEN : COL_BLUE;
      if (suit === 't') {
        g.beginPath();
        g.arc(x + w * 0.28, y + h * 0.26, ic * 0.62, 0, Math.PI * 2);
        g.fill();
      } else if (suit === 'w') {
        g.fillRect(x + w * 0.28 - ic * 0.45, y + h * 0.26 - ic * 0.45, ic * 0.9, ic * 0.9);
      } else {
        g.fillRect(x + w * 0.28 - ic * 0.3, y + h * 0.26 - ic * 0.6, ic * 0.6, ic * 1.2);
      }
      // 数字（主视觉）
      g.fillStyle = suit === 's' ? COL_GREEN : COL_BLUE;
      g.font = `bold ${Math.max(8, Math.floor(h * 0.52))}px "PingFang SC","Microsoft YaHei",sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(rank), cx, cy + h * 0.08);
    } else {
      const ch = t < 0 ? FLOWERS[-(t + 1)] : CN_ZI[t - 27];
      g.fillStyle = t === 32 ? COL_GREEN : COL_RED;
      g.font = `bold ${Math.max(8, Math.floor(h * 0.56))}px "STKaiti","KaiTi","PingFang SC",serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ch, cx, cy);
    }
    g.restore();
  }

  /**
   * 画出一家亮出的花牌（补花摊在桌面上）。
   * @param cols 每列张数（超过则换列）
   */
  private drawFlowerTiles(
    flowers: number[], x: number, y: number, size: number, cols: number,
  ) {
    for (let i = 0; i < flowers.length; i++) {
      const c = Math.floor(i / cols);
      const r = i % cols;
      this.drawMiniFlowerTile(x + c * (size + 2), y + r * (size + 2), size, flowers[i]);
    }
  }

  private tilesOf(p: PlayerState): number[] {
    const out: number[] = [];
    for (let t = 0; t < ALL_KINDS; t++) for (let k = 0; k < p.hand[t]; k++) out.push(t);
    return out;
  }

  // ---------- 牌面绘制 ----------

  /**
   * 绘制一张正面牌。
   * 牌面外观由 tileface.ts 负责（经典麻将外观，带离屏缓存）。
   */
  drawTile(x: number, y: number, w: number, h: number, t: number, selected: boolean, canSel = false, discard = false) {
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

  drawTileBack(x: number, y: number, w: number, h: number, qi: boolean) {
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
    } else {
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

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
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