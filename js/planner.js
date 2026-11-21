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

  /**
   * 計算素材。list: { items:[{id,qty}], stock:{}, buy:{}, pick:{} }
   * 回傳 { raw:[node], crafts:[node], gil }
   */
  FF.computeMaterials = function (list) {
    const D = FF.D;
    const opts = { buy: list.buy || {}, pick: list.pick || {} };
    const stock = list.stock || {};
    const prodCache = new Map();
    const getProd = id => {
      if (!prodCache.has(id)) prodCache.set(id, FF.producerOf(id, opts));
      return prodCache.get(id);
    };

    const roots = [];
    const demand = new Map();
    for (const it of list.items) {
      if (!D.items.has(it.id) || !(it.qty > 0)) continue;
      demand.set(it.id, (demand.get(it.id) || 0) + it.qty);
      roots.push(it.id);
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
      const have = Math.min(stock[id] || 0, req);
      const net = req - have;
      const p = getProd(id);
      const item = D.items.get(id);
      const node = { id, item, required: req, stock: have, net, producer: p, crafts: 0, yield: p ? p.amount : 1, surplus: 0, height: height.get(id) || 0 };
      if (p && net > 0) {
        node.crafts = Math.ceil(net / p.amount);
        node.surplus = node.crafts * p.amount - net;
        for (const [cid, amt] of p.ings) demand.set(cid, (demand.get(cid) || 0) + node.crafts * amt);
      }
      nodes.set(id, node);
    }

    const raw = [], crafts = [];
    let gil = 0;
    for (const n of nodes.values()) {
      if (n.producer) { if (n.crafts > 0) crafts.push(n); else if (n.required > 0) crafts.push(n); }
      else {
        n.source = FF.sourceOf(n.item);
        if (n.source === 'shop') gil += n.net * n.item.price;
        raw.push(n);
      }
    }
    const jobOf = n => (n.producer.type === 'recipe' ? n.producer.rec.job : 99);
    crafts.sort((a, b) => a.height - b.height || jobOf(a) - jobOf(b) || a.item.name.localeCompare(b.item.name, 'zh-Hant'));
    const srcOrder = ['crystal', 'gather', 'fish', 'shop', 'other'];
    raw.sort((a, b) => srcOrder.indexOf(a.source) - srcOrder.indexOf(b.source) || a.item.name.localeCompare(b.item.name, 'zh-Hant'));
    return { raw, crafts, gil };
  };

  /** 文字格式輸出（複製用） */
  FF.materialsText = function (res) {
    const lines = [];
    let cur = '';
    for (const n of res.raw) {
      if (n.net <= 0) continue;
      if (n.source !== cur) { cur = n.source; lines.push('【' + FF.SOURCE_LABEL[cur] + '】'); }
      lines.push(n.item.name + ' x' + n.net);
    }
    return lines.join('\n');
  };
  FF.craftsText = function (res) {
    const D = FF.D;
    const lines = [];
    let i = 1;
    for (const n of res.crafts) {
      if (n.crafts <= 0) continue;
      const p = n.producer;
      const tag = p.type === 'recipe' ? D.jobs[p.rec.job] + ' Lv' + p.rec.level : '部隊工房';
      lines.push(i++ + '. ' + n.item.name + ' x' + n.net + '（' + tag + '，製作 ' + n.crafts + ' 次）');
    }
    return lines.join('\n');
  };
})(typeof self !== 'undefined' ? self : this);
