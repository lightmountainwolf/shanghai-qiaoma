/**
 * 上海敲麻 · 麻将牌面绘制（经典外观）
 *
 * 按真实麻将牌的视觉习惯绘制：
 *   万子 —— 上方中文数字，下方红「万」
 *   筒子 —— 圆饼图案（按经典排列），底部小数字辅助辨认
 *   条子 —— 竖条图案（1 条画幺鸡），底部小数字辅助辨认
 *   字牌 —— 单个大字，中红/发绿/白蓝框
 *
 * 小尺寸下图案难以辨认，因此在筒/条底部保留一个极小的数字，
 * 保证手机上也能一眼区分「3 筒」和「5 筒」。
 *
 * 性能：每种牌 × 每种尺寸的结果缓存到离屏 canvas，避免每帧重算。
 */
import { isWind, isDragon, suitOf, rankOf, FLOWERS } from '../core/tiles.js';
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_ZI = ['东', '南', '西', '北', '中', '发', '白'];
const COL = {
    faceTop: '#fffdf6',
    faceBot: '#efe6d0',
    side: '#c9bb9c',
    edge: '#8f8264',
    red: '#b8342a',
    green: '#146b40',
    blue: '#1f4f8a',
    ink: '#2f2c1e',
    shadow: 'rgba(0,0,0,.38)',
};
/** 图案位置表：返回 [x, y] 归一化坐标（0-1），按经典麻将排列 */
const DOT_LAYOUT = {
    1: [[0.5, 0.5]],
    2: [[0.5, 0.26], [0.5, 0.74]],
    3: [[0.24, 0.24], [0.5, 0.5], [0.76, 0.76]],
    4: [[0.3, 0.28], [0.7, 0.28], [0.3, 0.72], [0.7, 0.72]],
    5: [[0.26, 0.24], [0.74, 0.24], [0.5, 0.5], [0.26, 0.76], [0.74, 0.76]],
    6: [[0.3, 0.22], [0.7, 0.22], [0.3, 0.5], [0.7, 0.5], [0.3, 0.78], [0.7, 0.78]],
    7: [[0.5, 0.16], [0.26, 0.42], [0.5, 0.42], [0.74, 0.42], [0.26, 0.76], [0.5, 0.76], [0.74, 0.76]],
    8: [[0.3, 0.16], [0.7, 0.16], [0.3, 0.38], [0.7, 0.38], [0.3, 0.6], [0.7, 0.6], [0.3, 0.84], [0.7, 0.84]],
    9: [[0.22, 0.2], [0.5, 0.2], [0.78, 0.2], [0.22, 0.5], [0.5, 0.5], [0.78, 0.5], [0.22, 0.8], [0.5, 0.8], [0.78, 0.8]],
};
/** 条子位置表：7 条按经典「上 1 下 6」排列 */
const BAR_LAYOUT = {
    1: [[0.5, 0.5]],
    2: [[0.5, 0.26], [0.5, 0.72]],
    3: [[0.28, 0.24], [0.5, 0.5], [0.72, 0.76]],
    4: [[0.3, 0.28], [0.7, 0.28], [0.3, 0.72], [0.7, 0.72]],
    5: [[0.26, 0.24], [0.74, 0.24], [0.5, 0.5], [0.26, 0.76], [0.74, 0.76]],
    6: [[0.3, 0.22], [0.7, 0.22], [0.3, 0.5], [0.7, 0.5], [0.3, 0.78], [0.7, 0.78]],
    7: [[0.5, 0.15], [0.26, 0.45], [0.5, 0.45], [0.74, 0.45], [0.26, 0.78], [0.5, 0.78], [0.74, 0.78]],
    8: [[0.3, 0.16], [0.7, 0.16], [0.3, 0.38], [0.7, 0.38], [0.3, 0.6], [0.7, 0.6], [0.3, 0.84], [0.7, 0.84]],
    9: [[0.22, 0.2], [0.5, 0.2], [0.78, 0.2], [0.22, 0.5], [0.5, 0.5], [0.78, 0.5], [0.22, 0.8], [0.5, 0.8], [0.78, 0.8]],
};
const cache = new Map();
/**
 * 绘制一张牌（正面）。
 * @param ctx      目标画布
 * @param x,y,w,h  牌的矩形
 * @param t        牌 id
 * @param scale    额外缩放（用于「立体牌身」，1 为标准）
 */
