/**
 * 上海敲麻 · 对局状态机
 *
 * 与其他麻将最大的差异：必须先「敲」（报听）才能胡。
 * 敲之后：
 *   - 手牌不可更改（固定听口）
 *   - 有胡必胡（漏胡 = 诈胡，倒赔三家）
 *   - 有杠必杠
 *   - 可杠可胡时胡优先
 *
 * 这个模块是纯逻辑，不含任何界面代码，可无头批量跑模拟。
 */
import { ALL_KINDS, newCounts, countsTotal, countsCopy, isWinning, winningTiles, isWind, rankOf, isSuited, tileName, isFlower, } from './tiles.js';
import { Wall } from './wall.js';
import { calculateWin, DEFAULT_CONFIG, meetsFlowerThreshold, computeFlowers } from './scoring.js';
export class Game {
    players;
    wall;
    turn = 0;
    phase = 'dealing';
    lastDiscard = null;
    pending = null;
    /** 敲后已达胡牌条件、等待玩家选择「胡 / 不胡」 */
    pendingWinAfterQi = false;
    afterKong = false;
    huangFan = 0;
    dealer = 0;
    config;
    winner = null;
    /** 事件日志 */
    log = [];
    /**
     * 各家弃牌堆（牌河）。索引=玩家 id，元素按打出顺序排列。
     * 被吃碰杠的牌会从弃牌堆移除（进入副露区），与真实麻将一致。
     */
    discardPiles = [[], [], [], []];
    /** 补花事件流水：{ player, flower, } 便于 UI 做补花动画 */
    flowerEvents = [];
    seed;
    constructor(config = DEFAULT_CONFIG, seed, aiPlayers = [1, 2, 3]) {
        this.config = config;
        this.seed = seed;
        this.players = [0, 1, 2, 3].map((id) => ({
            id,
            hand: newCounts(),
            melds: [],
            flowers: [],
            hasQi: false,
            qiTiles: [],
            qiDiscardPending: false,
            exposedCount: 0,
            score: 0,
            menqing: true,
            isAI: aiPlayers.includes(id),
        }));
        this.wall = new Wall(seed);
    }
    // ---------- 开局 ----------
    deal() {
        // 发牌：每人 13 张常规牌，摸到花牌（含中发白）即亮出并补牌
        for (let round = 0; round < 13; round++) {
            for (let k = 0; k < 4; k++) {
                const t = this.wall.draw();
                if (t === null)
                    continue;
                if (isFlower(t)) {
                    this.players[k].flowers.push(t);
                    this.flowerEvents.push({ player: k, flower: t });
                }
                else {
                    this.players[k].hand[t]++;
                }
            }
        }
        // 补足到 13 张常规牌（发牌中摸到花牌需要补）
        for (const p of this.players) {
            let guard = 0;
            while (countsTotal(p.hand) < 13 && guard++ < 60) {
                const t = this.wall.draw();
                if (t === null)
                    break;
                if (isFlower(t)) {
                    p.flowers.push(t);
                    this.flowerEvents.push({ player: p.id, flower: t });
                }
                else {
                    p.hand[t]++;
                }
            }
        }
        // 庄家多摸一张
        this.drawFor(this.players[this.dealer]);
        this.turn = this.dealer;
        this.phase = 'discard';
        this.afterKong = false;
    }
    /**
     * 补花：把手上所有花牌亮出，并从牌墙补等量的牌。
     * 循环执行直到手上没有花牌为止。
     * 中发白是普通字牌（进手牌、参与和牌），但计花分，不需要补。
     */
    replenishFlowers(p) {
        while (true) {
            const f = this.findFlowerInHand(p);
            if (f < 0)
                return;
            p.hand[f]--;
            p.flowers.push(f);
            // 补一张
            const t = this.wall.draw();
            if (t === null)
                return;
            if (t < 0)
                p.flowers.push(t);
            else
                p.hand[t]++;
        }
    }
    /**
     * 找手上第一张花牌；没有则返回 -1。
     * 当前实现中花牌摸到即存入 flowers（不进手牌），
     * 所以手上永远不会有花牌待补，此方法保留供将来「手上有花需手动补」用。
     */
    findFlowerInHand(_p) {
        return -1;
    }
    /**
     * 摸牌 + 自动补花。
     *
     * 规则：摸到花牌（季节花 或 中发白）→ 亮出 → 从牌墙补一张。
     * 补到的若又是花牌，重复「亮出 + 补牌」，直到补到常规牌为止。
     * 保证玩家摸牌后手牌数恒定（花牌不占手牌位）。
     */
    drawFor(p) {
        // 入口重置：牌墙摸空时 justDrawn 保持 -1，作为摸牌失败的信号
        this.justDrawn = -1;
        let t = this.wall.draw();
        let guard = 0;
        while (t !== null && isFlower(t)) {
            if (guard++ > 30)
                break; // 兜底，正常不会触发
            p.flowers.push(t);
            this.flowerEvents.push({ player: p.id, flower: t });
            t = this.wall.draw(); // 补一张
        }
        if (t === null)
            return;
        p.hand[t]++;
        this.justDrawn = t;
    }
    /**
     * 回合起始摸牌。
     * 注意：每次进入某玩家的出牌阶段，只摸一次。
     * 调用点已保证这一点（openClaims 只在弃牌后触发下一家）。
     */
    beginTurn(playerId) {
        this.turn = playerId;
        this.justDrawn = -1;
        this.drawFor(this.players[playerId]);
        if (this.justDrawn < 0) {
            this.finishDraw();
            return;
        }
        this.phase = 'discard';
    }
    justDrawn = -1;
    // ---------- 可执行动作 ----------
    /** 当前玩家在「摸牌后」的可选动作 */
    turnActions(playerId) {
        const p = this.players[playerId];
        const acts = [];
        // 杠（敲后必须保持听口才允许）
        const kongs = [];
        // 暗杠（花牌不可杠）
        for (let t = 0; t < ALL_KINDS; t++) {
            if (isFlower(t))
                continue;
            if (p.hand[t] === 4 && this.kongAllowed(p, 'ankan', t)) {
                kongs.push({ type: 'ankan', tile: t });
            }
        }
        // 补杠（碰过的刻子摸到第四张）
        for (const m of p.melds) {
            if ((m.type === 'pon' || m.type === 'shouminkan') && p.hand[m.tile] > 0
                && this.kongAllowed(p, 'shouminkan', m.tile)) {
                kongs.push({ type: 'shouminkan', tile: m.tile });
            }
        }
        // 胡：必须已敲，且牌型可胡，且花数达标（自摸≥2 花 / 点炮≥3 花）
        if (p.hasQi && this.canWinNow(playerId)) {
            acts.push({ type: 'win', tile: this.justDrawn });
        }
        else if (!p.hasQi && this.canQi(playerId)) {
            // 未敲：可宣告敲（敲完才可能胡）
            acts.push({ type: 'qi', tile: this.justDrawn });
        }
        acts.push(...kongs);
        if (p.hasQi) {
            // 有杠必杠：存在保听杠且不能胡时，不给弃牌选项
            const canWin = acts.some((a) => a.type === 'win');
            if (kongs.length > 0 && !canWin)
                return acts;
            if (p.qiDiscardPending) {
                // 敲的当回合：只能打出保持听口的牌，弃牌后听口锁定
                for (const t of this.qiDiscardOptions(p))
                    acts.push({ type: 'discard', tile: t });
            }
            else if (this.justDrawn >= 0 && p.hand[this.justDrawn] > 0) {
                // 听口已锁定：摸啥打啥
                acts.push({ type: 'discard', tile: this.justDrawn });
            }
            else {
                // 兜底（正常流程不会走到）：只允许保持听口的弃牌
                for (const t of this.waitKeepingDiscards(p))
                    acts.push({ type: 'discard', tile: t });
            }
            return acts;
        }
        // 未敲：任意弃牌（花牌不在手牌，跳过）
        for (let t = 0; t < ALL_KINDS; t++) {
            if (isFlower(t))
                continue;
            if (p.hand[t] > 0)
                acts.push({ type: 'discard', tile: t });
        }
        return acts;
    }
    /** 敲后杠是否允许：不能改变听口（敲的当回合以所有可能听口的并集为准） */
    kongAllowed(p, type, tile) {
        if (!p.hasQi)
            return true;
        const target = p.qiDiscardPending ? this.qiWaitUnion(p) : p.qiTiles;
        if (target.length === 0)
            return false;
        const h = countsCopy(p.hand);
        let melds = p.melds.length;
        if (type === 'ankan') {
            h[tile] -= 4;
            melds++;
        }
        else if (type === 'shouminkan') {
            h[tile] -= 1;
        }
        else if (type === 'minkan') {
            h[tile] -= 3;
            melds++;
        }
        const waits = winningTiles(h, melds);
        return waits.length === target.length && waits.every((w) => target.includes(w));
    }
    /** 当前手牌（3n+2）打出后仍能听牌的弃牌候选 */
    qiDiscardOptions(p) {
        const opts = [];
        for (let t = 0; t < ALL_KINDS; t++) {
            if (isFlower(t) || p.hand[t] <= 0)
                continue;
            p.hand[t]--;
            if (winningTiles(p.hand, p.melds.length).length > 0)
                opts.push(t);
            p.hand[t]++;
        }
        return opts;
    }
    /** 「打出即听」局面下，所有保听弃牌对应听口的并集（供 UI/AI 展示评估） */
    qiWaitUnion(p) {
        const set = new Set();
        for (const t of this.qiDiscardOptions(p)) {
            p.hand[t]--;
            for (const w of winningTiles(p.hand, p.melds.length))
                set.add(w);
            p.hand[t]++;
        }
        return [...set].sort((a, b) => a - b);
    }
    /** 兜底：打出后仍保持已锁定听口的弃牌 */
    waitKeepingDiscards(p) {
        const opts = [];
        for (let t = 0; t < ALL_KINDS; t++) {
            if (isFlower(t) || p.hand[t] <= 0)
                continue;
            p.hand[t]--;
            const waits = winningTiles(p.hand, p.melds.length);
            if (waits.length === p.qiTiles.length && waits.every((w) => p.qiTiles.includes(w))) {
                opts.push(t);
            }
            p.hand[t]++;
        }
        return opts;
    }
    /**
     * 当前牌能否胡（不论是否已敲）。
     * 需同时满足：牌型可胡 + 敲已宣告 + 花数达标。
     * @param selfDraw 传入时指定自摸/点炮，用于花数门槛判定；
     *                 不传则两种都试（只要任一满足即可）
     */
    canWinNow(playerId, selfDraw) {
        const p = this.players[playerId];
        if (this.justDrawn < 0 || p.hand[this.justDrawn] === 0)
            return false;
        if (!isWinning(p.hand, p.melds.length))
            return false;
        if (!p.hasQi)
            return false; // 必须先敲
        const modes = selfDraw !== undefined ? [selfDraw] : [true, false];
        for (const sd of modes) {
            if (this.meetsFlowerGate(playerId, sd))
                return true;
        }
        return false;
    }
    /** 花数门槛是否达标 */
    meetsFlowerGate(playerId, selfDraw) {
        const p = this.players[playerId];
        return meetsFlowerThreshold(p.hand, p.melds, p.flowers, selfDraw, this.config).ok;
    }
    /** 当前胡牌的花数门槛详情（供 UI 提示为什么不能胡） */
    flowerGateInfo(playerId, selfDraw) {
        const p = this.players[playerId];
        return meetsFlowerThreshold(p.hand, p.melds, p.flowers, selfDraw, this.config);
    }
    /** 某玩家当前的花数（含底花），用于 UI 展示与门槛判断 */
    playerFlowers(playerId) {
        const p = this.players[playerId];
        return computeFlowers(p.hand, p.melds, p.flowers).flowers + this.config.baseFlower;
    }
    /** 某玩家手牌张数（不含副露与花牌） */
    tilesInHand(playerId) {
        return countsTotal(this.players[playerId].hand);
    }
    /** 某玩家已亮出的花牌（供 UI 展示） */
    playerFlowerTiles(playerId) {
        return this.players[playerId].flowers.slice();
    }
    /** 某玩家当前的花数明细（供 UI 展示） */
    flowerBreakdown(playerId) {
        const p = this.players[playerId];
        return computeFlowers(p.hand, p.melds, p.flowers);
    }
    /** 从指定玩家的牌河移除最后一张对应牌（被吃碰杠时调用） */
    removeFromDiscardPile(playerId, tile) {
        if (playerId < 0)
            return;
        const pile = this.discardPiles[playerId];
        // 从后往前找，移除最后一张（离弃牌时间最近的）
        for (let i = pile.length - 1; i >= 0; i--) {
            if (pile[i] === tile) {
                pile.splice(i, 1);
                return;
            }
        }
    }
    /** 某玩家的牌河（弃牌堆） */
    pileOf(playerId) {
        return this.discardPiles[playerId];
    }
    /**
     * 是否可以宣告敲。
     * 敲牌时机有两种：
     *   1. 手牌 3n+1 张且已听牌 —— 听口即当前听牌表
     *   2. 手牌 3n+2 张：已可胡（刚摸到听口牌），或打出某张后即听 ——
     *      敲的当回合弃牌必须保持听口，弃牌后听口锁定
     */
    canQi(playerId) {
        const p = this.players[playerId];
        if (p.hasQi)
            return false;
        const total = countsTotal(p.hand);
        if (total % 3 === 1) {
            // 需已听牌
            return winningTiles(p.hand, p.melds.length).length > 0;
        }
        if (total % 3 === 2) {
            // 已可胡，或存在「打出即听」的弃牌
            return isWinning(p.hand, p.melds.length) || this.qiDiscardOptions(p).length > 0;
        }
        return false;
    }
    /**
     * 当前听口评估（供 UI/AI 展示；敲后真实听口以 p.qiTiles 为准）。
     * 3n+2 且尚未成胡时，返回所有「保听弃牌」听口的并集。
     */
    qiTilesOf(playerId) {
        const p = this.players[playerId];
        const total = countsTotal(p.hand);
        if (total % 3 === 1)
            return winningTiles(p.hand, p.melds.length);
        if (isWinning(p.hand, p.melds.length))
            return [];
        return this.qiWaitUnion(p);
    }
    // ---------- 执行动作 ----------
    act(playerId, action) {
        const p = this.players[playerId];
        switch (action.type) {
            case 'qi': {
                if (!this.canQi(playerId))
                    return;
                p.hasQi = true;
                const total = countsTotal(p.hand);
                if (total % 3 === 1) {
                    // 已听牌：听口直接锁定
                    p.qiTiles = winningTiles(p.hand, p.melds.length);
                    p.qiDiscardPending = false;
                }
                else if (isWinning(p.hand, p.melds.length)) {
                    // 刚摸到听口牌已成胡：听口为「打掉刚摸的牌」后的听牌表
                    p.qiDiscardPending = false;
                    if (this.justDrawn >= 0 && p.hand[this.justDrawn] > 0) {
                        p.hand[this.justDrawn]--;
                        p.qiTiles = winningTiles(p.hand, p.melds.length);
                        p.hand[this.justDrawn]++;
                    }
                    else {
                        p.qiTiles = [];
                    }
                }
                else {
                    // 打出即听：本回合弃牌必须保持听口，弃牌后听口才锁定
                    p.qiTiles = this.qiWaitUnion(p);
                    p.qiDiscardPending = true;
                }
                this.log.push(`P${playerId}敲：听 ${p.qiTiles.map(tileName).join(' ')}`);
                this.pendingWinAfterQi = false;
                // 敲后若已达成胡牌条件，标记为「可胡」等待玩家选择（不再强制）
                if (this.canWinNow(playerId)) {
                    this.pendingWinAfterQi = true;
                    if (p.isAI) {
                        this.doWin(playerId, null, false);
                        return;
                    }
                }
                // 敲完仍需出牌，回合不变
                this.phase = 'discard';
                return;
            }
            case 'discard': {
                // 花牌不能打出（正常情况下花牌不在手牌，此处为防御性检查）
                if (isFlower(action.tile))
                    return;
                if (p.hand[action.tile] <= 0)
                    return;
                // 敲后的弃牌限制
                if (p.hasQi) {
                    if (p.qiDiscardPending) {
                        // 敲的当回合：必须保持听口
                        if (!this.qiDiscardOptions(p).includes(action.tile))
                            return;
                    }
                    else if (this.justDrawn >= 0) {
                        // 听口已锁定：摸啥打啥
                        if (action.tile !== this.justDrawn)
                            return;
                    }
                    else if (!this.waitKeepingDiscards(p).includes(action.tile)) {
                        return;
                    }
                }
                p.hand[action.tile]--;
                this.justDrawn = -1;
                // 敲的当回合弃牌后，听口锁定
                if (p.hasQi && p.qiDiscardPending) {
                    p.qiDiscardPending = false;
                    p.qiTiles = winningTiles(p.hand, p.melds.length);
                    this.log.push(`P${playerId} 听口锁定：${p.qiTiles.map(tileName).join(' ')}`);
                }
                this.lastDiscard = { player: playerId, tile: action.tile };
                // 记入牌河（被吃碰的牌稍后会被移除）
                this.discardPiles[playerId].push(action.tile);
                this.afterKong = false;
                this.openClaims(playerId, action.tile);
                // 回合推进交给 openClaims / nextTurnAfterDiscard 处理
                return;
            }
            case 'chow':
            case 'pon':
            case 'minkan': {
                // 声明的牌来自弃牌者，直接计入手牌再组成副露
                const tile = action.tile;
                // 被声明的牌从原弃牌者的牌河移除（与真实麻将一致）
                this.removeFromDiscardPile(this.lastDiscard?.player ?? -1, tile);
                p.hand[tile]++;
                if (action.type === 'chow') {
                    const comb = action.chowFrom ?? [];
                    for (const t of comb)
                        p.hand[t]--;
                    p.hand[tile]--;
                    // 完整顺子 = 被吃的牌 + 手上两张，排序后存起来供界面显示
                    const group = [...comb, tile].sort((a, b) => a - b);
                    p.melds.push({ type: 'chow', tile: group[0], tiles: group, flowers: 0 });
                }
                else if (action.type === 'pon') {
                    p.hand[tile] -= 3;
                    p.melds.push({
                        type: 'pon', tile, tiles: [tile, tile, tile],
                        flowers: isWind(tile) ? 1 : 0,
                    });
                }
                else {
                    p.hand[tile] -= 4;
                    p.melds.push({
                        type: 'minkan', tile, tiles: [tile, tile, tile, tile],
                        flowers: isWind(tile) ? 2 : 1,
                    });
                }
                p.exposedCount++;
                p.menqing = false;
                this.turn = playerId;
                this.justDrawn = -1;
                this.afterKong = action.type === 'minkan';
                if (this.afterKong) {
                    // 明杠：从牌墙补一张
                    this.drawFor(p);
                    if (this.justDrawn < 0) {
                        this.finishDraw();
                        return;
                    }
                }
                // 碰/吃不摸牌，直接从现有手牌打出一张
                this.phase = 'discard';
                return;
            }
            case 'ankan': {
                p.hand[action.tile] -= 4;
                p.melds.push({
                    type: 'ankan', tile: action.tile,
                    tiles: [action.tile, action.tile, action.tile, action.tile],
                    flowers: isWind(action.tile) ? 3 : 2,
                });
                p.exposedCount++;
                p.menqing = false;
                this.afterKong = true;
                this.drawFor(p);
                if (this.justDrawn < 0) {
                    this.finishDraw();
                    return;
                }
                this.phase = 'discard';
                return;
            }
            case 'shouminkan': {
                p.hand[action.tile]--;
                for (const m of p.melds) {
                    if (m.tile === action.tile && m.type === 'pon') {
                        m.type = 'shouminkan';
                        m.tiles = [action.tile, action.tile, action.tile, action.tile];
                        m.flowers = isWind(action.tile) ? 2 : 1;
                    }
                }
                this.afterKong = true;
                this.drawFor(p);
                if (this.justDrawn < 0) {
                    this.finishDraw();
                    return;
                }
                this.phase = 'discard';
                return;
            }
            case 'win': {
                // 自摸：本回合 drawFor 设置了 justDrawn；点炮：来自弃牌堆，justDrawn = -1
                const selfDraw = this.justDrawn >= 0;
                this.doWin(playerId, selfDraw ? null : (this.lastDiscard?.player ?? null), false);
                return;
            }
        }
    }
    openClaims(from, tile) {
        // 花牌不能被吃碰杠（正常情况下花牌摸到即亮出，根本不会被打出；
        // 此处为防御性检查，避免引擎状态异常时出现非法声明）
        if (isFlower(tile)) {
            this.nextTurnAfterDiscard();
            return;
        }
        const options = [];
        for (let d = 1; d < 4; d++) {
            const pid = (from + d) % 4;
            const p = this.players[pid];
            // 胡牌：需已敲 + 牌型可胡 + 花数达标（点炮需 ≥3 花）
            if (p.hasQi) {
                // 已敲：只能胡、杠，不能碰吃（改了听口）
                if (this.canRonWith(p, tile))
                    options.push({ player: pid, type: 'win' });
                // 明杠也必须保持听口
                if (p.hand[tile] >= 3 && this.kongAllowed(p, 'minkan', tile)) {
                    options.push({ player: pid, type: 'minkan' });
                }
                continue;
            }
            // 未敲不能胡（核心规则），只能碰/杠/吃
            if (p.hand[tile] >= 2)
                options.push({ player: pid, type: 'pon' });
            if (p.hand[tile] >= 3)
                options.push({ player: pid, type: 'minkan' });
            if (d === 1) {
                // 吃（上家）
                const r = rankOf(tile);
                const combos = [];
                if (isSuited(tile)) {
                    if (r >= 3 && p.hand[tile - 2] > 0 && p.hand[tile - 1] > 0)
                        combos.push([tile - 2, tile - 1]);
                    if (r >= 2 && r <= 8 && p.hand[tile - 1] > 0 && p.hand[tile + 1] > 0)
                        combos.push([tile - 1, tile + 1]);
                    if (r <= 7 && p.hand[tile + 1] > 0 && p.hand[tile + 2] > 0)
                        combos.push([tile + 1, tile + 2]);
                }
                for (const c of combos)
                    options.push({ player: pid, type: 'chow', chow: c });
            }
        }
        // 优先级：胡 > 碰 > 杠 > 吃
        const rank = (t) => t === 'win' ? 0 : t === 'pon' ? 1 : t === 'minkan' ? 2 : 3;
        options.sort((a, b) => rank(a.type) - rank(b.type));
        if (options.length === 0) {
            this.nextTurnAfterDiscard();
            return;
        }
        // 一炮多响：多家胡则全部胡（不结算给单一放炮者模式）
        const wins = options.filter((o) => o.type === 'win');
        if (wins.length > 1) {
            this.doMultiWin(wins.map((w) => w.player), from, tile);
            return;
        }
        this.pending = { from, tile, options };
        this.phase = 'claim';
    }
    /**
     * 能否用这张牌吃铳胡。
     * 条件：已敲 + 牌型可胡 + 计入这张牌后花数 ≥ 3。
     * 注意门槛看的是胡牌者自己的花数。
     */
    canRonWith(p, tile) {
        if (p.hand[tile] >= 4)
            return false;
        p.hand[tile]++;
        const shapeOk = isWinning(p.hand, p.melds.length);
        let ok = false;
        if (shapeOk) {
            ok = meetsFlowerThreshold(p.hand, p.melds, p.flowers, false, this.config).ok;
        }
        p.hand[tile]--;
        return ok;
    }
    /** 执行声明（吃碰杠胡） */
    claim(playerId, opt) {
        if (!this.pending)
            return false;
        const found = this.pending.options.find((o) => o.player === playerId && o.type === opt.type);
        if (!found)
            return false;
        const { from, tile } = this.pending;
        this.pending = null;
        this.phase = 'discard';
        if (opt.type === 'win') {
            // 胡的那张牌从放炮者牌河移除（与吃碰杠一致）
            this.removeFromDiscardPile(from, tile);
            this.players[playerId].hand[tile]++;
            this.doWin(playerId, from, false);
            return true;
        }
        this.act(playerId, {
            type: opt.type,
            tile,
            chowFrom: found.chow ? [found.chow[0], found.chow[1]] : undefined,
        });
        return true;
    }
    pass(playerId) {
        if (!this.pending)
            return;
        const idx = this.pending.options.findIndex((o) => o.player === playerId);
        if (idx < 0)
            return;
        this.pending.options.splice(idx, 1);
        if (this.pending.options.length === 0) {
            const { from, tile } = this.pending;
            this.pending = null;
            this.phase = 'discard';
            this.nextTurnAfterDiscard();
        }
    }
    nextTurnAfterDiscard() {
        this.beginTurn((this.lastDiscard.player + 1) % 4);
    }
    finishDraw() {
        // 流局，荒番 +1
        this.huangFan++;
        this.phase = 'game-over';
        this.log.push(`流局，荒番 ${this.huangFan}`);
    }
    // ---------- 胡牌结算 ----------
    buildCtx(p, selfDraw, robKong) {
        return {
            hand: p.hand,
            melds: p.melds,
            collectedFlowers: p.flowers,
            selfDraw,
            afterKong: this.afterKong,
            robKong,
            huangZhuang: false,
            huangMultiplier: Math.pow(2, this.huangFan),
            exposedCount: p.exposedCount,
            config: this.config,
        };
    }
    doWin(playerId, loser, robKong) {
        const p = this.players[playerId];
        const result = calculateWin(this.buildCtx(p, loser === null, robKong));
        const pts = result.points;
        if (loser === null) {
            // 自摸：三家各付一次 pts，赢家共得 3*pts
            for (let i = 0; i < 4; i++) {
                if (i === playerId)
                    continue;
                this.players[i].score -= pts;
                p.score += pts;
            }
        }
        else {
            // 点炮：放炮者独付
            this.players[loser].score -= pts;
            p.score += pts;
        }
        this.huangFan = Math.max(0, this.huangFan - 1);
        this.winner = { winner: playerId, loser, winners: [playerId], result, selfDraw: loser === null, robKong };
        this.phase = 'win-settle';
        this.log.push(`P${playerId} ${loser === null ? '自摸' : `胡 P${loser} 放炮`}：${result.names.join('+') || '平胡'} ` +
            `${result.flowers}花 × 2^${result.exponent} = ${pts} 分`);
    }
    doMultiWin(claimerIds, from, tile) {
        this.removeFromDiscardPile(from, tile);
        const results = [];
        let totalLoss = 0;
        for (const cid of claimerIds) {
            const p = this.players[cid];
            p.hand[tile]++;
            const r = calculateWin(this.buildCtx(p, false, false));
            results.push(r);
            totalLoss += r.points;
        }
        this.players[from].score -= totalLoss;
        for (let i = 0; i < claimerIds.length; i++) {
            this.players[claimerIds[i]].score += results[i].points;
        }
        this.huangFan = Math.max(0, this.huangFan - 1);
        this.winner = {
            winner: claimerIds[0], loser: from, winners: claimerIds,
            result: results[0], selfDraw: false, robKong: false,
        };
        this.phase = 'win-settle';
        this.log.push(`一炮多响：P${from} 打出 ${tileName(tile)}，P${claimerIds.join('/')} 同时胡`);
    }
    // ---------- 查询辅助 ----------
    /** 某张牌在剩余牌中的可见张数（AI 用） */
    visibleCount(tile) {
        const c = this.wall.remainingCounts();
        let n = c[tile];
        for (const p of this.players)
            n += p.hand[tile];
        return n;
    }
}
