/**
 * 上海敲麻 · 主控制器
 * 玩家 = P0，三个 AI 对手。
 */
import { Game } from '../core/game.js';
import { MahjongAI } from '../ai/ai.js';
import { Renderer } from './render.js';
import { tileName, tileChar } from '../core/tiles.js';
import { DEFAULT_CONFIG } from '../core/scoring.js';
const HUMAN = 0;
const canvas = document.getElementById('board');
const logEl = document.getElementById('log');
const actionsEl = document.getElementById('actions');
const hintEl = document.getElementById('hint');
const scoresEl = document.getElementById('scores');
const resultEl = document.getElementById('result');
let game = new Game(DEFAULT_CONFIG);
let renderer = new Renderer(canvas, game);
const ais = [1, 2, 3].map(() => new MahjongAI());
let aiTimers = [];
let selectable = new Set();
let running = false;
/**
 * 根据容器实际像素尺寸重排画布。
 * renderer 内部用 CSS 像素坐标做布局，
 * 再按 devicePixelRatio 放大画布本身，保证高分屏（手机）清晰。
 */
function relayout() {
    const wrap = document.getElementById('canvas-wrap');
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (availW < 10 || availH < 10)
        return;
    renderer.layout(availW, availH);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(renderer.W * dpr);
    canvas.height = Math.round(renderer.H * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    refresh();
}
function newGame() {
    clearAllTimers();
    game = new Game(DEFAULT_CONFIG, Date.now() % 100000);
    // 随机庄家（默认 dealer=0 永远是玩家坐庄）
    game.dealer = Math.floor(Math.random() * 4);
    game.deal();
    // 复用 renderer 实例，保留已算好的布局（换实例会导致画布尺寸丢失）
    renderer.game = game;
    renderer.selected = -1;
    renderer.resetFx();
    selectable = new Set();
    resultEl.classList.remove('show');
    logEl.innerHTML = '';
    loggedFlowers = 0;
    logFlowers(); // 记录发牌阶段的补花
    addLog('开局。你是 <span class="hi">P0</span>，' + (game.dealer === 0 ? '你坐庄' : `P${game.dealer} 坐庄`));
    refresh();
    if (game.turn !== HUMAN)
        scheduleAi();
}
function clearAllTimers() {
    aiTimers.forEach((t) => clearTimeout(t));
    aiTimers = [];
    running = false;
}
function addLog(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
}
function refresh() {
    // 先渲染操作区（它会更新 selectable），再绘制画面，
    // 否则画面用的还是上一帧的可选状态
    renderActions();
    renderer.draw(HUMAN, { selectable });
    renderScores();
    startAnim();
}
/**
 * 动效循环：只在有动画（摸牌滑入 / 弃牌飞入 / 点错反馈 / 补花提示）时重绘，
 * 动画结束自动停止，不常驻占用 CPU。
 */
let animRaf = 0;
function startAnim() {
    if (animRaf)
        return;
    animRaf = requestAnimationFrame(function step() {
        animRaf = 0;
        renderer.draw(HUMAN, { selectable });
        if (renderer.animActive())
            animRaf = requestAnimationFrame(step);
    });
}
function renderScores() {
    scoresEl.innerHTML = game.players
        .map((p) => `<div class="score-box ${game.turn === p.id ? 'turn' : ''}">
        <div class="name">P${p.id}${p.id === HUMAN ? '（你）' : ''}${p.hasQi ? ' 已敲' : ''}</div>
        <div class="val">${p.score > 0 ? '+' : ''}${p.score}</div>
      </div>`)
        .join('');
}
/** 上一次渲染的操作区签名：内容没变就不重建 DOM，避免按钮闪烁 */
let lastActionsSig = '';
function renderActions() {
    const descs = [];
    let hint = '';
    selectable = new Set();
    if (game.phase === 'game-over' || game.phase === 'win-settle') {
        descs.push({ ico: '再来一局', sub: '', cls: 'wide', onClick: newGame });
    }
    else if (game.phase === 'claim' && game.pending) {
        const mine = game.pending.options.filter((o) => o.player === HUMAN);
        if (mine.length > 0) {
            const tile = game.pending.tile;
            for (const o of mine) {
                descs.push({
                    ico: labelOf(o.type),
                    sub: tileName(tile),
                    cls: '',
                    onClick: () => {
                        game.claim(HUMAN, { type: o.type, chow: o.chow });
                        addLog(`你${labelOf(o.type)} ${tileName(tile)}`);
                        selectable = new Set();
                        afterAction();
                    },
                });
            }
            descs.push({
                ico: '过',
                sub: '',
                cls: 'secondary',
                onClick: () => {
                    game.pass(HUMAN);
                    selectable = new Set();
                    afterAction();
                },
            });
            hint = '轮到你声明：吃 / 碰 / 杠 / 胡';
        }
        else {
            // AI 的声明，交给调度器
            scheduleAi();
        }
    }
    else if (game.turn !== HUMAN) {
        hint = `P${game.turn} 思考中…`;
        scheduleAi();
    }
    else {
        // 玩家回合
        const acts = game.turnActions(HUMAN);
        const canWin = acts.some((a) => a.type === 'win');
        const canQi = acts.some((a) => a.type === 'qi');
        const myFlowers = game.playerFlowers(HUMAN);
        if (canWin) {
            descs.push({ ico: '胡', sub: '', cls: 'primary', onClick: doWin });
            // 敲后胡为可选：提供「不胡」继续打牌
            if (game.pendingWinAfterQi) {
                descs.push({
                    ico: '不胡',
                    sub: '',
                    cls: 'secondary',
                    onClick: () => {
                        game.pendingWinAfterQi = false;
                        addLog('你选择不胡，继续打牌');
                        refresh();
                    },
                });
            }
        }
        if (canQi) {
            const waits = game.qiTilesOf(HUMAN);
            descs.push({
                ico: '敲',
                // 听口为空说明这手牌本身已成胡牌型（刚摸到听口牌），此时敲完即可胡
                sub: waits.length > 0 ? `听 ${waits.map(tileName).join(' ')}` : '已成牌型',
                cls: 'primary',
                onClick: doQi,
            });
        }
        for (const a of acts.filter((x) => x.type === 'ankan')) {
            descs.push({
                ico: '杠',
                sub: `暗 ${tileName(a.tile)}`,
                cls: 'secondary',
                onClick: () => {
                    game.act(HUMAN, { type: 'ankan', tile: a.tile });
                    addLog(`你暗杠 ${tileName(a.tile)}`);
                    afterAction();
                },
            });
        }
        for (const a of acts.filter((x) => x.type === 'shouminkan')) {
            descs.push({
                ico: '杠',
                sub: `补 ${tileName(a.tile)}`,
                cls: 'secondary',
                onClick: () => {
                    game.act(HUMAN, { type: 'shouminkan', tile: a.tile });
                    addLog(`你补杠 ${tileName(a.tile)}`);
                    afterAction();
                },
            });
        }
        // 可打出的牌（点一下就直接打出）
        selectable = new Set(acts.filter((a) => a.type === 'discard').map((d) => d.tile));
        // 引导提示：明确告诉玩家「现在能不能敲」，避免找不到按钮
        if (canWin) {
            hint = `可以胡了！你有 ${myFlowers} 花`;
        }
        else if (game.players[HUMAN].hasQi) {
            const waits = game.players[HUMAN].qiTiles;
            hint = `已敲 · 听 ${waits.map(tileName).join(' ')} · ${myFlowers} 花`;
        }
        else if (canQi) {
            const waits = game.qiTilesOf(HUMAN);
            hint = waits.length > 0
                ? `★ 可以敲了！点「敲」锁定听口 · ${myFlowers} 花`
                : `★ 点「敲」即可胡牌 · ${myFlowers} 花`;
        }
        else {
            hint = `还没听牌 · 点一张牌打出 · ${myFlowers} 花`;
        }
    }
    updateActionBar(descs, hint);
}
/** 渲染操作按钮（内容未变时复用已有 DOM，避免闪烁和重复入场动画） */
function updateActionBar(descs, hint) {
    const stateTag = [
        game.phase, game.turn, game.justDrawn,
        game.pending ? `${game.pending.from}:${game.pending.tile}` : '',
        game.discardPiles.map((p) => p.length).join(','),
    ].join('|');
    const sig = stateTag + '#' + descs.map((d) => `${d.ico}|${d.sub}|${d.cls}`).join('~');
    if (sig !== lastActionsSig) {
        lastActionsSig = sig;
        actionsEl.innerHTML = '';
        for (const d of descs) {
            const b = document.createElement('button');
            if (d.cls)
                b.className = d.cls;
            b.innerHTML = `<span class="ico">${d.ico}</span>`
                + (d.sub ? `<span class="sub">${d.sub}</span>` : '');
            b.onclick = d.onClick;
            actionsEl.appendChild(b);
        }
    }
    hintEl.textContent = hint;
}
function labelOf(type) {
    switch (type) {
        case 'win': return '胡';
        case 'chow': return '吃';
        case 'pon': return '碰';
        case 'minkan': return '杠';
        default: return type;
    }
}
function doWin() {
    game.act(HUMAN, { type: 'win', tile: game.justDrawn });
    afterAction();
}
function doQi() {
    const waits = game.qiTilesOf(HUMAN);
    game.act(HUMAN, { type: 'qi', tile: game.justDrawn });
    if (game.phase === 'win-settle') {
        addLog('你敲后胡了！');
        afterAction();
        return;
    }
    addLog(`你敲：听 ${waits.map(tileName).join(' ')}`);
    if (game.pendingWinAfterQi) {
        addLog(`已达成胡牌条件（${game.playerFlowers(HUMAN)} 花），可选择胡或不胡`);
    }
    afterAction();
}
function discardTile(t) {
    if (game.phase !== 'discard' || game.turn !== HUMAN)
        return;
    game.act(HUMAN, { type: 'discard', tile: t });
    addLog(`你打出 ${tileName(t)}`);
    afterAction();
}
/** 已输出的补花事件数，避免重复打印 */
let loggedFlowers = 0;
function logFlowers() {
    const evs = game.flowerEvents;
    if (evs.length <= loggedFlowers) {
        // 新一局时重置计数
        if (evs.length < loggedFlowers)
            loggedFlowers = 0;
        return;
    }
    // 只打印本轮新增的（同一轮多条合并成一句）
    const batch = evs.slice(loggedFlowers);
    loggedFlowers = evs.length;
    const byPlayer = new Map();
    for (const e of batch) {
        if (!byPlayer.has(e.player))
            byPlayer.set(e.player, []);
        byPlayer.get(e.player).push(e.flower);
    }
    for (const [pid, list] of byPlayer) {
        const who = pid === HUMAN ? '你' : `P${pid}`;
        addLog(`${who}补花：${list.map((f) => tileChar(f)).join(' ')}（已从牌墙补牌）`);
    }
}
function afterAction() {
    selectable = new Set();
    renderer.selected = -1;
    // 补花日志：把引擎记录的补花事件同步到操作日志
    logFlowers();
    refresh();
    if (game.phase === 'win-settle' || game.phase === 'game-over') {
        showResult();
        return;
    }
    if (game.phase === 'claim' && game.pending) {
        const mine = game.pending.options.filter((o) => o.player === HUMAN);
        if (mine.length > 0) {
            refresh();
            return;
        }
    }
    if (game.turn !== HUMAN)
        scheduleAi();
    else
        refresh();
}
function showResult() {
    const w = game.winner;
    let title = '';
    let detail = '';
    if (game.phase === 'game-over') {
        title = '流局';
        detail = `荒番 ${game.huangFan}<br>本局无人胡牌`;
    }
    else if (w) {
        const r = w.result;
        title = w.winner === HUMAN ? '你胡了！' : `P${w.winner} 胡了`;
        const names = r.names.length ? r.names.join(' + ') : '平胡';
        const mode = w.selfDraw ? '自摸' : w.robKong ? '抢杠' : '点炮';
        detail = `
      <div style="font-size:15px;color:#d4af6a;margin-bottom:6px">${names}</div>
      <div>${mode}${!w.selfDraw && w.loser !== null ? ` · P${w.loser} 放炮` : ''}</div>
      <div style="margin-top:8px">${r.flowersDetail.join('<br>')}</div>
      <div style="margin-top:8px">${r.flowers} 花 × ${Math.pow(2, r.exponent)} 倍${r.capped ? '（已封顶）' : ''} = <b>${r.points}</b> 分</div>
      <div style="margin-top:10px;color:#a89a80">得分 ${game.players.map((p) => `P${p.id}:${p.score}`).join('  ')}</div>
    `;
    }
    resultEl.innerHTML = `<div style="font-size:24px">${title}</div><div class="detail">${detail}</div>`;
    resultEl.classList.add('show');
}
function scheduleAi() {
    clearAllTimers();
    if (game.phase === 'win-settle' || game.phase === 'game-over')
        return;
    if (game.phase === 'claim' && game.pending) {
        // 先把需要的值取出来：进入定时器后 game.pending 可能已被其他路径清空
        const tile = game.pending.tile;
        const opts = [...game.pending.options];
        if (opts.length === 0) {
            afterAction();
            return;
        }
        const t = setTimeout(() => {
            if (game.phase !== 'claim' || !game.pending) {
                afterAction();
                return;
            }
            const o = opts[0];
            const ai = ais[o.player - 1];
            const claim = ai.decideClaim(game, o.player, tile);
            if (claim) {
                game.claim(o.player, { type: claim.type, chow: claim.chow });
                addLog(`P${o.player}${labelOf(claim.type)} ${tileName(tile)}`);
            }
            else {
                game.pass(o.player);
            }
            afterAction();
        }, 420);
        aiTimers.push(t);
        return;
    }
    if (game.turn === HUMAN) {
        refresh();
        return;
    }
    const t = setTimeout(() => {
        if (game.turn === HUMAN)
            return;
        const pid = game.turn;
        const ai = ais[pid - 1];
        const d = ai.decide(game, pid);
        if (d.type === 'win') {
            game.act(pid, { type: 'win', tile: game.justDrawn });
            addLog(`P${pid} 胡了（${game.playerFlowers(pid)} 花）`);
        }
        else if (d.type === 'qi') {
            const waits = game.qiTilesOf(pid);
            game.act(pid, { type: 'qi', tile: game.justDrawn });
            if (game.phase !== 'win-settle') {
                addLog(`P${pid} 敲：听 ${waits.map(tileName).join(' ')}（${game.playerFlowers(pid)} 花）`);
            }
        }
        else if (d.type === 'ankan' || d.type === 'shouminkan') {
            game.act(pid, { type: d.type, tile: d.tile });
            addLog(`P${pid} ${d.type === 'ankan' ? '暗杠' : '补杠'} ${tileName(d.tile)}`);
        }
        else if (d.type === 'discard') {
            game.act(pid, { type: 'discard', tile: d.tile });
            addLog(`P${pid} 打出 ${tileName(d.tile)}`);
        }
        afterAction();
    }, 480 + Math.random() * 320); // 节奏带一点随机，避免机械感
    aiTimers.push(t);
}
// ---------- 交互 ----------
/**
 * 客户端坐标 → renderer 内部坐标。
 * renderer 的 hitAreas 用的是 CSS 像素坐标系（layout() 的输出），
 * 而 canvas.width 是 dpr 放大后的值，所以要用 rect 比例换算回 CSS 像素。
 */
function toCanvas(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (renderer.W / rect.width),
        y: (clientY - rect.top) * (renderer.H / rect.height),
    };
}
/**
 * 出牌操作：按下「抬起」，松手即打出（主流麻将游戏的手感）。
 * 松手时若手指已经移出该牌且没有上滑，则视为取消，避免误打。
 */
