/* FF14 製作規劃工具 — 介面 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); };
  const fmt = n => Number(n).toLocaleString('en-US');
  const view = $('#view');

  // ------------------------------------------------------------ 儲存
  const KEY = 'ffxivcp.v1';
  const newId = () => 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const newList = name => ({ id: newId(), name: name || '清單 1', items: [], stock: {}, done: {}, buy: {}, pick: {} });
  const Store = {
    d: null,
    load() {
      try { this.d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { this.d = null; }
      if (!this.d || !Array.isArray(this.d.lists) || !this.d.lists.length) this.d = { lists: [newList()], cur: null, stats: {} };
      if (!this.d.lists.some(l => l.id === this.d.cur)) this.d.cur = this.d.lists[0].id;
      this.d.stats = this.d.stats || {};
      for (const l of this.d.lists) for (const k of ['stock', 'done', 'buy', 'pick']) l[k] = l[k] || {};
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { /* 無法儲存時略過 */ } },
    get list() { return this.d.lists.find(l => l.id === this.d.cur); },
  };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 2200);
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg || '已複製'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg || '已複製'); } catch (e2) { toast('複製失敗'); }
      ta.remove();
    }
  }
  function dialog(html, onMount) {
    const d = $('#dlg');
    d.innerHTML = html;
    if (!d.open) d.showModal();
    d.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => d.close()));
    if (onMount) onMount(d);
    return d;
  }

  // ------------------------------------------------------------ 共用顯示
  const D = () => FF.D;
  const icon = (item, cls) => item && item.icon
    ? '<img class="icon ' + (cls || '') + '" loading="lazy" referrerpolicy="no-referrer" src="' + FF.iconUrl(item.icon) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
    : '<span class="icon ' + (cls || '') + '"></span>';
  const stars = n => (n > 0 ? '<span class="star">' + '★'.repeat(n) + '</span>' : '');
  const jobTag = rec => '<span class="tag job">' + FF.JOB_ICON[rec.job] + ' ' + esc(D().jobs[rec.job]) + ' Lv' + rec.level + (rec.stars ? ' ' + stars(rec.stars) : '') + '</span>';
  const ingText = (ings, max) => {
    const arr = ings.slice(0, max || 99).map(([id, n]) => esc(FF.itemName(id)) + '×' + n);
    return arr.join('、') + (ings.length > (max || 99) ? '…' : '');
  };
  const srcTag = s => '<span class="tag src-' + s + '">' + esc(FF.SOURCE_LABEL[s].split('（')[0]) + '</span>';

  function updateBadge() {
    const n = Store.list.items.length;
    $('#listBadge').textContent = n;
  }

  function addToList(id, qty, rid) {
    const l = Store.list;
    const ex = l.items.find(x => x.id === id);
    if (ex) ex.qty += qty; else l.items.push({ id, qty });
    if (rid) l.pick[id] = rid;
    Store.save(); updateBadge();
  }

  // ------------------------------------------------------------ 路由
  const routes = { search: renderSearch, list: renderList, materials: renderMaterials, macro: renderMacro, sub: renderSub };
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/');
    let name = parts[0] || 'search';
    if (name === 'import') { doImport(parts.slice(1).join('/')); location.hash = '#/list'; return; }
    if (!routes[name]) name = 'search';
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === name));
    stopWorker();
    routes[name](parts.slice(1));
    window.scrollTo(0, 0);
  }

  // 事件代理
  const actions = {};
  const inputs = {};
  view.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const f = actions[b.dataset.act];
    if (f) f(b, e);
  });
  view.addEventListener('change', e => {
    const t = e.target.closest('[data-in]');
    if (t && inputs[t.dataset.in]) inputs[t.dataset.in](t, e);
  });
  view.addEventListener('input', e => {
    const t = e.target.closest('[data-live]');
    if (t && inputs[t.dataset.live]) inputs[t.dataset.live](t, e);
  });

  // ============================================================ 搜尋
  const S = { q: '', job: '', minLv: '', maxLv: '', cat: '', limit: 60 };
  function renderSearch() {
    if (!D().craftCats) {
      const set = new Set();
      for (const e of D().search) set.add(e.item.cat);
      D().craftCats = Array.from(set).filter(c => D().cats[c]).sort((a, b) => D().cats[a].localeCompare(D().cats[b], 'zh-Hant'));
    }
    view.innerHTML = `
      <div class="panel">
        <h2>搜尋物品</h2>
        <div class="row">
          <input id="sq" class="grow" data-live="sq" type="search" placeholder="輸入物品名稱（例如：鯊魚級、秘銀、藥水）" value="${esc(S.q)}" autocomplete="off">
          <select id="sjob" data-in="sfilter">
            <option value="">全部職業</option>
            ${D().jobs.map((j, i) => `<option value="${i}" ${String(S.job) === String(i) ? 'selected' : ''}>${FF.JOB_ICON[i]} ${esc(j)}</option>`).join('')}
            <option value="fc" ${S.job === 'fc' ? 'selected' : ''}>🏠 部隊工房</option>
          </select>
          <input id="smin" data-in="sfilter" type="number" min="1" max="100" placeholder="最低等級" value="${esc(S.minLv)}" title="配方最低等級">
          <input id="smax" data-in="sfilter" type="number" min="1" max="100" placeholder="最高等級" value="${esc(S.maxLv)}" title="配方最高等級">
          <select id="scat" data-in="sfilter">
            <option value="">全部分類</option>
            ${D().craftCats.map(c => `<option value="${c}" ${String(S.cat) === String(c) ? 'selected' : ''}>${esc(D().cats[c])}</option>`).join('')}
          </select>
          <button data-act="sclear">清除</button>
        </div>
        <div class="muted small" style="margin-top:6px" id="scount"></div>
      </div>
      <div class="panel" id="sres"></div>`;
    updateSearch();
    $('#sq').focus();
  }
  inputs.sq = el => { S.q = el.value; S.limit = 60; updateSearch(); };
  inputs.sfilter = () => {
    S.job = $('#sjob').value; S.minLv = $('#smin').value; S.maxLv = $('#smax').value; S.cat = $('#scat').value; S.limit = 60;
    updateSearch();
  };
  actions.sclear = () => { Object.assign(S, { q: '', job: '', minLv: '', maxLv: '', cat: '', limit: 60 }); renderSearch(); };
  actions.smore = () => { S.limit += 60; updateSearch(); };

  function updateSearch() {
    const res = FF.search(S.q, { job: S.job, minLv: num(S.minLv), maxLv: num(S.maxLv), cat: S.cat });
    $('#scount').textContent = '共 ' + fmt(res.length) + ' 筆' + (res.length > S.limit ? '（顯示前 ' + S.limit + ' 筆）' : '');
    const box = $('#sres');
    if (!res.length) { box.innerHTML = '<div class="empty">找不到符合的可製作物品。</div>'; return; }
    box.innerHTML = res.slice(0, S.limit).map(e => {
      const it = e.item;
      const tags = e.recipes.map(jobTag).join('') + (e.fc ? '<span class="tag fc">🏠 部隊工房</span>' : '');
      const ings = e.fc ? e.fc.ings : (e.recipes[0] ? e.recipes[0].ings : []);
      const rid = e.recipes[0] ? e.recipes[0].id : 0;
      return `<div class="item" data-id="${it.id}">
        ${icon(it)}
        <div class="body">
          <div class="nm">${esc(it.name)} <span class="muted small">ID ${it.id}${it.ilvl ? ' · 品級 ' + it.ilvl : ''}</span></div>
          <div class="meta">${tags}</div>
          <div class="meta">素材：${ingText(ings, 8)}</div>
        </div>
        <input type="number" min="1" value="1" class="qty" aria-label="數量">
        <button class="pri" data-act="sadd" data-id="${it.id}">＋清單</button>
        ${rid ? `<a href="#/macro/${rid}"><button>巨集</button></a>` : ''}
      </div>`;
    }).join('') + (res.length > S.limit ? '<div style="text-align:center;margin-top:10px"><button data-act="smore">顯示更多</button></div>' : '');
  }
  actions.sadd = b => {
    const row = b.closest('.item');
    const q = Math.max(1, Math.floor(num($('.qty', row).value, 1)));
    addToList(Number(b.dataset.id), q);
    toast('已加入「' + FF.itemName(Number(b.dataset.id)) + '」×' + q);
  };

  // ============================================================ 清單
  function listSelector() {
    return `<div class="row">
      <select data-in="listsel">${Store.d.lists.map(l => `<option value="${l.id}" ${l.id === Store.d.cur ? 'selected' : ''}>${esc(l.name)}（${l.items.length}）</option>`).join('')}</select>
      <button data-act="lnew">新增清單</button>
      <button data-act="lrename">重新命名</button>
      <button data-act="ldel" class="danger">刪除清單</button>
      <span class="sp"></span>
      <button data-act="lexport">匯出／分享</button>
      <button data-act="limport">匯入</button>
    </div>`;
  }
  inputs.listsel = el => { Store.d.cur = el.value; Store.save(); route(); };
  actions.lnew = () => {
    const name = prompt('新清單名稱', '清單 ' + (Store.d.lists.length + 1));
    if (!name) return;
    const l = newList(name.trim()); Store.d.lists.push(l); Store.d.cur = l.id; Store.save(); route();
  };
  actions.lrename = () => {
    const name = prompt('清單名稱', Store.list.name);
    if (!name) return; Store.list.name = name.trim(); Store.save(); route();
  };
  actions.ldel = () => {
    if (!confirm('確定刪除清單「' + Store.list.name + '」？')) return;
    Store.d.lists = Store.d.lists.filter(l => l.id !== Store.d.cur);
    if (!Store.d.lists.length) Store.d.lists.push(newList());
    Store.d.cur = Store.d.lists[0].id; Store.save(); route();
  };
  function exportPayload(l) {
    return { n: l.name, i: l.items.map(x => [x.id, x.qty]), p: l.pick, b: l.buy };
  }
  const b64enc = o => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  const b64dec = s => JSON.parse(decodeURIComponent(escape(atob(s))));
  actions.lexport = () => {
    const l = Store.list;
    const code = b64enc(exportPayload(l));
    const url = location.origin + location.pathname + '#/import/' + code;
    dialog(`<h3>匯出／分享「${esc(l.name)}」</h3>
      <p class="muted small">分享連結：對方打開後會詢問是否匯入這份清單。</p>
      <textarea id="exurl" rows="3" readonly>${esc(url)}</textarea>
      <div class="row" style="margin-top:10px"><button class="pri" id="excopy">複製連結</button>
      <button id="extext">複製文字清單</button><span class="sp"></span><button data-close>關閉</button></div>`, d => {
      $('#excopy', d).onclick = () => copy(url, '已複製分享連結');
      $('#extext', d).onclick = () => copy(l.items.map(x => FF.itemName(x.id) + ' x' + x.qty).join('\n'), '已複製文字清單');
    });
  };
  actions.limport = () => {
    dialog(`<h3>匯入清單</h3><p class="muted small">貼上分享連結或匯出代碼。</p>
      <textarea id="imp" rows="4"></textarea>
      <div class="row" style="margin-top:10px"><button class="pri" id="impgo">匯入</button><span class="sp"></span><button data-close>取消</button></div>`, d => {
      $('#impgo', d).onclick = () => {
        let v = $('#imp', d).value.trim();
        const m = v.match(/#\/import\/(.+)$/); if (m) v = m[1];
        if (doImport(v)) { d.close(); route(); }
      };
    });
  };
  function doImport(code) {
    try {
      const o = b64dec(decodeURIComponent(code));
      const items = (o.i || []).filter(x => D().items.has(x[0])).map(x => ({ id: x[0], qty: Math.max(1, num(x[1], 1)) }));
      if (!items.length) throw new Error('empty');
      const l = newList((o.n || '匯入的清單') + '（匯入）');
      l.items = items; l.pick = o.p || {}; l.buy = o.b || {};
      Store.d.lists.push(l); Store.d.cur = l.id; Store.save(); updateBadge();
      toast('已匯入清單「' + l.name + '」');
      return true;
    } catch (e) { toast('匯入失敗：內容無法辨識'); return false; }
  }

  function renderList() {
    const l = Store.list;
    const rows = l.items.map((x, i) => {
      const it = D().items.get(x.id);
      const prods = D().recipesByResult.get(x.id) || [];
      const fc = D().fcByResult.get(x.id);
      const sel = prods.length > 1
        ? `<select data-in="lpick" data-id="${x.id}">${prods.map(r => `<option value="${r.id}" ${(l.pick[x.id] || prods[0].id) === r.id ? 'selected' : ''}>${esc(D().jobs[r.job])} Lv${r.level}${(r.flags & 4) ? '（需專家）' : ''}</option>`).join('')}</select>`
        : (prods[0] ? jobTag(prods[0]) : fc ? '<span class="tag fc">🏠 部隊工房</span>' : '<span class="tag">素材</span>');
      const rid = (l.pick[x.id] || (prods[0] && prods[0].id)) || 0;
      return `<tr>
        <td style="width:46px">${icon(it, 's')}</td>
        <td><b>${esc(it.name)}</b></td>
        <td>${sel}</td>
        <td class="num"><input type="number" min="1" value="${x.qty}" data-in="lqty" data-idx="${i}"></td>
        <td class="num" style="white-space:nowrap">${rid ? `<a href="#/macro/${rid}"><button class="sm">巨集</button></a> ` : ''}<button class="sm danger" data-act="lrm" data-idx="${i}">移除</button></td>
      </tr>`;
    }).join('');
    view.innerHTML = `
      <div class="panel"><h2>製作清單</h2>${listSelector()}</div>
      <div class="panel">
        ${l.items.length ? `<table><thead><tr><th></th><th>物品</th><th>製作方式</th><th class="num">數量</th><th></th></tr></thead><tbody>${rows}</tbody></table>
          <div class="row" style="margin-top:12px"><a href="#/materials"><button class="pri">前往素材準備 →</button></a>
          <button data-act="lclear" class="danger">清空清單</button></div>`
        : '<div class="empty">清單是空的。<br><a href="#/search">去搜尋物品</a>，或到<a href="#/sub">潛水艇組件</a>直接加入整套零件。</div>'}
      </div>`;
  }
  inputs.lqty = el => { const x = Store.list.items[num(el.dataset.idx)]; if (x) { x.qty = Math.max(1, Math.floor(num(el.value, 1))); Store.save(); } };
  inputs.lpick = el => { Store.list.pick[num(el.dataset.id)] = num(el.value); Store.save(); toast('已切換製作方式'); };
  actions.lrm = b => { Store.list.items.splice(num(b.dataset.idx), 1); Store.save(); updateBadge(); renderList(); };
  actions.lclear = () => { if (confirm('清空目前清單？')) { Store.list.items = []; Store.save(); updateBadge(); renderList(); } };

  // ============================================================ 素材準備
  const MT = { hideDone: false };
  function renderMaterials() {
    const l = Store.list;
    const res = FF.computeMaterials(l);
    MT.res = res;
    if (!l.items.length) {
      view.innerHTML = `<div class="panel"><h2>素材準備</h2>${listSelector()}</div><div class="panel"><div class="empty">清單是空的，先<a href="#/search">搜尋物品</a>加入清單。</div></div>`;
      return;
    }
    const craftsN = res.crafts.reduce((s, n) => s + n.crafts, 0);
    const rawNeed = res.raw.filter(n => n.net > 0);
    const rawHtml = [];
    let cur = '';
    for (const n of res.raw) {
      if (MT.hideDone && (l.done[n.id] || n.net <= 0)) continue;
      if (n.source !== cur) {
        cur = n.source;
        rawHtml.push(`<tr><td colspan="6" style="background:var(--panel2)"><b>${esc(FF.SOURCE_LABEL[cur])}</b></td></tr>`);
      }
      const canCraft = D().recipesByResult.has(n.id) || D().fcByResult.has(n.id);
      rawHtml.push(`<tr class="${l.done[n.id] || n.net <= 0 ? 'done' : ''}">
        <td><input type="checkbox" data-in="done" data-id="${n.id}" ${l.done[n.id] ? 'checked' : ''} title="已備齊"></td>
        <td><div class="row" style="flex-wrap:nowrap">${icon(n.item, 's')}<span>${esc(n.item.name)}${n.item.flags & FF.FLAG.HQ ? ' <span class="muted small">可HQ</span>' : ''}</span></div></td>
        <td class="num">${fmt(n.required)}</td>
        <td class="num"><input type="number" min="0" value="${l.stock[n.id] || 0}" data-in="stock" data-id="${n.id}" title="持有數量"></td>
        <td class="num"><b>${fmt(n.net)}</b></td>
        <td class="small muted">${n.source === 'shop' && n.item.price ? fmt(n.item.price * n.net) + ' Gil' : ''}${canCraft ? ` <button class="sm" data-act="unbuy" data-id="${n.id}">改為自製</button>` : ''}</td>
      </tr>`);
    }
    const craftHtml = res.crafts.map((n, i) => {
      const p = n.producer;
      const tag = p.type === 'recipe' ? jobTag(p.rec) : '<span class="tag fc">🏠 部隊工房</span>';
      const prods = D().recipesByResult.get(n.id) || [];
      const sel = (p.type === 'recipe' && prods.length > 1)
        ? `<select data-in="pick" data-id="${n.id}">${prods.map(r => `<option value="${r.id}" ${r.id === p.rec.id ? 'selected' : ''}>${esc(D().jobs[r.job])} Lv${r.level}</option>`).join('')}</select>` : '';
      const done = !!l.done['c' + n.id];
      if (MT.hideDone && (done || n.net <= 0)) return '';
      const rid = p.type === 'recipe' ? p.rec.id : 0;
      return `<tr class="${done || n.net <= 0 ? 'done' : ''}">
        <td><input type="checkbox" data-in="done" data-id="c${n.id}" ${done ? 'checked' : ''} title="已完成"></td>
        <td class="num">${i + 1}</td>
        <td><div class="row" style="flex-wrap:nowrap">${icon(n.item, 's')}<span><b>${esc(n.item.name)}</b> ×${fmt(n.net)}${n.surplus ? ` <span class="muted small">（多出 ${n.surplus}）</span>` : ''}</span></div></td>
        <td>${tag} ${sel}</td>
        <td class="num">${n.crafts ? fmt(n.crafts) + ' 次' : '—'}</td>
        <td class="small muted">${p.type === 'fc' ? '<a href="#/sub" class="small">查看工房階段</a>' : esc(ingText(p.ings.map(([id, a]) => [id, a * n.crafts]), 6))}</td>
        <td style="white-space:nowrap">${rid ? `<a href="#/macro/${rid}"><button class="sm">巨集</button></a> ` : ''}<button class="sm" data-act="buy" data-id="${n.id}" title="不自製，改成直接取得">改為購買</button></td>
      </tr>`;
    }).join('');

    view.innerHTML = `
      <div class="panel"><h2>素材準備</h2>${listSelector()}
        <div class="kvs">
          <div class="kv"><b>${l.items.length}</b><span>清單物品</span></div>
          <div class="kv"><b>${fmt(craftsN)}</b><span>製作次數</span></div>
          <div class="kv"><b>${rawNeed.length}</b><span>尚缺素材種類</span></div>
          <div class="kv"><b>${fmt(res.gil)}</b><span>商店購買預估 Gil</span></div>
        </div>
        <div class="row noprint">
          <label class="row" style="gap:6px"><input type="checkbox" data-in="hide" ${MT.hideDone ? 'checked' : ''}> 隱藏已完成／已備齊</label>
          <span class="sp"></span>
          <button data-act="cpmat">複製素材清單</button>
          <button data-act="cpcraft">複製製作順序</button>
          <button data-act="print">列印</button>
          <button data-act="resetchk" class="danger">重設勾選與庫存</button>
        </div>
      </div>
      <div class="panel">
        <h3>① 需要準備的素材</h3>
        <div style="overflow:auto"><table><thead><tr><th style="width:40px"></th><th>素材</th><th class="num">需求</th><th class="num">持有</th><th class="num">還需</th><th></th></tr></thead>
        <tbody>${rawHtml.join('') || '<tr><td colspan="6" class="muted">（不需要額外素材）</td></tr>'}</tbody></table></div>
        <p class="muted small">「持有」欄可填入背包／雇員／部隊箱的數量，系統會自動扣除並重新計算上層需求。素材來源標記只涵蓋「採集／釣魚／商店」，其餘歸為「其他」。</p>
      </div>
      <div class="panel">
        <h3>② 製作順序（由下而上）</h3>
        <div style="overflow:auto"><table><thead><tr><th style="width:40px"></th><th class="num" style="width:40px">#</th><th>成品</th><th>職業</th><th class="num">次數</th><th>使用素材</th><th></th></tr></thead>
        <tbody>${craftHtml || '<tr><td colspan="7" class="muted">（沒有需要製作的項目）</td></tr>'}</tbody></table></div>
      </div>`;
  }
  inputs.done = el => { Store.list.done[el.dataset.id] = el.checked; if (!el.checked) delete Store.list.done[el.dataset.id]; Store.save(); renderMaterials(); };
  inputs.stock = el => { const v = Math.max(0, Math.floor(num(el.value))); if (v) Store.list.stock[el.dataset.id] = v; else delete Store.list.stock[el.dataset.id]; Store.save(); renderMaterials(); };
  inputs.hide = el => { MT.hideDone = el.checked; renderMaterials(); };
  inputs.pick = el => { Store.list.pick[num(el.dataset.id)] = num(el.value); Store.save(); renderMaterials(); };
  actions.buy = b => { Store.list.buy[b.dataset.id] = true; Store.save(); renderMaterials(); };
  actions.unbuy = b => { delete Store.list.buy[b.dataset.id]; Store.save(); renderMaterials(); };
  actions.cpmat = () => copy(FF.materialsText(MT.res), '已複製素材清單');
  actions.cpcraft = () => copy(FF.craftsText(MT.res), '已複製製作順序');
  actions.print = () => window.print();
  actions.resetchk = () => { if (confirm('清除目前清單的勾選與庫存？')) { const l = Store.list; l.done = {}; l.stock = {}; Store.save(); renderMaterials(); } };

  // ============================================================ 巨集計算
  const M = { rid: 0, seq: [], worker: null, running: false, hq: {}, target: 'max', targetNum: 0, effort: 'normal' };
  const BUFF_LABEL = { ven: '崇敬', inn: '改革', gs: '闊步', wn: '儉約', man: '掌握', fa: '最終確認', mm: '堅信' };
  const defaultStats = () => ({ level: 100, cs: 5000, ctl: 4800, cp: 600, spec: false });
  const jobStats = job => Object.assign(defaultStats(), Store.d.stats[job] || {});

  function stopWorker() {
    if (M.worker) { M.worker.terminate(); M.worker = null; }
    M.running = false;
  }

  function renderMacro(args) {
    const rid = num(args && args[0]);
    M.rid = D().recipes.has(rid) ? rid : 0;
    const l = Store.list;
    const fromList = l.items.map(x => {
      const prods = D().recipesByResult.get(x.id);
      if (!prods) return null;
      const r = (l.pick[x.id] && D().recipes.get(l.pick[x.id])) || prods[0];
      return r;
    }).filter(Boolean);
    let html = `<div class="panel"><h2>巨集計算</h2>
      <div class="pick-dd"><input id="mq" data-live="mq" type="search" style="width:100%" placeholder="搜尋要製作的物品（輸入名稱）" autocomplete="off"><div class="dd hidden" id="mdd"></div></div>
      ${fromList.length ? `<div class="row small" style="margin-top:8px"><span class="muted">從清單選擇：</span>${fromList.map(r => `<a href="#/macro/${r.id}"><button class="sm ${r.id === M.rid ? 'pri' : ''}">${esc(FF.itemName(r.result))}</button></a>`).join('')}</div>` : ''}
    </div>`;
    if (!M.rid) {
      html += '<div class="panel"><div class="empty">請先選擇一個配方。計算會依你的等級、製作力、加工精度與 CP 求出一組可直接貼進遊戲的巨集。</div></div>';
      view.innerHTML = html;
      return;
    }
    const rec = D().recipes.get(M.rid);
    const rp = FFSim.recipeParams(rec.row, D().rlt[rec.rltId]);
    M.rp = rp; M.rec = rec;
    const st = jobStats(rec.job);
    M.seq = M.seqRid === M.rid ? M.seq : [];
    M.seqRid = M.rid;
    M.hq = M.hqRid === M.rid ? M.hq : {};
    M.hqRid = M.rid;
    const item = D().items.get(rec.result);
    const hqIngs = rec.ings.filter(([id]) => (D().items.get(id).flags & FF.FLAG.HQ) && id > 19);
    html += `
      <div class="panel">
        <div class="row" style="flex-wrap:nowrap">${icon(item)}<div><h3 style="margin:0">${esc(item.name)} ×${rec.amount}</h3>
          <div>${jobTag(rec)} <span class="tag">配方 #${rec.id}</span>${rp.expert ? '<span class="tag" style="color:var(--bad)">高難度配方</span>' : ''}${rec.flags & 4 ? '<span class="tag">需專家</span>' : ''}</div></div>
          <span class="sp"></span><button data-act="maddlist" class="pri">＋加入清單</button></div>
        <div class="kvs">
          <div class="kv"><b>${fmt(rp.difficulty)}</b><span>難度（進度）</span></div>
          <div class="kv"><b>${rp.quality ? fmt(rp.quality) : '—'}</b><span>最大品質</span></div>
          <div class="kv"><b>${rp.durability}</b><span>耐久</span></div>
          <div class="kv"><b>${fmt(rp.suggestedCs)}</b><span>建議製作力</span></div>
          ${rp.reqCs ? `<div class="kv"><b>${fmt(rp.reqCs)}</b><span>需求製作力</span></div>` : ''}
          ${rp.reqCtl ? `<div class="kv"><b>${fmt(rp.reqCtl)}</b><span>需求加工精度</span></div>` : ''}
        </div>
        ${rp.expert ? '<div class="warnbox">高難度配方的製作狀態會隨機變化，本工具的求解器只模擬「通常」狀態，結果僅供參考。</div>' : ''}
      </div>
      <div class="panel">
        <h3>你的屬性（${esc(D().jobs[rec.job])}）</h3>
        <div class="row">
          <label>等級 <input type="number" id="pl" min="1" max="100" value="${st.level}" data-in="mstat"></label>
          <label>製作力 <input type="number" id="pcs" min="0" value="${st.cs}" data-in="mstat"></label>
          <label>加工精度 <input type="number" id="pctl" min="0" value="${st.ctl}" data-in="mstat"></label>
          <label>CP <input type="number" id="pcp" min="0" value="${st.cp}" data-in="mstat"></label>
          <label class="row" style="gap:6px"><input type="checkbox" id="pspec" data-in="mstat" ${st.spec ? 'checked' : ''}> 專家</label>
        </div>
        <p class="muted small">請填入「含食物／藥水加成後」的數值。${rp.suggestedCs && st.cs < rp.suggestedCs ? '<span class="warn">目前製作力低於建議值，進度可能偏低。</span>' : ''}</p>
        ${hqIngs.length && rp.quality ? `<h3>HQ 素材（初始品質）</h3>
          <div class="row">${hqIngs.map(([id, n]) => `<label class="row small" style="gap:6px">${esc(FF.itemName(id))}
            <input type="number" min="0" max="${n}" value="${M.hq[id] || 0}" data-in="mhq" data-id="${id}" style="width:64px"> / ${n}</label>`).join('')}</div>
          <div class="muted small" id="initq"></div>` : ''}
        <div class="row" style="margin-top:12px">
          <label>目標品質
            <select id="mtarget" data-in="mtarget">
              <option value="max" ${M.target === 'max' ? 'selected' : ''}>100%（HQ 必成）</option>
              <option value="none" ${M.target === 'none' ? 'selected' : ''}>只求完成（不管品質）</option>
              <option value="custom" ${M.target === 'custom' ? 'selected' : ''}>自訂（收藏價值等）</option>
            </select></label>
          <input type="number" id="mtnum" min="0" value="${M.targetNum || ''}" placeholder="品質數值" class="${M.target === 'custom' ? '' : 'hidden'}">
          <label>搜尋強度
            <select id="meffort" data-in="meffort">
              <option value="fast" ${M.effort === 'fast' ? 'selected' : ''}>快速（約 10 秒）</option>
              <option value="normal" ${M.effort === 'normal' ? 'selected' : ''}>標準（約 30 秒）</option>
              <option value="deep" ${M.effort === 'deep' ? 'selected' : ''}>精細（約 90 秒）</option>
            </select></label>
          <span class="sp"></span>
          <button class="pri" id="msolve" data-act="msolve">求解巨集</button>
          <button id="mstop" data-act="mstop" class="hidden">停止</button>
        </div>
        <div id="mprog" class="muted small" style="margin-top:8px"></div>
      </div>
      <div id="mout"></div>`;
    view.innerHTML = html;
    updateInitQ();
    updateMacroOut();
  }
  // 搜尋下拉
  inputs.mq = el => {
    const q = el.value.trim();
    const dd = $('#mdd');
    if (!q) { dd.classList.add('hidden'); return; }
    const res = FF.search(q, {}).filter(e => e.recipes.length).slice(0, 10);
    dd.innerHTML = res.length ? res.map(e => `<div class="item" data-act="mpickrec" data-rid="${e.recipes[0].id}">${icon(e.item, 's')}<div class="body"><b>${esc(e.item.name)}</b> <span class="muted small">${e.recipes.map(r => esc(D().jobs[r.job]) + ' Lv' + r.level).join(' / ')}</span></div></div>`).join('') : '<div class="item muted">沒有結果</div>';
    dd.classList.remove('hidden');
  };
  actions.mpickrec = b => { location.hash = '#/macro/' + b.dataset.rid; };
  actions.maddlist = () => { addToList(M.rec.result, 1, M.rec.id); toast('已加入清單'); };

  function readPlayer() {
    return {
      level: Math.max(1, Math.min(100, Math.floor(num($('#pl').value, 100)))),
      craftsmanship: Math.max(0, Math.floor(num($('#pcs').value))),
      control: Math.max(0, Math.floor(num($('#pctl').value))),
      cp: Math.max(0, Math.floor(num($('#pcp').value))),
      specialist: $('#pspec').checked,
    };
  }
  function hqInitial() {
    const rec = M.rec;
    const ings = rec.ings.map(([id, n]) => {
      const it = D().items.get(id);
      return { ilvl: it.ilvl, amount: n, hq: M.hq[id] || 0, canHq: !!(it.flags & FF.FLAG.HQ) && id > 19 };
    });
    return FFSim.initialQuality(M.rp, ings);
  }
  function updateInitQ() {
    const el = $('#initq'); if (!el) return;
    el.textContent = '初始品質：' + fmt(hqInitial()) + '（僅為估算）';
  }
  function curCtx() {
    const p = readPlayer();
    p.initialQuality = M.rp.quality ? hqInitial() : 0;
    return { player: p, ctx: FFSim.makeCtx(p, M.rp) };
  }
  inputs.mstat = () => {
    Store.d.stats[M.rec.job] = { level: num($('#pl').value, 100), cs: num($('#pcs').value), ctl: num($('#pctl').value), cp: num($('#pcp').value), spec: $('#pspec').checked };
    Store.save(); updateMacroOut();
  };
  inputs.mhq = el => { M.hq[el.dataset.id] = Math.max(0, Math.floor(num(el.value))); updateInitQ(); updateMacroOut(); };
  inputs.mtarget = el => { M.target = el.value; $('#mtnum').classList.toggle('hidden', el.value !== 'custom'); };
  inputs.meffort = el => { M.effort = el.value; };
  const EFFORT = { fast: { t: 10000, r: 2 }, normal: { t: 30000, r: 3 }, deep: { t: 90000, r: 5 } };

  function targetValue(ctx) {
    if (M.target === 'none') return 0;
    if (M.target === 'custom') return Math.min(ctx.maxQ, Math.max(0, num($('#mtnum').value)));
    return ctx.maxQ;
  }

  actions.msolve = () => {
    if (M.running) return;
    const { player, ctx } = curCtx();
    if (player.craftsmanship < 1) { toast('請輸入製作力'); return; }
    const target = targetValue(ctx);
    const ef = EFFORT[M.effort];
    M.running = true;
    $('#msolve').disabled = true; $('#mstop').classList.remove('hidden');
    const t0 = Date.now();
    const prog = $('#mprog');
    prog.textContent = '計算中…';
    const timer = setInterval(() => { if (M.running) prog.textContent = '計算中…已 ' + Math.round((Date.now() - t0) / 1000) + ' 秒（上限約 ' + Math.round(ef.t / 1000) + ' 秒）'; }, 500);
    const finish = (keys, ok, reached) => {
      clearInterval(timer);
      M.running = false; M.worker = null;
      const b = $('#msolve'); if (!b) return;
      b.disabled = false; $('#mstop').classList.add('hidden');
      if (!ok) { prog.innerHTML = '<span class="bad">在目前屬性下找不到能完成製作的流程（進度不足或耐久／CP 不夠）。請提高製作力或 CP，或使用食物／藥水。</span>'; return; }
      M.seq = keys; M.seqRid = M.rid;
      prog.innerHTML = reached ? '<span class="ok">已找到可達成目標品質的流程。</span>' : '<span class="warn">已找到可完成製作的流程，但無法達到目標品質（已盡力提高品質）。</span>';
      updateMacroOut();
    };
    const msg = { type: 'solve', player, recipe: M.rp, target, timeLimitMs: ef.t, rounds: ef.r };
    try {
      const w = new Worker('js/solver.worker.js');
      M.worker = w;
      w.onmessage = e => {
        if (e.data.type === 'done') finish(e.data.keys, e.data.finished, e.data.reachedTarget);
        else if (e.data.type === 'error') { clearInterval(timer); M.running = false; prog.innerHTML = '<span class="bad">求解失敗：' + esc(e.data.message) + '</span>'; $('#msolve').disabled = false; $('#mstop').classList.add('hidden'); }
      };
      w.onerror = () => { w.terminate(); M.worker = null; runInline(); };
      w.postMessage(msg);
    } catch (e) { runInline(); }
    function runInline() {
      // 無法使用 Worker（例如以 file:// 開啟）時，在主執行緒計算
      setTimeout(() => {
        const r = FFSim.solveBest(ctx, { target, timeLimitMs: Math.min(ef.t, 20000), rounds: 2 });
        finish(r.keys, r.finished, r.reachedTarget);
      }, 30);
    }
  };
  actions.mstop = () => {
    stopWorker();
    const b = $('#msolve'); if (b) b.disabled = false;
    $('#mstop').classList.add('hidden'); $('#mprog').textContent = '已停止。';
  };

  actions.addact = b => { M.seq.push(b.dataset.key); updateMacroOut(); };
  actions.delact = b => { M.seq.splice(num(b.dataset.idx), 1); updateMacroOut(); };
  actions.clrseq = () => { M.seq = []; updateMacroOut(); };
  actions.undoact = () => { M.seq.pop(); updateMacroOut(); };
  actions.cpmacro = b => copy(b.dataset.text || $('#' + b.dataset.target).textContent, '已複製巨集');
  actions.cpall = () => copy(FFSim.buildMacros(M.seq, D().actionNames).map(m => m.text).join('\n\n'), '已複製全部巨集');
  actions.impmacro = () => {
    const r = FFSim.parseMacro($('#mimp').value, D().actionNames);
    if (!r.keys.length) { toast('沒有辨識到任何技能'); return; }
    M.seq = r.keys; updateMacroOut();
    toast('已匯入 ' + r.keys.length + ' 個技能' + (r.unknown.length ? '；未識別：' + r.unknown.slice(0, 3).join('、') : ''));
  };

  function updateMacroOut() {
    const out = $('#mout'); if (!out || !M.rec) return;
    const { ctx } = curCtx();
    const names = D().actionNames;
    const sim = FFSim.simulate(ctx, M.seq);
    const s = sim.final;
    const A = FFSim.ACTIONS;
    // 技能面板
    const groups = [['p', '作業'], ['q', '加工'], ['b', '增益'], ['r', '修理／其他']];
    const grp = k => { const t = A[k].t; return t === 'pq' ? 'q' : (t === 'o' ? 'r' : t); };
    const pal = groups.map(([g, label]) => `<div style="margin-bottom:6px"><span class="muted small">${label}</span><div class="chips">${FFSim.ACTION_KEYS.filter(k => grp(k) === g).map(k => {
      const dis = ctx.level < A[k].lvl || (A[k].spec && !ctx.specialist);
      return `<button class="chip pal ${g}" data-act="addact" data-key="${k}" ${dis ? 'disabled' : ''} title="Lv${A[k].lvl}">${esc(names[k] || k)}<span class="n">${A[k].cp ? A[k].cp + 'CP' : ''}</span></button>`;
    }).join('')}</div></div>`).join('');
    const seqChips = M.seq.map((k, i) => `<span class="chip" data-act="delact" data-idx="${i}" title="點擊移除">${i + 1}. ${esc(names[k] || k)}</span>`).join('');
    let statusHtml;
    if (!M.seq.length) statusHtml = '<span class="muted">尚未有流程。可按「求解巨集」，或手動點選下方技能／貼上巨集。</span>';
    else if (sim.status === 1) statusHtml = '<span class="ok">✔ 製作完成</span>';
    else if (sim.status === 2) statusHtml = '<span class="bad">✘ 耐久歸零，製作失敗</span>';
    else statusHtml = '<span class="warn">進度尚未完成</span>';
    const qPct = ctx.maxQ ? Math.min(100, s.q / ctx.maxQ * 100) : 0;
    const secs = M.seq.reduce((t, k) => t + FFSim.actionWait(k), 0);
    const macros = M.seq.length ? FFSim.buildMacros(M.seq, names) : [];
    const rows = sim.steps.map((st, i) => {
      const x = st.s;
      const bf = Object.keys(BUFF_LABEL).filter(k => x[k] > 0).map(k => BUFF_LABEL[k] + x[k]).join(' ');
      return `<tr><td class="num">${i + 1}</td><td>${esc(names[st.key] || st.key)}</td><td class="num">${fmt(Math.min(x.p, ctx.diff))}</td><td class="num">${fmt(x.q)}</td><td class="num">${x.d}</td><td class="num">${x.cp}</td><td class="num">${x.iq}</td><td class="small muted">${bf}</td></tr>`;
    }).join('');
    out.innerHTML = `
      <div class="panel">
        <h3>結果</h3>
        <div class="row">${statusHtml}</div>
        <div class="kvs">
          <div class="kv"><b>${fmt(Math.min(s.p, ctx.diff))} / ${fmt(ctx.diff)}</b><span>進度</span></div>
          <div class="kv"><b>${fmt(s.q)}${ctx.maxQ ? ' / ' + fmt(ctx.maxQ) : ''}</b><span>品質${ctx.maxQ ? '（' + qPct.toFixed(1) + '%）' : ''}</span></div>
          <div class="kv"><b>${Math.max(0, s.d)} / ${ctx.maxD}</b><span>耐久</span></div>
          <div class="kv"><b>${s.cp} / ${ctx.maxCp}</b><span>剩餘 CP</span></div>
          <div class="kv"><b>${M.seq.length}</b><span>步驟</span></div>
          <div class="kv"><b>${secs} 秒</b><span>巨集時間</span></div>
        </div>
        ${sim.error && M.seq.length ? `<div class="warnbox">第 ${sim.error.index + 1} 步「${esc(names[sim.error.key] || sim.error.key)}」：${esc(sim.error.reason)}（後續步驟已略過）</div>` : ''}
        <div class="chips" style="margin:10px 0">${seqChips}</div>
        <div class="row small"><button data-act="undoact" class="sm" ${M.seq.length ? '' : 'disabled'}>↶ 刪除最後一步</button><button data-act="clrseq" class="sm danger" ${M.seq.length ? '' : 'disabled'}>清空</button></div>
      </div>
      ${macros.length ? `<div class="panel"><h3>遊戲巨集（共 ${macros.length} 個）</h3>
        <div class="muted small">每個巨集最多 15 行（含最後一行提示）。依序按下每個巨集，每個按鈕等上一個巨集的提示出現後再按。</div>
        ${macros.map((m, i) => `<div class="row"><b>巨集 ${i + 1}</b><span class="muted small">${m.seconds} 秒</span><span class="sp"></span><button class="sm" data-act="cpmacro" data-target="mac${i}">複製</button></div><pre class="macro" id="mac${i}">${esc(m.text)}</pre>`).join('')}
        <button data-act="cpall">複製全部</button></div>` : ''}
      <div class="panel">
        <h3>手動編輯／模擬</h3>
        ${pal}
        <details style="margin-top:8px"><summary>貼上現有巨集進行模擬</summary>
          <textarea id="mimp" rows="6" placeholder='/ac "製作" <wait.3>'></textarea>
          <button data-act="impmacro" style="margin-top:6px">匯入並模擬</button></details>
        ${rows ? `<div style="overflow:auto;margin-top:10px"><table><thead><tr><th class="num">#</th><th>技能</th><th class="num">進度</th><th class="num">品質</th><th class="num">耐久</th><th class="num">CP</th><th class="num">內靜</th><th>增益</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
        <p class="muted small" style="margin-top:10px">模擬假設製作狀態恆為「通常」。公式依社群公開資料實作，實際數值與遊戲可能相差 1 左右；正式使用前建議先在遊戲內核對一次。</p>
      </div>`;
  }

  // ============================================================ 潛水艇
  const SUB = { sel: {}, count: 1, rank: 1 };
  const SLOT_ORDER = ['潛水艇組件（船體）', '潛水艇組件（船尾）', '潛水艇組件（船首）', '潛水艇組件（艦橋）'];
  function subIndex() {
    if (D().subIdx) return D().subIdx;
    const slots = {};
    for (const [id, v] of D().subItems) {
      const it = D().items.get(id);
      if (!it || !D().fcByResult.has(id)) continue;
      (slots[v.cat] = slots[v.cat] || []).push({ id, name: it.name, part: v.part, cls: it.name.slice(0, -2) });
    }
    for (const k of Object.keys(slots)) slots[k].sort((a, b) => a.part - b.part);
    const classes = [];
    for (const e of (slots[SLOT_ORDER[0]] || [])) classes.push(e.cls);
    D().subIdx = { slots, classes };
    return D().subIdx;
  }
  function renderSub() {
    const { slots, classes } = subIndex();
    if (!classes.length) { view.innerHTML = '<div class="panel"><div class="empty">資料中沒有潛水艇組件。</div></div>'; return; }
    for (const cat of SLOT_ORDER) if (!SUB.sel[cat] || !(slots[cat] || []).some(e => e.id === SUB.sel[cat])) SUB.sel[cat] = (slots[cat] || [])[0] && slots[cat][0].id;
    view.innerHTML = `
      <div class="panel">
        <h2>潛水艇組件製作</h2>
        <p class="muted small">選好四個部位的組件，即可看到總能力、公司工房各階段需要的物品，並一鍵加入製作清單（連同所有中間素材一併計算）。</p>
        <div class="row" style="margin-bottom:10px"><span class="muted small">快速套用整套：</span>${classes.map(c => `<button class="sm" data-act="subpreset" data-cls="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <div class="slotpick">${SLOT_ORDER.map(cat => `<label>${esc(cat.replace('潛水艇組件（', '').replace('）', ''))}
          <select data-in="subsel" data-cat="${esc(cat)}">${(slots[cat] || []).map(e => `<option value="${e.id}" ${SUB.sel[cat] === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>`).join('')}</div>
        <div class="row" style="margin-top:12px">
          <label>潛水艇數量 <input type="number" min="1" max="99" value="${SUB.count}" data-in="subcount"></label>
          <label>潛水艇等級（加上等級加成） <input type="number" min="1" max="${Math.max(1, D().subRanks.length - 1)}" value="${SUB.rank}" data-in="subrank"></label>
          <span class="sp"></span>
          <button class="pri" data-act="subadd">＋全套加入清單</button>
          <button data-act="subaddgo">加入並前往素材準備 →</button>
        </div>
      </div>
      <div id="subout"></div>`;
    updateSub();
  }
  inputs.subsel = el => { SUB.sel[el.dataset.cat] = num(el.value); updateSub(); };
  inputs.subcount = el => { SUB.count = Math.max(1, Math.floor(num(el.value, 1))); updateSub(); };
  inputs.subrank = el => { SUB.rank = Math.max(1, Math.floor(num(el.value, 1))); updateSub(); };
  actions.subpreset = b => {
    const { slots } = subIndex();
    for (const cat of SLOT_ORDER) { const e = (slots[cat] || []).find(x => x.cls === b.dataset.cls); if (e) SUB.sel[cat] = e.id; }
    renderSub();
  };
  const subIds = () => SLOT_ORDER.map(c => SUB.sel[c]).filter(Boolean);
  actions.subadd = () => { for (const id of subIds()) addToList(id, SUB.count); toast('已加入 ' + subIds().length + ' 個組件 ×' + SUB.count); };
  actions.subaddgo = () => { actions.subadd(); location.hash = '#/materials'; };

  function updateSub() {
    const ids = subIds();
    const parts = ids.map(id => D().subParts.get(D().subItems.get(id).part));
    const sum = k => parts.reduce((t, p) => t + (p ? p[k] : 0), 0);
    const rk = D().subRanks[Math.min(SUB.rank, D().subRanks.length - 1)] || [0, 0, 0, 0, 0, 0, 0];
    const stat = [['surv', '偵察 Surveillance', 2], ['ret', '獲得 Retrieval', 3], ['speed', '速度 Speed', 4], ['range', '航程 Range', 5], ['favor', '好感 Favor', 6]];
    const rows = stat.map(([k, label, bi]) => `<tr><td>${esc(label)}</td><td class="num">${sum(k)}</td><td class="num">+${rk[bi]}</td><td class="num"><b>${sum(k) + rk[bi]}</b></td></tr>`).join('');
    const maxRank = Math.max(0, ...parts.map(p => (p ? p.rank : 0)));
    const mat = FF.computeMaterials({ items: ids.map(id => ({ id, qty: SUB.count })), stock: {}, buy: {}, pick: {} });
    const grouped = {};
    for (const n of mat.raw) (grouped[n.source] = grouped[n.source] || []).push(n);
    const phases = ids.map(id => {
      const seq = D().fcByResult.get(id); const it = D().items.get(id);
      return `<details><summary><b>${esc(it.name)}</b> <span class="muted small">需求等級 ${(D().subParts.get(D().subItems.get(id).part) || {}).rank || '-'}</span></summary>
        ${seq.parts.map((p, pi) => p.procs.map((proc, qi) => `<div class="phase"><h4>${esc(p.type || '零件')} ${seq.parts.length > 1 ? (pi + 1) + '-' : ''}階段 ${qi + 1}</h4>
          <div class="chips">${proc.map(([iid, q, sets]) => `<span class="chip pal" style="cursor:default">${icon(D().items.get(iid), 's')}${esc(FF.itemName(iid))} <b>×${q * sets}</b><span class="n">（${q}×${sets}組）</span></span>`).join('')}</div></div>`).join('')).join('')}
      </details>`;
    }).join('');
    $('#subout').innerHTML = `
      <div class="grid2">
        <div class="panel"><h3>總能力</h3>
          <table><thead><tr><th>能力</th><th class="num">組件合計</th><th class="num">等級加成</th><th class="num">總計</th></tr></thead><tbody>${rows}</tbody></table>
          <p class="muted small">組件要求的潛水艇等級最高為 Rank ${maxRank}。</p></div>
        <div class="panel"><h3>全部素材總覽（${SUB.count} 艘）</h3>
          ${['crystal', 'gather', 'fish', 'shop', 'other'].filter(s => grouped[s]).map(s => `<div style="margin-bottom:6px">${srcTag(s)}<div class="chips" style="margin-top:4px">${grouped[s].map(n => `<span class="chip" style="cursor:default">${esc(n.item.name)} ×${fmt(n.net)}</span>`).join('')}</div></div>`).join('')}
          <p class="muted small">商店購買預估：${fmt(mat.gil)} Gil；需製作的中間素材 ${mat.crafts.length - ids.length} 種。可到「素材準備」扣除庫存並取得製作順序。</p></div>
      </div>
      <div class="panel"><h3>工房製作階段（單件）</h3>
        <p class="muted small">公司工房每個階段需要放入的物品；階段內每種物品為「每組數量 × 組數」。</p>${phases}</div>`;
  }

  // ============================================================ 啟動
  async function boot() {
    Store.load();
    try {
      await FF.loadData('data/');
    } catch (e) {
      view.innerHTML = '<div class="panel"><div class="empty bad">資料載入失敗：' + esc(e.message) + '<br>請透過 http(s) 開啟（例如 GitHub Pages），不要直接雙擊 index.html。</div></div>';
      return;
    }
    $('#dataVer').textContent = '資料更新：' + FF.D.meta.builtAt;
    updateBadge();
    window.addEventListener('hashchange', route);
    document.addEventListener('click', e => { if (!e.target.closest('.pick-dd')) { const d = $('#mdd'); if (d) d.classList.add('hidden'); } });
    route();
  }
  boot();
})();
