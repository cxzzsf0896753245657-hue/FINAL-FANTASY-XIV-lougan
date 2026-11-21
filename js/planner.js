/* 製作清單 → 素材計算 */
(function (root) {
  'use strict';
  const FF = root.FF = root.FF || {};

  /** 取得某物品目前採用的製作方式：{type:'recipe',rec} | {type:'fc',seq} | null(素材) */
  FF.producerOf = function (id, opts) {
    const D = FF.D;
    if (opts.buy && opts.buy[id]) return null;
    const fc = D.fcByResult.get(id);
    if (fc) return { type: 'fc', seq: fc, amount: 1, ings: fc.ings };
    const rs = D.recipesByResult.get(id);
    if (!rs || !rs.length) return null;
    let rec = rs[0];
    const pick = opts.pick && opts.pick[id];
    if (pick) { const r = D.recipes.get(pick); if (r && r.result === id) rec = r; }
    return { type: 'recipe', rec, amount: rec.amount, ings: rec.ings };
  };

  FF.sourceOf = function (item) {
    const F = FF.FLAG;
    if (item.id <= 19) return 'crystal';
    if (item.flags & F.GATHER) return 'gather';
    if (item.flags & F.FISH) return 'fish';
    if (item.flags & F.GIL) return 'shop';
    return 'other';
  };
  FF.SOURCE_LABEL = { crystal: '水晶', gather: '採集', fish: '釣魚／刺魚', shop: '商店購買', other: '其他（市場／掉落／兌換）' };

  /** 單次展開配方樹。applyHave=true 時扣除持有數量與已完成的製作 */
  function expand(list, applyHave) {
    const D = FF.D;
    const opts = { buy: list.buy || {}, pick: list.pick || {} };
    const stock = list.stock || {};
    const done = list.done || {};
    const prodCache = new Map();
    const getProd = id => {
      if (!prodCache.has(id)) prodCache.set(id, FF.producerOf(id, opts));
      return prodCache.get(id);
    };
    const roots = new Set();
    const demand = new Map();
    for (const it of list.items) {
      if (!D.items.has(it.id) || !(it.qty > 0)) continue;
      demand.set(it.id, (demand.get(it.id) || 0) + it.qty);
      roots.add(it.id);
    }
    // 拓樸排序（父 → 子）
    const mark = new Map();
    const order = [];
    const height = new Map();
    const dfs = id => {
      if (mark.has(id)) return height.get(id) || 0;   // 循環時視為 0
      mark.set(id, 1);
      const p = getProd(id);
      let h = 0;
      if (p) {
        h = 1;
        for (const [cid] of p.ings) {
          const ch = dfs(cid);
          if (getProd(cid)) h = Math.max(h, ch + 1);
        }
      }
      height.set(id, h);
      mark.set(id, 2);
      order.push(id);
      return h;
    };
    for (const r of roots) dfs(r);
    order.reverse();

    const nodes = new Map();
    for (const id of order) {
      const req = demand.get(id) || 0;
      if (req <= 0) continue;
      const p = getProd(id);
      let have = 0;
      if (applyHave) {
        have = Math.min(stock[id] || 0, req);
        if (p && done['c' + id]) have = req;          // 已完成的製作：連同底下素材一起視為備齊
      }
      const net = req - have;
      const node = { id, item: D.items.get(id), required: req, have, net, producer: p, crafts: 0,
        surplus: 0, height: height.get(id) || 0, isRoot: roots.has(id) };
      if (p && net > 0) {
        node.crafts = Math.ceil(net / p.amount);
        node.surplus = node.crafts * p.amount - net;
        for (const [cid, amt] of p.ings) demand.set(cid, (demand.get(cid) || 0) + node.crafts * amt);
      }
      nodes.set(id, node);
    }
    return nodes;
  }

  /**
   * 計算素材。list: { items:[{id,qty}], stock:{}, done:{}, buy:{}, pick:{} }
   * 回傳 { roots, semis, raws, gil, craftCount }
   *   每個 node：total(未扣除時的總需求) / net(還需) / have / crafts / producer / source
   */
  FF.computeMaterials = function (list) {
    const full = expand(list, false);
    const act = expand(list, true);
    const roots = [], semis = [], raws = [];
    let gil = 0, craftCount = 0;
    for (const f of full.values()) {
      const a = act.get(f.id);
      const n = {
        id: f.id, item: f.item, producer: f.producer, height: f.height, isRoot: f.isRoot,
        total: f.required,
        required: a ? a.required : 0,
        have: a ? a.have : 0,
        net: a ? a.net : 0,
        crafts: a ? a.crafts : 0,
        surplus: a ? a.surplus : 0,
      };
      if (n.producer) {
        craftCount += n.crafts;
        (n.isRoot ? roots : semis).push(n);
      } else {
        n.source = FF.sourceOf(n.item);
        if (n.source === 'shop') gil += n.net * n.item.price;
        raws.push(n);
      }
    }
    const byName = (a, b) => a.item.name.localeCompare(b.item.name, 'zh-Hant');
    roots.sort(byName);
    semis.sort((a, b) => a.height - b.height || byName(a, b));
    raws.sort(byName);
    return { roots, semis, raws, gil, craftCount };
  };

  /** 依物品分類分組：回傳 [[分類名稱, nodes]] */
  FF.groupByCat = function (nodes) {
    const D = FF.D;
    const m = new Map();
    for (const n of nodes) {
      const c = D.cats[n.item.cat] || '其他';
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(n);
    }
    const ORDER = ['水晶', '石材', '金屬', '木材', '布料', '皮革', '骨材', '鍊金原料', '食材', '水產品', '染料', '組件', '魔晶石', '觸媒', '雜貨'];
    const rank = c => { const i = ORDER.indexOf(c); return i < 0 ? 99 : i; };
    return Array.from(m.entries()).sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'zh-Hant'));
  };

  /** 文字格式輸出（複製用） */
  FF.materialsText = function (res) {
    const lines = [];
    for (const [cat, list] of FF.groupByCat(res.raws.filter(n => n.net > 0))) {
      lines.push('【' + cat + '】');
      for (const n of list) lines.push(n.item.name + ' x' + n.net);
    }
    return lines.join('\n');
  };
  FF.craftsText = function (res) {
    const D = FF.D;
    const lines = [];
    let i = 1;
    for (const n of res.semis.concat(res.roots)) {
      if (n.crafts <= 0) continue;
      const p = n.producer;
      const tag = p.type === 'recipe' ? D.jobs[p.rec.job] + ' Lv' + p.rec.level : '部隊工房';
      lines.push(i++ + '. ' + n.item.name + ' x' + n.net + '（' + tag + '，製作 ' + n.crafts + ' 次）');
    }
    return lines.join('\n');
  };
})(typeof self !== 'undefined' ? self : this);