let press = null;
canvas.addEventListener('pointerdown', (e) => {
    if (game.phase !== 'discard' || game.turn !== HUMAN)
        return;
    e.preventDefault();
    const p = toCanvas(e.clientX, e.clientY);
    const hit = renderer.hitTest(p.x, p.y);
    if (!hit || hit.playerId !== HUMAN) {
        renderer.selected = -1;
        refresh();
        return;
    }
    if (!selectable.has(hit.tile)) {
        // 这张牌现在不能打（例如敲后必须保持听口）：红色闪一下作为反馈
        renderer.flashInvalid(hit.tile);
        refresh();
        return;
    }
    press = { tile: hit.tile, rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, startY: p.y };
    try {
        canvas.setPointerCapture(e.pointerId);
    }
    catch { /* 老浏览器忽略 */ }
    renderer.selected = hit.tile; // 按下立刻抬起，给出即时反馈
    refresh();
});
canvas.addEventListener('pointerup', (e) => {
    if (!press)
        return;
    const cur = press;
    press = null;
    const p = toCanvas(e.clientX, e.clientY);
    const inTile = p.x >= cur.rect.x && p.x <= cur.rect.x + cur.rect.w
        && p.y >= cur.rect.y && p.y <= cur.rect.y + cur.rect.h;
    // 上滑超过 30px 也算确认出牌（配合手指遮挡牌面的情况）
    const draggedUp = cur.startY - p.y > 30;
    if (inTile || draggedUp) {
        // 记录起点，让打出的牌从指尖位置飞向中央
        renderer.noteMyDiscard(cur.rect.x + cur.rect.w / 2, cur.rect.y + cur.rect.h / 2);
        discardTile(cur.tile);
    }
    else {
        renderer.selected = -1;
        refresh();
    }
});
canvas.addEventListener('pointercancel', () => {
    if (!press)
        return;
    press = null;
    renderer.selected = -1;
    refresh();
});
// 阻止双指缩放与双击放大，保持「像原生 App」的观感
document.addEventListener('gesturestart', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300)
        e.preventDefault();
    lastTouchEnd = now;
}, { passive: false });
// 视口变化（转屏、地址栏收放）时重排
let resizeRaf = 0;
const onResize = () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(relayout);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize);
}
relayout();
newGame();
window.__qm = {
    game: () => game,
    areas: () => renderer.hitAreas,
    renderer: () => renderer,
    refresh: () => refresh(),
};