export function drawTileFace(ctx, x, y, w, h, t) {
    const key = `${t}|${Math.round(w)}|${Math.round(h)}`;
    let off = cache.get(key);
    if (!off) {
        off = renderFace(t, Math.round(w), Math.round(h));
        // 缓存上限，避免内存无限增长
        if (cache.size > 400)
            cache.clear();
        cache.set(key, off);
    }
    ctx.drawImage(off, Math.round(x), Math.round(y));
}
/** 渲染牌面到离屏 canvas */
function renderFace(t, w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(4, w);
    c.height = Math.max(4, h);
    const g = c.getContext('2d');
    // 牌面底色（带轻微渐变，模拟象牙质感）
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, COL.faceTop);
    grad.addColorStop(1, COL.faceBot);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // 内描边
    g.strokeStyle = 'rgba(140,124,92,.55)';
    g.lineWidth = Math.max(0.6, w * 0.02);
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    if (t < 0) {
        // 季节花：红字
        drawCenterChar(g, w, h, FLOWERS[-(t + 1)], COL.red, 0.5);
        return c;
    }
    if (isDragon(t)) {
        const ch = CN_ZI[t - 27];
        if (ch === '白') {
            // 白板：画蓝色空心方框
            drawWhiteDragon(g, w, h);
        }
        else {
            drawCenterChar(g, w, h, ch, ch === '中' ? COL.red : COL.green, 0.52);
        }
        return c;
    }
    if (isWind(t)) {
        drawCenterChar(g, w, h, CN_ZI[t - 27], COL.blue, 0.52);
        return c;
    }
    const suit = suitOf(t);
    const rank = rankOf(t);
    if (suit === 'w') {
        drawWan(g, w, h, rank);
    }
    else if (suit === 't') {
        drawTong(g, w, h, rank);
    }
    else {
        drawTiao(g, w, h, rank);
    }
    return c;
}
/** 居中绘制单个大字 */
function drawCenterChar(g, w, h, ch, color, sizeRatio) {
    g.fillStyle = color;
    g.font = `bold ${Math.floor(h * sizeRatio)}px "STKaiti","KaiTi","PingFang SC","Microsoft YaHei",serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(ch, w / 2, h / 2 + h * 0.02);
}
/** 白板：蓝色空心方框（经典样式） */
function drawWhiteDragon(g, w, h) {
    const pad = w * 0.2;
    const bw = w - pad * 2;
    const bh = h * 0.52;
    const bx = pad;
    const by = (h - bh) / 2;
    const lw = Math.max(2, w * 0.075);
    g.strokeStyle = COL.blue;
    g.lineWidth = lw;
    g.lineJoin = 'miter';
    g.strokeRect(bx, by, bw, bh);
}
/** 万子：上方中文数字 + 下方红「万」 */
function drawWan(g, w, h, rank) {
    const numSize = Math.floor(h * 0.42);
    const wanSize = Math.floor(h * 0.34);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = COL.ink;
    g.font = `bold ${numSize}px "STKaiti","KaiTi","PingFang SC","Microsoft YaHei",serif`;
    g.fillText(CN_NUM[rank - 1], w / 2, h * 0.33);
    g.fillStyle = COL.red;
    g.font = `bold ${wanSize}px "STKaiti","KaiTi","PingFang SC","Microsoft YaHei",serif`;
    g.fillText('万', w / 2, h * 0.73);
}
/** 筒子：圆饼图案 + 底部小数字 */
function drawTong(g, w, h, rank) {
    const layout = DOT_LAYOUT[rank];
    // 图案区域（留出底部给数字）
    const areaH = h * 0.82;
    const r = dotRadius(layout.length, w, areaH);
    for (const [nx, ny] of layout) {
        const cx = nx * w;
        const cy = ny * areaH;
        drawDisc(g, cx, cy, r);
    }
    drawRankBadge(g, w, h, rank, areaH);
}
/** 条子：竖条图案（1 条画幺鸡）+ 底部小数字 */
function drawTiao(g, w, h, rank) {
    const areaH = h * 0.82;
    if (rank === 1) {
        drawBird(g, w, areaH);
        drawRankBadge(g, w, h, 1, areaH);
        return;
    }
    const layout = BAR_LAYOUT[rank];
    const barW = barWidth(layout.length, w);
    const barH = barHeight(layout.length, areaH);
    for (const [nx, ny] of layout) {
        const cx = nx * w;
        const cy = ny * areaH;
        drawBar(g, cx, cy, barW, barH);
    }
    drawRankBadge(g, w, h, rank, areaH);
}
/** 单个圆饼：外圈实心 + 内圈留白（模拟真实筒子） */
function drawDisc(g, cx, cy, r) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = COL.blue;
    g.fill();
    // 内圈留白
    g.beginPath();
    g.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    g.fillStyle = '#fffdf6';
    g.fill();
    // 中心小点
    g.beginPath();
    g.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    g.fillStyle = COL.blue;
    g.fill();
}
/** 单根条：圆角竖条，中间有细缝模拟竹节 */
function drawBar(g, cx, cy, bw, bh) {
    const x = cx - bw / 2;
    const y = cy - bh / 2;
    const r = Math.min(bw / 2, bh / 2) * 0.5;
    g.beginPath();
    roundRectPath(g, x, y, bw, bh, r);
    g.fillStyle = COL.green;
    g.fill();
    // 中缝
    if (bh > 9) {
        g.strokeStyle = 'rgba(255,253,246,.55)';
        g.lineWidth = Math.max(0.7, bw * 0.14);
        g.beginPath();
        g.moveTo(cx, y + bh * 0.22);
        g.lineTo(cx, y + bh * 0.78);
        g.stroke();
    }
}
/** 一条的幺鸡：简化鸟形 */
function drawBird(g, w, areaH) {
    const cx = w / 2;
    const cy = areaH * 0.5;
    const s = Math.min(w, areaH) * 0.62;
    g.save();
    g.translate(cx, cy);
    // 身体（椭圆）
    g.fillStyle = COL.green;
    g.beginPath();
    g.ellipse(0, s * 0.1, s * 0.3, s * 0.38, 0, 0, Math.PI * 2);
    g.fill();
    // 头
    g.beginPath();
    g.arc(s * 0.05, -s * 0.28, s * 0.19, 0, Math.PI * 2);
    g.fill();
    // 喙
    g.fillStyle = COL.red;
    g.beginPath();
    g.moveTo(s * 0.2, -s * 0.3);
    g.lineTo(s * 0.42, -s * 0.24);
    g.lineTo(s * 0.2, -s * 0.18);
    g.closePath();
    g.fill();
    // 尾
    g.fillStyle = COL.green;
    g.beginPath();
    g.moveTo(-s * 0.18, s * 0.32);
    g.lineTo(-s * 0.46, s * 0.5);
    g.lineTo(-s * 0.1, s * 0.44);
    g.closePath();
    g.fill();
    // 眼睛
    g.fillStyle = '#fffdf6';
    g.beginPath();
    g.arc(s * 0.08, -s * 0.3, s * 0.05, 0, Math.PI * 2);
    g.fill();
    g.restore();
}
/** 底部小数字（辅助辨认，手机上尤其重要） */
function drawRankBadge(g, w, h, rank, areaH) {
    const size = Math.max(7, Math.floor(h * 0.2));
    g.fillStyle = 'rgba(70,60,40,.62)';
    g.font = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(rank), w / 2, areaH + (h - areaH) / 2);
}
/** 根据图案数量推算圆饼半径 */
function dotRadius(count, w, areaH) {
    // 单张牌最多 4 列（8/9 是 3 列，4 是 2 列）
    const cols = count === 1 ? 1 : count <= 2 ? 1 : count <= 3 ? 2 : count <= 6 ? 2 : 3;
    const rows = Math.ceil(count / cols);
    const cellW = w / (cols + 0.5);
    const cellH = areaH / (rows + 0.5);
    return Math.max(1.4, Math.min(cellW, cellH) * 0.44);
}
/** 根据数量推算竖条宽度 */
function barWidth(count, w) {
    const cols = count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 2 : 3;
    const cellW = w / (cols + 0.6);
    return Math.max(1.6, Math.min(cellW * 0.52, w * 0.2));
}
/** 根据数量推算竖条高度 */
function barHeight(count, areaH) {
    const rows = count === 1 ? 1 : count <= 3 ? 3 : count <= 6 ? 3 : 3;
    const cellH = areaH / (rows + 0.4);
    return Math.max(3, Math.min(cellH * 0.82, areaH * 0.26));
}
/** 圆角矩形路径 */
export function roundRectPath(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
}
/** 牌的立体牌身（侧面 + 阴影），在牌面之下绘制 */
export function drawTileBody(g, x, y, w, h) {
    const r = Math.max(3, w * 0.12);
    const depth = Math.max(2, h * 0.055);
    // 阴影
    g.fillStyle = COL.shadow;
    g.beginPath();
    roundRectPath(g, x + 1.4, y + depth + 2, w, h, r);
    g.fill();
    // 侧面（厚度）
    g.fillStyle = COL.side;
    g.beginPath();
    roundRectPath(g, x, y + depth, w, h, r);
    g.fill();
    // 描边
    g.strokeStyle = COL.edge;
    g.lineWidth = 0.8;
    g.beginPath();
    roundRectPath(g, x + 0.4, y + depth + 0.4, w - 0.8, h - 0.8, r);
    g.stroke();
}
/** 花牌（季节花 / 中发白亮出后的小牌）专用绘制 */
export function drawFlowerChip(g, x, y, s, t) {
    const r = Math.max(2, s * 0.16);
    // 阴影
    g.fillStyle = 'rgba(0,0,0,.32)';
    g.beginPath();
    roundRectPath(g, x + 0.8, y + 1.4, s, s, r);
    g.fill();
    // 牌面
    const grad = g.createLinearGradient(x, y, x, y + s);
    grad.addColorStop(0, '#fff8e6');
    grad.addColorStop(1, '#f0e4c6');
    g.fillStyle = grad;
    g.beginPath();
    roundRectPath(g, x, y, s, s, r);
    g.fill();
    g.strokeStyle = '#b8935a';
    g.lineWidth = 0.8;
    g.beginPath();
    roundRectPath(g, x + 0.4, y + 0.4, s - 0.8, s - 0.8, r);
    g.stroke();
    const label = t < 0 ? FLOWERS[-(t + 1)] : CN_ZI[t - 27];
    g.fillStyle = t >= 31 && label === '发' ? COL.green : COL.red;
    g.font = `bold ${Math.max(8, Math.floor(s * 0.66))}px "STKaiti","KaiTi","PingFang SC",serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x + s / 2, y + s / 2);
}
