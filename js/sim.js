/* 製作模擬器 + 求解器（純 JS，無相依；瀏覽器、Web Worker、Node 皆可用）
 *
 * 規則依社群公開的製作公式實作（7.x 版）。所有計算都假設製作狀態恆為「通常」，
 * 隨機成功率的技能（高速製作、倉促等）不在求解範圍內。
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 技能表
  // t: p=作業 q=加工 pq=兩者 b=增益 r=修理 o=其他
  // dur: 耐久消耗, cp: CP, lvl: 需要等級
  const ACTIONS = {
    basicSynth:      { t: 'p', dur: 10, cp: 0,   lvl: 1,  pot: c => (c.level >= 31 ? 120 : 100) },
    carefulSynth:    { t: 'p', dur: 10, cp: 7,   lvl: 62, pot: c => (c.level >= 82 ? 180 : 150) },
    groundwork:      { t: 'p', dur: 20, cp: 18,  lvl: 72, pot: c => (c.level >= 86 ? 360 : 300), halve: true },
    muscleMemory:    { t: 'p', dur: 10, cp: 6,   lvl: 54, pot: () => 300, first: true },
    prudentSynth:    { t: 'p', dur: 5,  cp: 18,  lvl: 88, pot: () => 180, noWN: true },
    intensiveSynth:  { t: 'p', dur: 10, cp: 6,   lvl: 78, pot: () => 400, hs: true },
    delicateSynth:   { t: 'pq', dur: 10, cp: 32, lvl: 76, pot: c => (c.level >= 94 ? 150 : 100), qpot: () => 100 },

    basicTouch:      { t: 'q', dur: 10, cp: 18,  lvl: 5,  qpot: () => 100 },
    standardTouch:   { t: 'q', dur: 10, cp: 32,  lvl: 18, qpot: () => 125, comboFrom: ['basicTouch'], comboCp: 18 },
    advancedTouch:   { t: 'q', dur: 10, cp: 46,  lvl: 68, qpot: () => 150, comboFrom: ['standardTouch', 'observe'], comboCp: 18 },
    refinedTouch:    { t: 'q', dur: 10, cp: 24,  lvl: 92, qpot: () => 100, comboIq: 'basicTouch' },
    prudentTouch:    { t: 'q', dur: 5,  cp: 25,  lvl: 66, qpot: () => 100, noWN: true },
    preparatoryTouch:{ t: 'q', dur: 20, cp: 40,  lvl: 71, qpot: () => 200, iq: 2 },
    preciseTouch:    { t: 'q', dur: 10, cp: 18,  lvl: 53, qpot: () => 150, iq: 2, hs: true },
    byregotsBlessing:{ t: 'q', dur: 10, cp: 24,  lvl: 50, qpot: (c, s) => 100 + 20 * s.iq, needIq: 1, byregot: true },
    trainedFinesse:  { t: 'q', dur: 0,  cp: 32,  lvl: 90, qpot: () => 100, needIq: 10 },
    reflect:         { t: 'q', dur: 10, cp: 6,   lvl: 69, qpot: () => 300, iq: 2, first: true },
    trainedEye:      { t: 'q', dur: 10, cp: 250, lvl: 80, first: true, trainedEye: true },

    observe:         { t: 'o', dur: 0, cp: 7,   lvl: 13 },
    veneration:      { t: 'b', dur: 0, cp: 18,  lvl: 15, buff: 'ven', turns: 4 },
    innovation:      { t: 'b', dur: 0, cp: 18,  lvl: 26, buff: 'inn', turns: 4 },
    greatStrides:    { t: 'b', dur: 0, cp: 32,  lvl: 21, buff: 'gs', turns: 3 },
    wasteNot:        { t: 'b', dur: 0, cp: 56,  lvl: 15, buff: 'wn', turns: 4 },
    wasteNot2:       { t: 'b', dur: 0, cp: 98,  lvl: 47, buff: 'wn', turns: 8 },
    manipulation:    { t: 'b', dur: 0, cp: 96,  lvl: 65, buff: 'man', turns: 8 },
    finalAppraisal:  { t: 'b', dur: 0, cp: 1,   lvl: 42, buff: 'fa', turns: 5, noTick: true },
    heartAndSoul:    { t: 'b', dur: 0, cp: 0,   lvl: 86, special: 'hs', noTick: true, spec: true },
    trainedPerfection:{ t: 'b', dur: 0, cp: 0,  lvl: 100, special: 'tp' },
    mastersMend:     { t: 'r', dur: 0, cp: 88,  lvl: 7,  heal: 30 },
    immaculateMend:  { t: 'r', dur: 0, cp: 112, lvl: 98, heal: 9999, spec: true, once: true },
  };
  const ACTION_KEYS = Object.keys(ACTIONS);
  // 巨集等待時間：增益類 2 秒，其餘 3 秒
  const WAIT2 = new Set(['veneration', 'innovation', 'greatStrides', 'wasteNot', 'wasteNot2', 'manipulation',
    'finalAppraisal', 'heartAndSoul', 'trainedPerfection']);
  const actionWait = k => (WAIT2.has(k) ? 2 : 3);

  // ---------------------------------------------------------------- 配方 / 情境
  /** 由配方資料列 + 配方等級表算出製作參數 */
  function recipeParams(recipeRow, rltRow) {
    // recipeRow: [rid, job, result, amt, ing, rltId, matQ, diffF, qualF, durF, reqCs, reqCtl, flags]
    // rltRow: [classJobLevel, stars, suggestedCs, diff, quality, progDiv, qualDiv, progMod, qualMod, durability, cond]
    const flags = recipeRow[12];
    return {
      rlvl: rltRow[0],
      stars: rltRow[1],
      difficulty: Math.floor(rltRow[3] * recipeRow[7] / 100),
      quality: (flags & 1) ? Math.floor(rltRow[4] * recipeRow[8] / 100) : 0,
      durability: Math.floor(rltRow[9] * recipeRow[9] / 100),
      progDiv: rltRow[5], qualDiv: rltRow[6], progMod: rltRow[7], qualMod: rltRow[8],
      matQualityFactor: recipeRow[6],
      expert: !!(flags & 2),
      suggestedCs: rltRow[2], reqCs: recipeRow[10], reqCtl: recipeRow[11],
    };
  }

  /** 組合求解 / 模擬用的情境 */
  function makeCtx(player, rp) {
    const lvl = player.level;
    let baseP = Math.floor(player.craftsmanship * 10 / rp.progDiv + 2);
    let baseQ = Math.floor(player.control * 10 / rp.qualDiv + 35);
    if (lvl <= rp.rlvl) {
      baseP = Math.floor(baseP * rp.progMod / 100);
      baseQ = Math.floor(baseQ * rp.qualMod / 100);
    }
    return {
      level: lvl, specialist: !!player.specialist, maxCp: player.cp,
      craftsmanship: player.craftsmanship, control: player.control,
      diff: rp.difficulty, maxQ: rp.quality, maxD: rp.durability, rlvl: rp.rlvl, expert: rp.expert,
      baseP, baseQ,
      initQ: Math.min(player.initialQuality || 0, rp.quality),
    };
  }

  /** 由 HQ 素材估算初始品質。ings: [{ilvl, amount, hq, canHq}] */
  function initialQuality(rp, ings) {
    let total = 0, hqv = 0;
    for (const g of ings) {
      if (!g.canHq) continue;
      total += g.ilvl * g.amount;
      hqv += g.ilvl * Math.min(g.hq, g.amount);
    }
    if (total <= 0) return 0;
    return Math.floor(rp.quality * rp.matQualityFactor / 100 * hqv / total);
  }

  // ---------------------------------------------------------------- 狀態
  function initState(ctx) {
    return { p: 0, q: ctx.initQ, d: ctx.maxD, cp: ctx.maxCp, iq: 0, n: 0,
      ven: 0, inn: 0, gs: 0, wn: 0, man: 0, fa: 0, mm: 0, hs: 0, tp: 0, im: 0, last: '' };
  }
  function cloneState(s) {
    return { p: s.p, q: s.q, d: s.d, cp: s.cp, iq: s.iq, n: s.n,
      ven: s.ven, inn: s.inn, gs: s.gs, wn: s.wn, man: s.man, fa: s.fa, mm: s.mm, hs: s.hs, tp: s.tp, im: s.im, last: s.last };
  }

  /** 技能目前的 CP 消耗 */
  function cpCost(a, s) {
    return (a.comboFrom && a.comboFrom.includes(s.last)) ? a.comboCp : a.cp;
  }
  /** 技能目前的耐久消耗 */
  function durCost(a, s) {
    if (s.tp === 1 && a.dur > 0) return 0;
    return s.wn > 0 ? Math.ceil(a.dur / 2) : a.dur;
  }

  /** 檢查技能是否可用；回傳 null 表示可用，否則回傳原因 */
  function whyNot(key, s, ctx) {
    const a = ACTIONS[key];
    if (!a) return '未知技能';
    if (ctx.level < a.lvl) return '等級不足';
    if (a.spec && !ctx.specialist) return '需要專家';
    if (a.first && s.n !== 0) return '只能在第一步使用';
    if (a.trainedEye && (ctx.level - ctx.rlvl < 10 || ctx.expert)) return '配方等級過高或為高難度配方';
    if (a.needIq && s.iq < a.needIq) return a.needIq === 10 ? '需要 10 層內靜' : '需要內靜';
    if (a.hs && s.hs !== 1) return '需要專心致志';
    if (a.noWN && s.wn > 0) return '儉約狀態中不可用';
    if (key === 'heartAndSoul' && s.hs !== 0) return '每次製作僅限一次';
    if (key === 'trainedPerfection' && s.tp !== 0) return '每次製作僅限一次';
    if (a.once && s.im) return '每次製作僅限一次';
    if (a.t === 'q' && ctx.maxQ <= 0) return '此配方無法製作 HQ';
    if (cpCost(a, s) > s.cp) return 'CP 不足';
    return null;
  }

  /**
   * 執行一步。回傳 { s, st } ；st: 0 進行中, 1 完成(進度滿), 2 失敗(耐久歸零)；
   * 無法使用則回傳 null。
   */
  function step(s, key, ctx) {
    const a = ACTIONS[key];
    if (whyNot(key, s, ctx)) return null;
    const n = cloneState(s);
    // combo 狀態：加工→中級加工→上級加工；觀察→上級加工；其餘技能中斷 combo
    const combo = key === 'basicTouch' ? 'basicTouch'
      : (key === 'standardTouch' && s.last === 'basicTouch') ? 'standardTouch'
      : key === 'observe' ? 'observe' : '';
    const wasMan = s.man > 0;
    const oldBuff = { ven: s.ven, inn: s.inn, gs: s.gs, wn: s.wn, man: s.man, fa: s.fa, mm: s.mm };
    n.cp -= cpCost(a, s);
    const dc = durCost(a, s);
    if (s.tp === 1 && a.dur > 0) n.tp = 2;
    let usedGs = false, usedMm = false;

    // ---- 進度
    if (a.t === 'p' || a.t === 'pq') {
      let pot = a.pot(ctx, s);
      if (a.halve && s.d < dc) pot = pot / 2;
      const modT = 10 + (s.ven > 0 ? 5 : 0) + (s.mm > 0 ? 10 : 0);
      let gain = Math.floor(ctx.baseP * modT * pot / 1000);
      n.p += gain;
      if (s.mm > 0) usedMm = true;
      if (s.fa > 0 && n.p >= ctx.diff) { n.p = ctx.diff - 1; oldBuff.fa = 0; n.fa = 0; }
    }
    // ---- 品質
    if (a.t === 'q' || a.t === 'pq') {
      if (a.trainedEye) {
        n.q = ctx.maxQ;
      } else {
        const pot = a.qpot(ctx, s);
        const modT = 10 + (s.inn > 0 ? 5 : 0) + (s.gs > 0 ? 10 : 0);
        const gain = Math.floor(ctx.baseQ * (10 + s.iq) * modT * pot / 10000);
        n.q += gain;
        let add = a.iq || 1;
        if (a.comboIq && s.last === a.comboIq) add += 1;
        n.iq = a.byregot ? 0 : Math.min(10, s.iq + add);
      }
      if (s.gs > 0) usedGs = true;
    }
    if (a.hs) n.hs = 2;

    if (ctx.maxQ > 0 && n.q > ctx.maxQ) n.q = ctx.maxQ;

    // ---- 耐久
    n.d -= dc;
    if (a.t === 'r') n.d = Math.min(ctx.maxD, n.d + a.heal);
    if (key === 'immaculateMend') n.im = 1;

    // ---- 完成 / 失敗判斷
    if (n.p >= ctx.diff) { n.n++; n.last = combo; return { s: n, st: 1 }; }
    if (n.d <= 0) { n.n++; n.last = combo; return { s: n, st: 2 }; }

    // ---- 增益
    if (a.special === 'hs') n.hs = 1;
    if (a.special === 'tp') n.tp = 1;
    if (!a.noTick) {
      // 持續時間遞減 / 掌握回復
      if (wasMan && key !== 'manipulation') n.d = Math.min(ctx.maxD, n.d + 5);
      n.ven = Math.max(0, oldBuff.ven - 1);
      n.inn = Math.max(0, oldBuff.inn - 1);
      n.gs = Math.max(0, oldBuff.gs - 1);
      n.wn = Math.max(0, oldBuff.wn - 1);
      n.man = Math.max(0, oldBuff.man - 1);
      n.fa = Math.max(0, oldBuff.fa - 1);
      n.mm = Math.max(0, oldBuff.mm - 1);
      if (usedGs) n.gs = 0;
      if (usedMm) n.mm = 0;
    } else {
      if (usedGs) n.gs = 0;
      if (usedMm) n.mm = 0;
    }
    if (key === 'muscleMemory') n.mm = 5;
    if (a.buff) n[a.buff] = a.turns;
    if (a.buff === 'wn') { /* 兩種儉約互斥，後施放的覆蓋 */ }
    n.n++;
    n.last = combo;
    return { s: n, st: 0 };
  }

  /** 依序模擬一串技能；遇到無法使用的技能就停下並回報原因 */
  function simulate(ctx, keys) {
    let s = initState(ctx);
    const steps = [];
    let status = 0, error = null;
    for (let i = 0; i < keys.length; i++) {
      const why = whyNot(keys[i], s, ctx);
      if (why) { error = { index: i, key: keys[i], reason: why }; break; }
      const r = step(s, keys[i], ctx);
      if (!r) { error = { index: i, key: keys[i], reason: '無法使用' }; break; }
      s = r.s; status = r.st;
      steps.push({ key: keys[i], s });
      if (status !== 0) {
        if (i < keys.length - 1) error = { index: i + 1, key: keys[i + 1], reason: status === 1 ? '製作已完成' : '耐久歸零，製作失敗' };
        break;
      }
    }
    return { steps, final: s, status, error };
  }

  // ---------------------------------------------------------------- 求解器
  const PROGRESS_KEYS = ['basicSynth', 'carefulSynth', 'groundwork', 'prudentSynth', 'intensiveSynth'];

  /** 貪婪收尾：只用作業類技能把進度推到完成。回傳 {keys, s} 或 null。 */
  function finishGreedy(s0, ctx, useVen) {
    let s = s0;
    const keys = [];
    for (let guard = 0; guard < 24; guard++) {
      if (useVen && s.ven === 0 && keys.length === 0 && !whyNot('veneration', s, ctx)) {
        const r = step(s, 'veneration', ctx);
        if (!r) return null;
        s = r.s; keys.push('veneration'); continue;
      }
      let bestKey = null, bestScore = -1, finishKey = null, finishCost = 1e9;
      for (const k of PROGRESS_KEYS) {
        if (whyNot(k, s, ctx)) continue;
        const r = step(s, k, ctx);
        if (!r) continue;
        if (r.st === 1) {
          const c = cpCost(ACTIONS[k], s) * 100 + durCost(ACTIONS[k], s);
          if (c < finishCost) { finishCost = c; finishKey = k; }
        } else if (r.st === 0) {
          const g = r.s.p - s.p;
          if (g > bestScore) { bestScore = g; bestKey = k; }
        }
      }
      if (finishKey) { keys.push(finishKey); return { keys, s: step(s, finishKey, ctx).s }; }
      if (bestKey) {
        const r = step(s, bestKey, ctx);
        keys.push(bestKey); s = r.s; continue;
      }
      // 耐久不足：嘗試精修 / 掌握
      if (!whyNot('mastersMend', s, ctx)) {
        const r = step(s, 'mastersMend', ctx);
        if (r && r.st === 0) { keys.push('mastersMend'); s = r.s; continue; }
      }
      return null;
    }
    return null;
  }
  function bestFinish(s, ctx) {
    let best = null;
    for (const v of [false, true]) {
      const f = finishGreedy(s, ctx, v);
      if (f && (!best || f.keys.length < best.keys.length)) best = f;
    }
    return best;
  }

  function candidates(s, ctx, target) {
    const out = [];
    const needQ = ctx.maxQ > 0 && s.q < target;
    for (const k of ACTION_KEYS) {
      const a = ACTIONS[k];
      if (whyNot(k, s, ctx)) continue;
      // 剪枝
      if (a.t === 'q' && !needQ) continue;
      if (a.t === 'pq' && !needQ) continue;
      if (a.buff === 'ven' && s.ven > 1) continue;
      if (a.buff === 'inn' && (s.inn > 1 || !needQ)) continue;
      if (a.buff === 'gs' && (s.gs > 0 || !needQ)) continue;
      if (a.buff === 'wn' && (s.wn > 1)) continue;
      if (a.buff === 'man' && s.man > 1) continue;
      if (a.buff === 'fa' && s.fa > 0) continue;
      if (k === 'mastersMend' && s.d > ctx.maxD - 25) continue;
      if (k === 'immaculateMend' && s.d > ctx.maxD - 35) continue;
      if (k === 'byregotsBlessing' && s.iq < 3) continue;
      if (k === 'observe' && !needQ) continue;
      if (k === 'trainedPerfection' && s.d > ctx.maxD - 15) continue;
      out.push(k);
    }
    return out;
  }

  /** 啟發式評分：品質為主，並加上剩餘資源與增益的潛在價值 */
  function score(s, ctx, target) {
    const bq = ctx.baseQ;
    const qEff = Math.min(s.q, target);
    const ipc = bq * (10 + s.iq) / 10;               // 每 100% 效率的品質
    let pot = s.cp * ipc * 0.055;                     // CP 可轉換的品質
    pot += Math.max(0, s.d) * ipc * 0.018;            // 耐久
    if (s.inn > 0) pot += ipc * 0.5 * Math.min(s.inn, 3) * 0.6;
    if (s.gs > 0) pot += ipc * 1.0 * 0.9;
    if (s.man > 0) pot += s.man * 5 * ipc * 0.018;
    if (s.wn > 0) pot += s.wn * 5 * ipc * 0.018 * 0.5;
    pot += s.iq * ipc * 0.12;
    // 進度：太低的話收尾要花費資源，所以略加權
    pot += Math.min(s.p, ctx.diff) / ctx.diff * ipc * 1.2;
    return qEff * 3 + pot - s.n * ipc * 0.05;
  }

  function stateKey(s) {
    return s.p + ',' + s.q + ',' + s.d + ',' + s.cp + ',' + s.iq + ',' + s.ven + s.inn + s.gs + s.wn + s.man + s.fa + s.mm + s.hs + s.tp + s.im + s.last + (s.n === 0 ? 'f' : '');
  }

  /**
   * 求解。opts: { width, target(目標品質, 預設滿), maxSteps, timeLimitMs, onProgress }
   * 回傳 { keys, final, finished, reachedTarget }
   */
  function solve(ctx, opts) {
    opts = opts || {};
    const width = opts.width || 4000;
    const maxSteps = opts.maxSteps || 40;
    const target = Math.min(opts.target != null ? opts.target : ctx.maxQ, ctx.maxQ);
    const deadline = Date.now() + (opts.timeLimitMs || 60000);
    let s0 = initState(ctx);
    const prefix = [];
    for (const k of (opts.prefix || [])) {
      const r = step(s0, k, ctx);
      if (!r || r.st !== 0) return { keys: [], final: s0, finished: false, reachedTarget: false };
      s0 = r.s; prefix.push(k);
    }
    let best = null;
    const record = (path, s) => {
      const fin = bestFinish(s, ctx);
      if (!fin) return false;
      const q = Math.min(fin.s.q, target);
      const total = path.length + fin.keys.length;
      if (!best || q > best.q || (q === best.q && total < best.keys.length)) {
        best = { q, keys: path.concat(fin.keys), final: fin.s };
      }
      return true;
    };
    if (!record(prefix.slice(), s0)) return { keys: [], final: s0, finished: false, reachedTarget: false };

    let beam = [{ s: s0, path: prefix.slice() }];
    for (let depth = 0; depth < maxSteps; depth++) {
      if (Date.now() > deadline) break;
      const next = new Map();
      for (const node of beam) {
        const cands = candidates(node.s, ctx, target);
        for (const k of cands) {
          const r = step(node.s, k, ctx);
          if (!r || r.st !== 0) {
            if (r && r.st === 1) {
              const q = Math.min(r.s.q, target);
              const path = node.path.concat(k);
              if (!best || q > best.q || (q === best.q && path.length < best.keys.length)) best = { q, keys: path, final: r.s };
            }
            continue;
          }
          const key = stateKey(r.s);
          const sc = score(r.s, ctx, target);
          const old = next.get(key);
          if (!old || old.sc < sc) next.set(key, { s: r.s, sc, parent: node.path, k });
        }
      }
      if (next.size === 0) break;
      const arr = Array.from(next.values()).sort((x, y) => y.sc - x.sc);
      const nb = [];
      for (const c of arr) {
        if (nb.length >= width) break;
        const path = c.parent.concat(c.k);
        if (!record(path, c.s)) continue;       // 無法收尾的狀態直接丟棄
        if (c.s.q >= target) continue;           // 已達標，不必再展開
        nb.push({ s: c.s, path });
      }
      beam = nb;
      if (opts.onProgress) opts.onProgress({ depth: depth + 1, best: best ? best.q : 0, target, size: beam.length });
      if (!beam.length) break;
      if (best && best.q >= target && ctx.maxQ > 0) {
        // 已達標：再多跑幾層找更短的方案即可
        if (depth > (best.keys.length + 2)) break;
      }
    }
    if (!best) return { keys: [], final: s0, finished: false, reachedTarget: false };
    return { keys: best.keys, final: best.final, finished: true, reachedTarget: best.q >= target };
  }

  // ---------------------------------------------------------------- 模擬退火優化
  function makeRng(seed) {
    let x = (seed >>> 0) || 123456789;
    return function () {            // xorshift32
      x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  }

  /**
   * 解碼一串技能：不能用的技能直接略過；若序列結束時進度未滿，自動接上收尾。
   * 回傳 { keys(實際執行), s, ok }
   */
  function decode(ctx, seq) {
    let s = initState(ctx);
    const used = [];
    for (let i = 0; i < seq.length; i++) {
      const k = seq[i];
      if (whyNot(k, s, ctx)) continue;
      const r = step(s, k, ctx);
      if (!r) continue;
      used.push(k);
      s = r.s;
      if (r.st === 1) return { keys: used, s, ok: true };
      if (r.st === 2) return { keys: used, s, ok: false };
    }
    const fin = bestFinish(s, ctx);
    if (!fin) return { keys: used, s, ok: false };
    return { keys: used.concat(fin.keys), s: fin.s, ok: true };
  }

  function seqValue(ctx, seq, target) {
    const d = decode(ctx, seq);
    if (!d.ok) return { v: -1e9 + d.s.p, d };
    const q = Math.min(d.s.q, target);
    let secs = 0;
    for (const k of d.keys) secs += actionWait(k);
    // 平滑評分供退火探索；另以 rank（先品質後時間）記錄最佳解
    return { v: q - secs * ctx.baseQ * 0.08 + d.s.cp * 0.0001, d, rank: q * 1000 - secs };
  }

  function polish(ctx, startKeys, opts) {
    opts = opts || {};
    const target = Math.min(opts.target != null ? opts.target : ctx.maxQ, ctx.maxQ);
    const rng = makeRng(opts.seed || 20240607);
    const iters = opts.iterations || 1e9;               // 以時間為主要上限
    const tStart = Date.now(), tLen = opts.timeLimitMs || 20000;
    const deadline = tStart + tLen;
    const pool = ACTION_KEYS.filter(k => {
      const a = ACTIONS[k];
      if (ctx.level < a.lvl) return false;
      if (a.spec && !ctx.specialist) return false;
      if (a.t === 'q' && ctx.maxQ <= 0) return false;
      return true;
    });
    let cur = startKeys.slice();
    let curV = seqValue(ctx, cur, target);
    let best = cur.slice(), bestV = curV;
    const T0 = ctx.baseQ * 1.5, T1 = ctx.baseQ * 0.01;
    for (let it = 0; it < iters; it++) {
      if ((it & 255) === 0) { var now = Date.now(); if (now > deadline) break; }
      const frac = Math.min(1, Math.max(it / iters, ((now || Date.now()) - tStart) / tLen));
      const T = T0 * Math.pow(T1 / T0, frac);
      const cand = cur.slice();
      const r = rng();
      const len = cand.length;
      if (r < 0.35 && len) cand[Math.floor(rng() * len)] = pool[Math.floor(rng() * pool.length)];
      else if (r < 0.60) cand.splice(Math.floor(rng() * (len + 1)), 0, pool[Math.floor(rng() * pool.length)]);
      else if (r < 0.80 && len > 1) cand.splice(Math.floor(rng() * len), 1);
      else if (len > 1) { const i = Math.floor(rng() * (len - 1)); const t = cand[i]; cand[i] = cand[i + 1]; cand[i + 1] = t; }
      else continue;
      if (cand.length > 60) continue;
      const v = seqValue(ctx, cand, target);
      const dv = v.v - curV.v;
      if (v.d.ok && (!bestV.d.ok || v.rank > bestV.rank)) { best = cand.slice(); bestV = v; }
      if (dv >= 0 || rng() < Math.exp(dv / T)) {
        cur = cand; curV = v;
        if (v.d.ok && (!bestV.d.ok || v.rank > bestV.rank)) { best = cand.slice(); bestV = v; }
      }
      if (opts.onProgress && (it % 50000) === 0) opts.onProgress({ phase: 'polish', iter: it, iters, best: Math.min(bestV.d.s.q, target), target });
    }
    const d = bestV.d;
    return { keys: d.keys, final: d.s, finished: d.ok, reachedTarget: d.ok && d.s.q >= target };
  }

  /** 收尾：逐一嘗試刪除、替換、刪兩步插一步，直到找不到更好的流程 */
  function shorten(ctx, best, tq, better) {
    const pool = ACTION_KEYS.filter(k => ctx.level >= ACTIONS[k].lvl && (!ACTIONS[k].spec || ctx.specialist));
    const tryKeys = keys => {
      const d = decode(ctx, keys);
      return d.ok ? { keys: d.keys, final: d.s, finished: true, reachedTarget: d.s.q >= tq } : null;
    };
    let improved = true, guard = 0;
    while (improved && guard++ < 20) {
      improved = false;
      const k0 = best.keys;
      const cands = [];
      for (let i = 0; i < k0.length; i++) {
        cands.push(k0.slice(0, i).concat(k0.slice(i + 1)));
        for (const a of pool) if (a !== k0[i]) cands.push(k0.slice(0, i).concat([a], k0.slice(i + 1)));
        if (i + 1 < k0.length) for (const a of pool) cands.push(k0.slice(0, i).concat([a], k0.slice(i + 2)));
      }
      for (const c of cands) {
        const r = tryKeys(c);
        if (r && better(r, best)) { best = r; improved = true; }
      }
    }
    return best;
  }

  /** 求解 + 退火優化。多次不同亂數種子取最佳。 */
  function solveBest(ctx, opts) {
    opts = opts || {};
    const tq = Math.min(opts.target != null ? opts.target : ctx.maxQ, ctx.maxQ);
    const secs = r => r.keys.reduce((t, k) => t + actionWait(k), 0);
    const better = (a, b) => {
      const qa = Math.min(a.final.q, tq), qb = Math.min(b.final.q, tq);
      return qa > qb || (qa === qb && secs(a) < secs(b));
    };
    const t0 = Date.now();
    const total = opts.timeLimitMs || 30000;
    // 多個起手式各自光束搜尋，再分別退火，取最佳
    const openers = [[]];
    for (const k of ['muscleMemory', 'reflect']) if (!whyNot(k, initState(ctx), ctx)) openers.push([k]);
    const starts = [];
    for (const pre of openers) {
      const r = solve(ctx, { width: opts.width || 1000, target: opts.target, prefix: pre, timeLimitMs: total * 0.3 / openers.length, onProgress: opts.onProgress });
      if (r.finished) starts.push(r);
    }
    if (!starts.length) return solve(ctx, { width: 300, target: opts.target, timeLimitMs: 5000 });
    let best = starts[0];
    for (const r of starts) if (better(r, best)) best = r;
    const rounds = Math.max(starts.length, opts.rounds || 3);
    for (let i = 0; i < rounds; i++) {
      const left = total - (Date.now() - t0);
      if (left < 300) break;
      const from = starts[i % starts.length];
      const r = polish(ctx, from.keys, { target: opts.target, seed: 1000 + i * 7919, iterations: opts.iterations, timeLimitMs: left / (rounds - i), onProgress: opts.onProgress });
      if (r.finished && better(r, best)) best = r;
      if (r.finished && better(r, from)) starts[i % starts.length] = r;
    }
    return shorten(ctx, best, tq, better);
  }

  // ---------------------------------------------------------------- 巨集
  /**
   * 產生巨集文字。names: {actionKey: 繁中名稱}
   * opts: { notify: 'auto'|'always'|'none', se: '<se.1>'|'', split: 'even'|'greedy', extraWait: 0 }
   *   auto：放得下時才在巨集最後加完成提示（剛好 15 行時不另外拆出新巨集）
   * 回傳 [{lines, text, seconds}]
   */
  function buildMacros(keys, names, opts) {
    opts = opts || {};
    const notify = opts.notify || 'auto';
    const se = opts.se == null ? '<se.1>' : opts.se;
    const extra = Math.max(0, Math.floor(opts.extraWait || 0));
    const MAX = 15;
    if (!keys.length) return [];
    let per = notify === 'none' ? MAX : MAX - 1;
    if (notify === 'auto' && keys.length <= MAX && keys.length > MAX - 1) per = MAX;   // 一個巨集剛好放滿就不加提示
    let n = Math.ceil(keys.length / per);
    const sizes = [];
    if (opts.split === 'greedy') { for (let i = 0; i < n; i++) sizes.push(Math.min(per, keys.length - i * per)); }
    else { const base = Math.floor(keys.length / n), rem = keys.length % n; for (let i = 0; i < n; i++) sizes.push(base + (i < rem ? 1 : 0)); }
    const out = [];
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const chunk = keys.slice(pos, pos + sizes[i]); pos += sizes[i];
      const lines = chunk.map(k => {
        const nm = names[k] || k;
        return '/ac ' + (/\s/.test(nm) ? '"' + nm + '"' : nm) + ' <wait.' + (actionWait(k) + extra) + '>';
      });
      if (notify !== 'none' && lines.length < MAX) lines.push('/e 巨集#' + (i + 1) + ' 已完成！' + (se ? ' ' + se : ''));
      let sec = 0;
      for (const k of chunk) sec += actionWait(k) + extra;
      out.push({ lines, text: lines.join('\n'), seconds: sec });
    }
    return out;
  }

  // 品質百分比 → HQ 機率（%）
  const HQ_TABLE = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10,
    11, 11, 11, 12, 12, 12, 13, 13, 13, 14, 14, 14, 15, 15, 15, 16, 16, 17, 17, 17, 18, 18, 18, 19, 19, 20, 20, 21, 22, 23, 24, 26, 28,
    31, 34, 38, 42, 47, 52, 58, 64, 68, 71, 74, 76, 78, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 94, 96, 98, 100];
  function hqChance(q, maxQ) {
    if (!maxQ) return 0;
    return HQ_TABLE[Math.max(0, Math.min(100, Math.floor(q * 100 / maxQ)))];
  }

  /** 解析貼上的巨集文字，回傳技能 key 陣列與未識別的行 */
  function parseMacro(text, names) {
    const rev = {};
    for (const k of Object.keys(names)) rev[names[k]] = k;
    const keys = [], unknown = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const m = raw.match(/\/(?:ac|action|craftaction|ca)\s+"?([^"<]+?)"?\s*(?:<|$)/i);
      if (!m) continue;
      const nm = m[1].trim();
      if (rev[nm]) keys.push(rev[nm]); else unknown.push(nm);
    }
    return { keys, unknown };
  }

  const api = { ACTIONS, ACTION_KEYS, actionWait, recipeParams, makeCtx, initialQuality, initState, step, whyNot,
    simulate, solve, polish, solveBest, decode, buildMacros, hqChance, parseMacro, cpCost, durCost };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FFSim = api;
})(typeof self !== 'undefined' ? self : this);
