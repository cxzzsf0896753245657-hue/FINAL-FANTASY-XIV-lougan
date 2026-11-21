/* 資料載入與索引 */
(function (root) {
  'use strict';
  const FF = root.FF = root.FF || {};

  const FLAG = { HQ: 1, UNTRADABLE: 2, GATHER: 4, FISH: 8, GIL: 16 };
  const RFLAG = { HQ: 1, EXPERT: 2, SPEC: 4, QUICK: 8 };
  FF.FLAG = FLAG; FF.RFLAG = RFLAG;

  FF.JOB_ICON = ['🪵', '🔨', '🛡️', '💍', '👜', '🧵', '⚗️', '🍳'];

  function pad6(n) { return String(n).padStart(6, '0'); }
  FF.iconUrl = function (icon) {
    if (!icon) return '';
    const folder = Math.floor(icon / 1000) * 1000;
    return 'https://v2.xivapi.com/api/asset?path=ui/icon/' + pad6(folder) + '/' + pad6(icon) + '.tex&format=png';
  };

  FF.loadData = async function (base) {
    base = base || 'data/';
    const get = f => fetch(base + f).then(r => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
    const [it, rc, fc, ac] = await Promise.all([get('items.json'), get('recipes.json'), get('fc.json'), get('actions.json')]);
    const D = FF.D = {};
    D.meta = it.meta;
    D.cats = it.cats;
    D.jobs = rc.jobs;
    D.rlt = rc.rlt;
    D.actionNames = ac;

    // 物品
    D.items = new Map();
    for (const r of it.items) {
      D.items.set(r[0], { id: r[0], name: r[1], icon: r[2], ilvl: r[3], cat: r[4], flags: r[5], price: r[6] });
    }
    // 配方
    D.recipes = new Map();
    D.recipesByResult = new Map();
    for (const r of rc.recipes) {
      const rl = D.rlt[r[5]];
      const rec = {
        id: r[0], job: r[1], result: r[2], amount: r[3],
        ings: [], rltId: r[5], matQ: r[6], flags: r[12], row: r,
        level: rl[0], stars: rl[1],
      };
      for (let i = 0; i < r[4].length; i += 2) rec.ings.push([r[4][i], r[4][i + 1]]);
      D.recipes.set(rec.id, rec);
      if (!D.recipesByResult.has(rec.result)) D.recipesByResult.set(rec.result, []);
      D.recipesByResult.get(rec.result).push(rec);
    }
    for (const list of D.recipesByResult.values()) list.sort((a, b) => (a.flags & 4) - (b.flags & 4) || a.job - b.job || a.id - b.id);

    // 公司工房
    D.fcBySeq = new Map();
    D.fcByResult = new Map();
    for (const s of fc.seqs) {
      const seq = { id: s[0], result: s[1], parts: s[2].map(p => ({ type: p[0], procs: p[1] })) };
      // 總需求（各階段加總）
      const total = new Map();
      for (const p of seq.parts) for (const proc of p.procs) for (const [iid, q, sets] of proc) total.set(iid, (total.get(iid) || 0) + q * sets);
      seq.ings = Array.from(total.entries());
      D.fcBySeq.set(seq.id, seq);
      D.fcByResult.set(seq.result, seq);
    }
    D.subItems = new Map(Object.entries(fc.subItems).map(([k, v]) => [Number(k), { part: v[0], cat: v[1] }]));
    D.subParts = new Map(Object.entries(fc.subParts).map(([k, v]) => [Number(k), {
      slot: v[0], rank: v[1], components: v[2], surv: v[3], ret: v[4], speed: v[5], range: v[6], favor: v[7], cls: v[8], repair: v[9],
    }]));
    D.subRanks = fc.subRanks;

    // 搜尋索引
    D.search = [];
    for (const it2 of D.items.values()) {
      const rs = D.recipesByResult.get(it2.id);
      const fcs = D.fcByResult.get(it2.id);
      if (!rs && !fcs) continue;
      D.search.push({ item: it2, lower: it2.name.toLowerCase(), recipes: rs || [], fc: fcs || null });
    }
    D.search.sort((a, b) => b.item.id - a.item.id);
    return D;
  };

  FF.itemName = id => { const i = FF.D.items.get(id); return i ? i.name : '#' + id; };

  /** 搜尋：回傳 [{item, recipes, fc}] */
  FF.search = function (q, f) {
    f = f || {};
    q = (q || '').trim().toLowerCase();
    const numeric = /^\d+$/.test(q) ? Number(q) : null;
    const out = [];
    for (const e of FF.D.search) {
      if (q) {
        if (numeric !== null) { if (e.item.id !== numeric && !e.lower.includes(q)) continue; }
        else if (!e.lower.includes(q)) continue;
      }
      if (f.job != null && f.job !== '') {
        if (f.job === 'fc') { if (!e.fc) continue; }
        else if (!e.recipes.some(r => r.job === Number(f.job))) continue;
      }
      if (f.minLv || f.maxLv) {
        const lv = e.recipes.length ? e.recipes[0].level : 0;
        if (e.recipes.length === 0) continue;
        if (f.minLv && lv < f.minLv) continue;
        if (f.maxLv && lv > f.maxLv) continue;
      }
      if (f.cat != null && f.cat !== '' && e.item.cat !== Number(f.cat)) continue;
      out.push(e);
    }
    if (q) {
      const rank = e => (e.lower === q ? 0 : e.lower.startsWith(q) ? 1 : 2);
      out.sort((a, b) => rank(a) - rank(b) || a.item.name.length - b.item.name.length || b.item.id - a.item.id);
    }
    return out;
  };
})(typeof self !== 'undefined' ? self : this);
