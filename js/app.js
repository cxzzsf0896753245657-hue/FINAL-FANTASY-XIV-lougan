/* FF14 製作規劃工具 — 介面 */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); };
  const fmt = n => Number(n).toLocaleString('en-US');
  const view = $('#view');
  const D = () => FF.D;

  // ============================================================ 儲存（localStorage）
  const KEY = 'ffxivcp.v1';
  const newId = () => 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
  const newList = name => ({ id: newId(), name: name || '清單 1', items: [], stock: {}, done: {}, buy: {}, pick: {} });
  const DEFAULT_STATS = { level: 100, cs: 4000, ctl: 4000, cp: 600, spec: false };
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
    stats(job) { return Object.assign({}, DEFAULT_STATS, this.d.stats[job] || {}); },
    setStats(job, st) { this.d.stats[job] = Object.assign(this.stats(job), st); this.save(); },
  };

  // ============================================================ 共用
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
  const img = (iconId, cls) => iconId
    ? '<img class="icon ' + (cls || '') + '" loading="lazy" referrerpolicy="no-referrer" src="' + FF.iconUrl(iconId) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
    : '<span class="icon ' + (cls || '') + '"></span>';
  const icon = (item, cls) => img(item && item.icon, cls);
  const stars = n => (n > 0 ? '<span class="star">' + '★'.repeat(n) + '</span>' : '');
  const jobTag = rec => '<span class="tag job">' + esc(D().jobs[rec.job]) + ' Lv' + rec.level + (rec.stars ? '&nbsp;' + stars(rec.stars) : '') + '</span>';
  const ingText = (ings, max) => {
    const arr = ings.slice(0, max || 99).map(([id, n]) => esc(FF.itemName(id)) + '×' + n);
    return arr.join('、') + (ings.length > (max || 99) ? '…' : '');
  };
  const srcTag = s => '<span class="tag src-' + s + '">' + esc(FF.SOURCE_LABEL[s].split('（')[0]) + '</span>';

  function updateBadge() { $('#listBadge').textContent = Store.list.items.length; }
  function addToList(id, qty, rid) {
    const l = Store.list;
    const ex = l.items.find(x => x.id === id);
    if (ex) ex.qty += qty; else l.items.push({ id, qty });
    if (rid) l.pick[id] = rid;
    Store.save(); updateBadge();
  }

  // ============================================================ 路由與事件
  const routes = {};
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
  const actions = {}, inputs = {};
  view.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && actions[b.dataset.act]) actions[b.dataset.act](b, e);
  });
  view.addEventListener('change', e => {
    const t = e.target.closest('[data-in]');
    if (t && inputs[t.dataset.in]) inputs[t.dataset.in](t, e);
  });
  view.addEventListener('input', e => {
    const t = e.target.closest('[data-live]');
    if (t && inputs[t.dataset.live]) inputs[t.dataset.live](t, e);
  });

  // ============================================================ 搜尋物品
  const S = { q: '', job: '', minLv: '', maxLv: '', cat: '', limit: 60 };
  routes.search = function () {
    if (!D().craftCats) {
      const set = new Set();
      for (const e of D().search) set.add(e.item.cat);
      D().craftCats = Array.from(set).filter(c => D().cats[c]).sort((a, b) => D().cats[a].localeCompare(D().cats[b], 'zh-Hant'));
    }
    view.innerHTML = `
      <div class="page-title">搜尋物品</div>
      <div class="row">
        <input id="sq" class="grow" data-live="sq" type="search" placeholder="輸入物品名稱（例如：雀翎、秘銀、藥水）" value="${esc(S.q)}" autocomplete="off">
      </div>
      <div class="row" style="margin:10px 0 4px">
        <label class="f">職業 <select id="sjob" data-in="sfilter">
          <option value="">全部</option>
          ${D().jobs.map((j, i) => `<option value="${i}" ${String(S.job) === String(i) ? 'selected' : ''}>${esc(j)}</option>`).join('')}
          <option value="fc" ${S.job === 'fc' ? 'selected' : ''}>部隊工房</option>
        </select></label>
        <label class="f">配方等級 <input id="smin" data-in="sfilter" type="number" min="1" max="100" placeholder="最低" value="${esc(S.minLv)}">
        – <input id="smax" data-in="sfilter" type="number" min="1" max="100" placeholder="最高" value="${esc(S.maxLv)}"></label>
        <label class="f">分類 <select id="scat" data-in="sfilter">
          <option value="">全部</option>
          ${D().craftCats.map(c => `<option value="${c}" ${String(S.cat) === String(c) ? 'selected' : ''}>${esc(D().cats[c])}</option>`).join('')}
        </select></label>
        <button data-act="sclear">清除</button>
        <span class="sp"></span><span class="muted small" id="scount"></span>
      </div>
      <div id="sres"></div>`;
    updateSearch();
    $('#sq').focus();
  };
  inputs.sq = el => { S.q = el.value; S.limit = 60; updateSearch(); };
  inputs.sfilter = () => {
    S.job = $('#sjob').value; S.minLv = $('#smin').value; S.maxLv = $('#smax').value; S.cat = $('#scat').value; S.limit = 60;
    updateSearch();
  };
  actions.sclear = () => { Object.assign(S, { q: '', job: '', minLv: '', maxLv: '', cat: '', limit: 60 }); routes.search(); };
  actions.smore = () => { S.limit += 60; updateSearch(); };
  function updateSearch() {
    const res = FF.search(S.q, { job: S.job, minLv: num(S.minLv), maxLv: num(S.maxLv), cat: S.cat });
    $('#scount').textContent = '共 ' + fmt(res.length) + ' 筆' + (res.length > S.limit ? '（顯示前 ' + S.limit + ' 筆）' : '');
    const box = $('#sres');
    if (!res.length) { box.innerHTML = '<div class="empty">找不到符合的可製作物品。</div>'; return; }
    box.innerHTML = res.slice(0, S.limit).map(e => {
      const it = e.item;
      const tags = e.recipes.map(jobTag).join('') + (e.fc ? '<span class="tag fc">部隊工房</span>' : '');
      const ings = e.fc ? e.fc.ings : (e.recipes[0] ? e.recipes[0].ings : []);
      const rid = e.recipes[0] ? e.recipes[0].id : 0;
      return `<div class="item">
        ${icon(it)}
        <div class="body">
          <div class="nm">${esc(it.name)} <span class="muted small">${it.ilvl ? '品級 ' + it.ilvl : ''}</span></div>
          <div class="meta">${tags}</div>
          <div class="meta">素材：${ingText(ings, 8)}</div>
        </div>
        <input type="number" min="1" value="1" class="qty xs" aria-label="數量">
        <button class="pri" data-act="sadd" data-id="${it.id}">加入清單</button>
        ${rid ? `<button data-act="go" data-href="#/macro/${rid}">巨集</button>` : ''}
      </div>`;
    }).join('') + (res.length > S.limit ? '<div style="text-align:center;margin-top:12px"><button data-act="smore">顯示更多</button></div>' : '');
  }
  actions.sadd = b => {
    const q = Math.max(1, Math.floor(num($('.qty', b.closest('.item')).value, 1)));
    addToList(Number(b.dataset.id), q);
    toast('已加入「' + FF.itemName(Number(b.dataset.id)) + '」×' + q);
  };
  actions.go = b => { location.hash = b.dataset.href; };

  // ============================================================ 快速套裝
  const ST = { role: '製作', job: '', min: '', max: '', q: '', qty: 1, limit: 12, off: new Set() };
  const ROLE_JOBS = {
    製作: ['CRP', 'BSM', 'ARM', 'GSM', 'LTW', 'WVR', 'ALC', 'CUL'],
    採集: ['MIN', 'BTN', 'FSH'],
  };
  function roleJobs(role) {
    if (ROLE_JOBS[role]) return ROLE_JOBS[role];
    const skip = new Set(ROLE_JOBS.製作.concat(ROLE_JOBS.採集, ['ADV']));
    return Object.keys(D().setJobs).filter(a => !skip.has(a));
  }
  const setItemOk = it => !ST.job || (D().cjc.get(it.cjc) || { jobs: [] }).jobs.includes(ST.job);
  routes.sets = function () {
    const jobs = roleJobs(ST.role);
    if (ST.job && !jobs.includes(ST.job)) ST.job = '';
    view.innerHTML = `
      <div class="page-title">快速套裝</div>
      <p class="muted small" style="margin-top:-6px">同等級、同系列名稱的可製作裝備會整理成一組，勾選要的部位後一次加入製作清單（素材準備會自動展開所有半成品與基礎素材）。</p>
      <div class="row" style="margin-bottom:14px">
        <div class="seg">${['製作', '採集', '戰鬥'].map(r => `<button data-act="strole" data-r="${r}" class="${ST.role === r ? 'on' : ''}">${r}職業</button>`).join('')}</div>
        <label class="f">職業 <select data-in="stjob"><option value="">全部</option>${jobs.map(a => `<option value="${a}" ${ST.job === a ? 'selected' : ''}>${esc(D().setJobs[a] || a)}</option>`).join('')}</select></label>
        <label class="f">裝備等級 <input type="number" data-in="stmin" min="1" max="100" placeholder="最低" value="${esc(ST.min)}"> – <input type="number" data-in="stmax" min="1" max="100" placeholder="最高" value="${esc(ST.max)}"></label>
        <input type="search" data-live="stq" placeholder="系列名稱（例：雀翎）" value="${esc(ST.q)}">
        <label class="f">每件數量 <input type="number" class="xs" min="1" value="${ST.qty}" data-in="stqty"></label>
      </div>
      <div id="stout"></div>`;
    updateSets();
  };
  function updateSets() {
    const min = num(ST.min), max = num(ST.max);
    const sets = D().sets.filter(s => s.role === ST.role && (!min || s.elvl >= min) && (!max || s.elvl <= max) &&
      (!ST.q || s.name.includes(ST.q)) && s.items.some(setItemOk));
    const tiers = [];
    const tmap = new Map();
    for (const s of sets) {
      const k = s.elvl + '|' + s.ilvl;
      if (!tmap.has(k)) { const t = { elvl: s.elvl, ilvl: s.ilvl, sets: [] }; tmap.set(k, t); tiers.push(t); }
      tmap.get(k).sets.push(s);
    }
    const out = $('#stout');
    if (!tiers.length) { out.innerHTML = '<div class="empty">沒有符合條件的套裝。</div>'; return; }
    out.innerHTML = tiers.slice(0, ST.limit).map(t => {
      const cnt = t.sets.reduce((n, s) => n + s.items.filter(it => setItemOk(it) && !ST.off.has(it.id)).length, 0);
      return `<div class="tier">
        <div class="tier-h"><h2>Lv${t.elvl}</h2><span class="muted">品級 ${t.ilvl}</span><span class="sp"></span>
          <button class="pri" data-act="sttier" data-k="${t.elvl}|${t.ilvl}">整個等級加入（${cnt} 件）</button></div>
        <div class="setcards">${t.sets.map(s => {
          const its = s.items.filter(setItemOk);
          const on = its.filter(it => !ST.off.has(it.id)).length;
          return `<div class="setcard">
            <div class="row"><h3>${esc(s.name)}</h3><span class="muted small">${its.length} 件</span><span class="sp"></span>
              <button class="text sm" data-act="stall" data-i="${s.idx}">全選</button><button class="text sm" data-act="stnone" data-i="${s.idx}">全不選</button></div>
            <div class="chips">${its.map(it => {
              const item = D().items.get(it.id);
              const c = D().cjc.get(it.cjc);
              return `<label><input type="checkbox" data-in="stchk" data-id="${it.id}" ${ST.off.has(it.id) ? '' : 'checked'}>${icon(item, 's')}<span>${esc(item.name)}</span><span class="tag">${esc(c ? c.name.split(' ')[0] : '')}</span></label>`;
            }).join('')}</div>
            <button class="pri" data-act="stadd" data-i="${s.idx}" ${on ? '' : 'disabled'}>加入清單（${on} 件）</button>
          </div>`;
        }).join('')}</div></div>`;
    }).join('') + (tiers.length > ST.limit ? '<div style="text-align:center"><button data-act="stmore">顯示更多等級</button></div>' : '');
  }
  actions.strole = b => { ST.role = b.dataset.r; ST.limit = 12; routes.sets(); };
  actions.stmore = () => { ST.limit += 12; updateSets(); };
  inputs.stjob = el => { ST.job = el.value; updateSets(); };
  inputs.stmin = el => { ST.min = el.value; updateSets(); };
  inputs.stmax = el => { ST.max = el.value; updateSets(); };
  inputs.stq = el => { ST.q = el.value.trim(); updateSets(); };
  inputs.stqty = el => { ST.qty = Math.max(1, Math.floor(num(el.value, 1))); };
  inputs.stchk = el => { const id = num(el.dataset.id); if (el.checked) ST.off.delete(id); else ST.off.add(id); updateSets(); };
  actions.stall = b => { for (const it of D().sets[num(b.dataset.i)].items) ST.off.delete(it.id); updateSets(); };
  actions.stnone = b => { for (const it of D().sets[num(b.dataset.i)].items) ST.off.add(it.id); updateSets(); };
  function addSetItems(sets) {
    let n = 0;
    for (const s of sets) for (const it of s.items) if (setItemOk(it) && !ST.off.has(it.id)) { addToList(it.id, ST.qty); n++; }
    toast(n ? '已加入 ' + n + ' 件裝備' + (ST.qty > 1 ? ' ×' + ST.qty : '') : '沒有勾選任何裝備');
  }
  actions.stadd = b => addSetItems([D().sets[num(b.dataset.i)]]);
  actions.sttier = b => {
    const [e, i] = b.dataset.k.split('|').map(Number);
    addSetItems(D().sets.filter(s => s.role === ST.role && s.elvl === e && s.ilvl === i && (!ST.q || s.name.includes(ST.q))));
  };

  // ============================================================ 清單
  function listSelector() {
    return `<div class="row noprint" style="margin-bottom:12px">
      <select data-in="listsel">${Store.d.lists.map(l => `<option value="${l.id}" ${l.id === Store.d.cur ? 'selected' : ''}>${esc(l.name)}（${l.items.length}）</option>`).join('')}</select>
      <button data-act="lnew">新增清單</button>
      <button data-act="lrename">重新命名</button>
      <button data-act="ldel" class="danger">刪除清單</button>
      <span class="sp"></span>
      <button data-act="lexport">匯出／分享</button>
      <button data-act="limport">匯入</button>
    </div>`;
  }
  inputs.listsel = el => { Store.d.cur = el.value; Store.save(); updateBadge(); route(); };
  actions.lnew = () => {
    const name = prompt('新清單名稱', '清單 ' + (Store.d.lists.length + 1));
    if (!name) return;
    const l = newList(name.trim()); Store.d.lists.push(l); Store.d.cur = l.id; Store.save(); updateBadge(); route();
  };
  actions.lrename = () => { const name = prompt('清單名稱', Store.list.name); if (!name) return; Store.list.name = name.trim(); Store.save(); route(); };
  actions.ldel = () => {
    if (!confirm('確定刪除清單「' + Store.list.name + '」？')) return;
    Store.d.lists = Store.d.lists.filter(l => l.id !== Store.d.cur);
    if (!Store.d.lists.length) Store.d.lists.push(newList());
    Store.d.cur = Store.d.lists[0].id; Store.save(); updateBadge(); route();
  };
  const b64enc = o => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  const b64dec = s => JSON.parse(decodeURIComponent(escape(atob(s))));
  actions.lexport = () => {
    const l = Store.list;
    const code = b64enc({ n: l.name, i: l.items.map(x => [x.id, x.qty]), p: l.pick, b: l.buy });
    const url = location.origin + location.pathname + '#/import/' + code;
    dialog(`<h2>匯出／分享「${esc(l.name)}」</h2>
      <p class="muted small">對方打開連結後會匯入成一份新清單。</p>
      <textarea id="exurl" rows="3" readonly>${esc(url)}</textarea>
      <div class="row" style="margin-top:12px"><button class="pri" id="excopy">複製連結</button>
      <button id="extext">複製文字清單</button><span class="sp"></span><button data-close>關閉</button></div>`, d => {
      $('#excopy', d).onclick = () => copy(url, '已複製分享連結');
      $('#extext', d).onclick = () => copy(l.items.map(x => FF.itemName(x.id) + ' x' + x.qty).join('\n'), '已複製文字清單');
    });
  };
  actions.limport = () => {
    dialog(`<h2>匯入清單</h2><p class="muted small">貼上分享連結或匯出代碼。</p>
      <textarea id="imp" rows="4"></textarea>
      <div class="row" style="margin-top:12px"><button class="pri" id="impgo">匯入</button><span class="sp"></span><button data-close>取消</button></div>`, d => {
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
  routes.list = function () {
    const l = Store.list;
    const rows = l.items.map((x, i) => {
      const it = D().items.get(x.id);
      const prods = D().recipesByResult.get(x.id) || [];
      const fc = D().fcByResult.get(x.id);
      const sel = prods.length > 1
        ? `<select data-in="lpick" data-id="${x.id}">${prods.map(r => `<option value="${r.id}" ${(l.pick[x.id] || prods[0].id) === r.id ? 'selected' : ''}>${esc(D().jobs[r.job])} Lv${r.level}${(r.flags & 4) ? '（需專家）' : ''}</option>`).join('')}</select>`
        : (prods[0] ? jobTag(prods[0]) : fc ? '<span class="tag fc">部隊工房</span>' : '<span class="tag">素材</span>');
      const rid = (l.pick[x.id] || (prods[0] && prods[0].id)) || 0;
      return `<tr>
        <td style="width:44px">${icon(it, 's')}</td>
        <td>${esc(it.name)}</td>
        <td>${sel}</td>
        <td class="num"><input type="number" min="1" class="xs" value="${x.qty}" data-in="lqty" data-idx="${i}"></td>
        <td class="num" style="white-space:nowrap">${rid ? `<button class="sm" data-act="go" data-href="#/macro/${rid}">巨集</button> ` : ''}<button class="sm danger" data-act="lrm" data-idx="${i}">移除</button></td>
      </tr>`;
    }).join('');
    view.innerHTML = `
      <div class="page-title">製作清單</div>${listSelector()}
      ${l.items.length ? `<table><thead><tr><th></th><th>物品</th><th>製作方式</th><th class="num">數量</th><th></th></tr></thead><tbody>${rows}</tbody></table>
        <div class="row" style="margin-top:14px"><button class="pri" data-act="go" data-href="#/materials">前往素材準備 →</button>
        <button data-act="lclear" class="danger">清空清單</button></div>`
      : '<div class="empty">清單是空的。到<a href="#/search">搜尋物品</a>或<a href="#/sets">快速套裝</a>加入要製作的東西。</div>'}`;
  };
  inputs.lqty = el => { const x = Store.list.items[num(el.dataset.idx)]; if (x) { x.qty = Math.max(1, Math.floor(num(el.value, 1))); Store.save(); } };
  inputs.lpick = el => { Store.list.pick[num(el.dataset.id)] = num(el.value); Store.save(); toast('已切換製作方式'); };
  actions.lrm = b => { Store.list.items.splice(num(b.dataset.idx), 1); Store.save(); updateBadge(); routes.list(); };
  actions.lclear = () => { if (confirm('清空目前清單？')) { Store.list.items = []; Store.save(); updateBadge(); routes.list(); } };

  // ============================================================ 素材準備
  const MT = { hideDone: false };
  function mrow(n, kind) {
    const l = Store.list;
    const craft = kind !== 'raw';
    const key = craft ? 'c' + n.id : String(n.id);
    const manual = !!l.done[key];
    const auto = !manual && n.net <= 0;          // 由上層完成或庫存自動滿足
    const done = manual || auto;
    if (MT.hideDone && done) return '';
    const p = n.producer;
    let tags = '';
    if (craft) tags = p.type === 'recipe' ? jobTag(p.rec) : '<span class="tag fc">部隊工房</span>';
    else tags = srcTag(n.source) + (n.item.flags & FF.FLAG.HQ ? '<span class="tag">可HQ</span>' : '');
    const canCraft = !craft && (D().recipesByResult.has(n.id) || D().fcByResult.has(n.id));
    const prods = craft && p.type === 'recipe' ? (D().recipesByResult.get(n.id) || []) : [];
    const sel = prods.length > 1 ? `<select data-in="pick" data-id="${n.id}" style="height:24px;padding:0 4px;font-size:12px">${prods.map(r => `<option value="${r.id}" ${r.id === p.rec.id ? 'selected' : ''}>${esc(D().jobs[r.job])} Lv${r.level}</option>`).join('')}</select>` : '';
    const sub = [];
    sub.push('總需求 ' + fmt(n.total));
    sub.push('持有 <input type="number" class="xs" min="0" value="' + (l.stock[n.id] || 0) + '" data-in="stock" data-id="' + n.id + '" style="height:22px;width:64px">');
    if (craft && n.crafts) sub.push('製作 ' + fmt(n.crafts) + ' 次' + (n.surplus ? '（多 ' + n.surplus + '）' : ''));
    if (!craft && n.source === 'shop' && n.item.price && n.net) sub.push(fmt(n.item.price * n.net) + ' Gil');
    const acts = [];
    if (craft && p.type === 'recipe') acts.push(`<button class="sm" data-act="go" data-href="#/macro/${p.rec.id}">巨集</button>`);
    if (craft && p.type === 'fc') acts.push(`<button class="sm" data-act="fcphase" data-id="${n.id}">工房階段</button>`);
    if (kind === 'semi') acts.push(`<button class="sm" data-act="buy" data-id="${n.id}" title="不自製，改列為基礎素材">改為購買</button>`);
    if (canCraft) acts.push(`<button class="sm" data-act="unbuy" data-id="${n.id}">改為自製</button>`);
    return `<li class="mrow ${done ? 'done' : ''} ${auto ? 'auto' : ''}">
      <input type="checkbox" data-in="done" data-id="${key}" ${done ? 'checked' : ''} ${auto ? 'disabled title="已由持有或上層完成自動備齊"' : ''} title="${craft ? '已完成製作' : '已備齊'}">
      ${icon(n.item, 's')}
      <div class="body"><div class="nm">${esc(n.item.name)} ${tags}${sel}</div><div class="sub">${sub.join('<span>·</span>')}</div></div>
      <div class="need">${n.net > 0 ? '×' + fmt(n.net) : '✓'}</div>
      <div class="acts">${acts.join('')}</div>
    </li>`;
  }
  function section(title, nodes, kind, grouped, note) {
    if (!nodes.length) return '';
    const l = Store.list;
    const isDone = n => n.net <= 0 || !!l.done[(kind === 'raw' ? '' : 'c') + n.id];
    const dn = nodes.filter(isDone).length;
    const body = grouped
      ? FF.groupByCat(nodes).map(([cat, list]) => {
        const rows = list.map(n => mrow(n, kind)).join('');
        return rows ? `<div class="cat">${esc(cat)}<span class="muted small">${list.filter(isDone).length}/${list.length}</span></div><ul class="mlist">${rows}</ul>` : '';
      }).join('')
      : `<ul class="mlist">${nodes.map(n => mrow(n, kind)).join('')}</ul>`;
    return `<div class="sec">
      <div class="sec-h"><h2>${title}</h2><span class="muted">${dn} / ${nodes.length}</span><div class="prog"><i style="width:${nodes.length ? dn / nodes.length * 100 : 0}%"></i></div>
        ${note ? `<span class="muted small">${note}</span>` : ''}</div>
      ${body || '<div class="muted small" style="padding:8px 0">（全部完成，已隱藏）</div>'}
    </div>`;
  }
  routes.materials = function () {
    const l = Store.list;
    if (!l.items.length) {
      view.innerHTML = `<div class="page-title">素材準備</div>${listSelector()}<div class="empty">清單是空的，先到<a href="#/search">搜尋物品</a>或<a href="#/sets">快速套裝</a>加入要製作的東西。</div>`;
      return;
    }
    const res = FF.computeMaterials(l);
    MT.res = res;
    const rawNeed = res.raws.filter(n => n.net > 0 && !l.done[String(n.id)]);
    view.innerHTML = `
      <div class="page-title">素材準備</div>${listSelector()}
      <div class="kvs">
        <div class="kv"><b>${res.roots.length}</b><span>成品</span></div>
        <div class="kv"><b>${res.semis.length}</b><span>半成品種類</span></div>
        <div class="kv"><b>${fmt(res.craftCount)}</b><span>剩餘製作次數</span></div>
        <div class="kv"><b>${rawNeed.length}</b><span>尚缺基礎素材種類</span></div>
        <div class="kv"><b>${fmt(res.gil)}</b><span>商店購買預估 Gil</span></div>
      </div>
      <div class="row noprint" style="margin-bottom:14px">
        <label class="f"><input type="checkbox" data-in="hide" ${MT.hideDone ? 'checked' : ''}> 隱藏已完成／已備齊</label>
        <span class="sp"></span>
        <button data-act="cpmat">複製基礎素材</button>
        <button data-act="cpcraft">複製製作順序</button>
        <button data-act="print">列印</button>
        <button data-act="resetchk" class="danger">重設勾選與持有</button>
      </div>
      ${section('成品', res.roots, 'root', false, '勾選＝已做好，底下所有素材一併視為備齊')}
      ${section('半成品', res.semis, 'semi', true, '勾選＝已做好，所用的基礎素材會自動扣除')}
      ${section('基礎素材', res.raws, 'raw', true, '勾選＝已備齊；填「持有」會自動扣除')}`;
  }
  inputs.done = el => { const l = Store.list; if (el.checked) l.done[el.dataset.id] = true; else delete l.done[el.dataset.id]; Store.save(); routes.materials(); };
  inputs.stock = el => { const v = Math.max(0, Math.floor(num(el.value))); if (v) Store.list.stock[el.dataset.id] = v; else delete Store.list.stock[el.dataset.id]; Store.save(); routes.materials(); };
  inputs.hide = el => { MT.hideDone = el.checked; routes.materials(); };
  inputs.pick = el => { Store.list.pick[num(el.dataset.id)] = num(el.value); Store.save(); routes.materials(); };
  actions.buy = b => { Store.list.buy[b.dataset.id] = true; Store.save(); routes.materials(); };
  actions.unbuy = b => { delete Store.list.buy[b.dataset.id]; Store.save(); routes.materials(); };
  actions.cpmat = () => copy(FF.materialsText(MT.res), '已複製基礎素材');
  actions.cpcraft = () => copy(FF.craftsText(MT.res), '已複製製作順序');
  actions.print = () => window.print();
  actions.resetchk = () => { if (confirm('清除目前清單的勾選與持有數量？')) { const l = Store.list; l.done = {}; l.stock = {}; Store.save(); routes.materials(); } };
  actions.fcphase = b => {
    const seq = D().fcByResult.get(num(b.dataset.id));
    if (!seq) return;
    dialog(`<h2>${esc(FF.itemName(seq.result))}：公司工房製作階段</h2>
      <p class="muted small">每個階段需要交付的物品（每組數量 × 組數）。</p>
      ${seq.parts.map((p, pi) => p.procs.map((proc, qi) => `<div class="phase"><h4>${esc(p.type || '零件')} ${seq.parts.length > 1 ? (pi + 1) + '-' : ''}階段 ${qi + 1}</h4>
        ${proc.map(([iid, q, sets]) => `<div class="row small" style="gap:6px;margin:2px 0">${icon(D().items.get(iid), 's')}${esc(FF.itemName(iid))} <b>×${q * sets}</b><span class="muted">（${q}×${sets} 組）</span></div>`).join('')}</div>`).join('')).join('')}
      <div class="row"><span class="sp"></span><button data-close>關閉</button></div>`);
  };

  // ============================================================ 職業數值
  const GS = { job: 0 };
  const jobFull = i => D().setJobs[ROLE_JOBS.製作[i]] || D().jobs[i];
  routes.stats = function () {
    const j = GS.job;
    const st = Store.stats(j);
    const saved = j in Store.d.stats;
    view.innerHTML = `
      <div class="page-title">職業數值</div>
      <p class="muted small" style="margin-top:-6px">每個製作職業的等級與屬性會存在這台裝置的瀏覽器中，巨集計算會自動帶入；在巨集頁修改也會同步存回這裡。請直接填入遊戲角色畫面顯示的數值（已包含專家魂晶 +20 作業精度／+20 加工精度／+15 CP，不需另外加），有吃食物、藥水就填加成後的數值。</p>
      <div class="gear">
        <div class="jobs">${D().jobs.map((n, i) => {
          const s = Store.stats(i);
          return `<a href="javascript:void 0" data-act="gsjob" data-j="${i}" class="${i === j ? 'on' : ''}">${esc(jobFull(i))}<small>${i in Store.d.stats ? 'Lv' + s.level + ' · ' + s.cs + '/' + s.ctl + '/' + s.cp : '尚未設定'}</small></a>`;
        }).join('')}</div>
        <div>
          <h2>${esc(jobFull(j))} ${saved ? '<span class="tag ok">已儲存</span>' : '<span class="tag">預設值</span>'}</h2>
          <div class="form">
            <span>等級</span><input type="number" id="gl" min="1" max="100" value="${st.level}" data-in="gsset">
            <span>作業精度</span><input type="number" id="gcs" min="0" value="${st.cs}" data-in="gsset">
            <span>加工精度</span><input type="number" id="gctl" min="0" value="${st.ctl}" data-in="gsset">
            <span>CP(製作力)</span><input type="number" id="gcp" min="0" value="${st.cp}" data-in="gsset">
            <span>專家</span><label class="f"><input type="checkbox" id="gspec" data-in="gsset" ${st.spec ? 'checked' : ''}> 已是專家職業（可用專心致志、巧奪天工）</label>
          </div>
          <div class="row" style="margin-top:18px">
            <button data-act="gscopy">把這組數值套用到所有製作職業</button>
            <button data-act="gsreset" class="danger">清除此職業</button>
          </div>
        </div>
      </div>`;
  };
  actions.gsjob = b => { GS.job = num(b.dataset.j); routes.stats(); };
  inputs.gsset = () => {
    Store.setStats(GS.job, { level: Math.max(1, Math.min(100, num($('#gl').value, 100))), cs: Math.max(0, num($('#gcs').value)), ctl: Math.max(0, num($('#gctl').value)), cp: Math.max(0, num($('#gcp').value)), spec: $('#gspec').checked });
    const a = $$('.gear .jobs a')[GS.job]; const s = Store.stats(GS.job);
    if (a) a.querySelector('small').textContent = 'Lv' + s.level + ' · ' + s.cs + '/' + s.ctl + '/' + s.cp;
    toast('已儲存');
  };
  actions.gscopy = () => {
    if (!confirm('用目前職業的數值覆蓋全部 8 個製作職業？（專家設定不會複製）')) return;
    const s = Store.stats(GS.job);
    for (let i = 0; i < D().jobs.length; i++) Store.setStats(i, { level: s.level, cs: s.cs, ctl: s.ctl, cp: s.cp, spec: i === GS.job ? s.spec : Store.stats(i).spec });
    routes.stats(); toast('已套用到所有職業');
  };
  actions.gsreset = () => { delete Store.d.stats[GS.job]; Store.save(); routes.stats(); };

  // ============================================================ 巨集計算（模擬器）
  const M = { rid: 0, seq: [], worker: null, running: false, hq: {}, target: 'max', targetNum: 0, effort: 'normal', tab: 'export', useSpec: false };
  const BUFF_LABEL = { ven: '崇敬', inn: '改革', gs: '闊步', wn: '儉約', man: '掌握', fa: '最終確認', mm: '堅信' };
  const PAL_ROWS = [
    ['muscleMemory', 'reflect', 'trainedEye'],
    ['veneration', 'innovation', 'greatStrides', 'wasteNot', 'wasteNot2', 'manipulation', 'finalAppraisal'],
    ['basicSynth', 'carefulSynth', 'groundwork', 'prudentSynth', 'intensiveSynth', 'delicateSynth'],
    ['basicTouch', 'standardTouch', 'advancedTouch', 'refinedTouch', 'prudentTouch', 'preparatoryTouch', 'preciseTouch', 'byregotsBlessing', 'trainedFinesse'],
    ['observe', 'heartAndSoul', 'trainedPerfection'],
    ['mastersMend', 'immaculateMend'],
  ];
  const SE_LIST = [''].concat(Array.from({ length: 16 }, (_, i) => '<se.' + (i + 1) + '>'));
  const macroOpt = () => Object.assign({ notify: 'auto', se: '<se.1>', split: 'even', extraWait: 0 }, Store.d.macroOpt || {});
  const setMacroOpt = o => { Store.d.macroOpt = Object.assign(macroOpt(), o); Store.save(); };
  function stopWorker() { if (M.worker) { M.worker.terminate(); M.worker = null; } M.running = false; }
  const actImg = k => img(D().actionIcons[k]);
  const collectOf = rec => (D().collect && D().collect.get(rec.result)) || null;

  routes.macro = function (args) {
    const rid = num(args && args[0]);
    M.rid = D().recipes.has(rid) ? rid : 0;
    const l = Store.list;
    const fromList = l.items.map(x => {
      const prods = D().recipesByResult.get(x.id);
      if (!prods) return null;
      return (l.pick[x.id] && D().recipes.get(l.pick[x.id])) || prods[0];
    }).filter(Boolean);
    const picker = `<div class="row" style="margin-bottom:14px">
      <div class="pick-dd grow"><input id="mq" data-live="mq" type="search" style="width:100%" placeholder="搜尋要製作的物品" autocomplete="off"><div class="dd hidden" id="mdd"></div></div>
      ${fromList.length ? `<select data-in="mfromlist"><option value="">從製作清單選擇…</option>${fromList.map(r => `<option value="${r.id}" ${r.id === M.rid ? 'selected' : ''}>${esc(FF.itemName(r.result))}</option>`).join('')}</select>` : ''}
    </div>`;
    if (!M.rid) {
      view.innerHTML = `<div class="page-title">巨集計算</div>${picker}<div class="empty">請先選擇配方。<br>計算會使用「職業數值」中儲存的等級與屬性。</div>`;
      return;
    }
    const rec = D().recipes.get(M.rid);
    const rp = FFSim.recipeParams(rec.row, D().rlt[rec.rltId]);
    M.rp = rp; M.rec = rec; M.collect = collectOf(rec);
    if (M.seqRid !== M.rid) { M.seq = []; M.hq = {}; M.progText = ''; if (M.target.startsWith('c')) M.target = 'max'; }
    M.seqRid = M.rid;
    const st = Store.stats(rec.job);
    const item = D().items.get(rec.result);
    view.innerHTML = `${picker}
      <div class="sim-title"><h1>${esc(item.name)}${rec.amount > 1 ? ' ×' + rec.amount : ''}</h1>${jobTag(rec)}
        ${M.collect ? '<span class="tag fc">收藏品</span>' : ''}${rp.expert ? '<span class="tag bad">高難度配方</span>' : ''}${rec.flags & 4 ? '<span class="tag">需專家</span>' : ''}
        <span class="sp"></span><button data-act="maddlist">加入清單</button></div>
      <div class="sim-top">
        <div>
          <div class="lbl">耐久<b id="tDur"></b></div><div class="durbox" id="durbox"></div>
          <div class="lbl">CP(製作力)<b id="tCp"></b></div><div class="bar cp"><i id="bCp"></i></div>
        </div>
        <div>
          <div class="lbl">進展<b id="tProg"></b></div><div class="bar prog"><i id="bProg"></i></div>
          <div class="lbl">品質<b id="tQual"></b></div><div class="bar q"><i id="bQual"></i></div>
          <div id="collectBar"></div>
        </div>
        <div class="statlist">
          <span>等級:</span><input type="number" id="pl" min="1" max="100" value="${st.level}" data-in="mstat">
          <span>作業精度:</span><input type="number" id="pcs" min="0" value="${st.cs}" data-in="mstat">
          <span>加工精度:</span><input type="number" id="pctl" min="0" value="${st.ctl}" data-in="mstat">
          <span>CP(製作力):</span><input type="number" id="pcp" min="0" value="${st.cp}" data-in="mstat">
          <span>專家:</span><span style="text-align:right"><input type="checkbox" id="pspec" data-in="mstat" ${st.spec ? 'checked' : ''} title="勾選後可手動使用專心致志、巧奪天工"></span>
          <span></span><a href="#/stats" class="small" style="text-align:right">職業數值 →</a>
        </div>
      </div>
      <div class="sim-body">
        <div class="palette" id="palette"></div>
        <div>
          <div class="seq-wrap"><div class="seq" id="seq"></div></div>
          <div class="tagrow" id="seqtags"></div>
          <div class="tabs" id="mtabs">${[['init', '初期品質'], ['export', '匯出'], ['import', '匯入'], ['solve', '求解'], ['steps', '分析']].map(([k, n]) => `<button data-act="mtab" data-t="${k}" class="${M.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
          <div id="mtab"></div>
        </div>
      </div>`;
    renderTab();
    updateSim();
  };
  // 配方搜尋下拉
  inputs.mq = el => {
    const q = el.value.trim();
    const dd = $('#mdd');
    if (!q) { dd.classList.add('hidden'); return; }
    const res = FF.search(q, {}).filter(e => e.recipes.length).slice(0, 10);
    dd.innerHTML = res.length ? res.map(e => `<div class="item" data-act="go" data-href="#/macro/${e.recipes[0].id}">${icon(e.item, 's')}<div class="body"><b>${esc(e.item.name)}</b> <span class="muted small">${e.recipes.map(r => esc(D().jobs[r.job]) + ' Lv' + r.level).join(' / ')}</span></div></div>`).join('') : '<div class="item muted">沒有結果</div>';
    dd.classList.remove('hidden');
  };
  inputs.mfromlist = el => { if (el.value) location.hash = '#/macro/' + el.value; };
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
    const ings = M.rec.ings.map(([id, n]) => {
      const it = D().items.get(id);
      return { ilvl: it.ilvl, amount: n, hq: M.hq[id] || 0, canHq: !!(it.flags & FF.FLAG.HQ) && id > 19 };
    });
    return FFSim.initialQuality(M.rp, ings);
  }
  function curCtx() {
    const p = readPlayer();
    p.initialQuality = M.rp.quality ? hqInitial() : 0;
    return { player: p, ctx: FFSim.makeCtx(p, M.rp) };
  }
  inputs.mstat = () => {
    const p = readPlayer();
    Store.setStats(M.rec.job, { level: p.level, cs: p.craftsmanship, ctl: p.control, cp: p.cp, spec: p.specialist });
    updateSim();
  };
  inputs.mhq = el => { M.hq[el.dataset.id] = Math.max(0, Math.floor(num(el.value))); renderTab(); updateSim(); };
  actions.mtab = b => { M.tab = b.dataset.t; $$('#mtabs button').forEach(x => x.classList.toggle('on', x === b)); renderTab(); };

  const seg = (act, cur, opts) => `<div class="seg">${opts.map(([k, n]) => `<button data-act="${act}" data-t="${k}" class="${String(cur) === String(k) ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  function renderTab() {
    const box = $('#mtab'); if (!box) return;
    const rp = M.rp, rec = M.rec;
    if (M.tab === 'solve') {
      const tOpts = [['max', '最大品質']];
      if (M.collect) M.collect.forEach((c, i) => tOpts.push(['c' + i, '收藏價值 ' + c + '（等級 ' + (i + 1) + '）']));
      tOpts.push(['custom', '自訂'], ['none', '只求完成']);
      box.innerHTML = `
        <div class="opt-grid">
          <span>目標品質</span><div class="row">${seg('mtarget', M.target, tOpts)}
            <input type="number" id="mtnum" min="0" value="${M.targetNum || rp.quality}" data-in="mtnum" class="${M.target === 'custom' ? '' : 'hidden'}"></div>
          <span>搜尋強度</span>${seg('meffort', M.effort, [['fast', '快速 10 秒'], ['normal', '標準 30 秒'], ['deep', '精細 90 秒']])}
          <span>專家技能</span><label class="f"><input type="checkbox" data-in="muspec" ${M.useSpec ? 'checked' : ''}> 允許使用專心致志、巧奪天工（需勾選上方「專家」，會消耗專家之證）</label>
          <span></span><div class="row"><button class="pri" id="msolve" data-act="msolve" ${M.running ? 'disabled' : ''}>開始求解</button>
            <button id="mstop" data-act="mstop" class="${M.running ? '' : 'hidden'}">停止</button>
            <span class="muted small" id="mprog">${esc(M.progText || '')}</span></div>
        </div>
        ${rp.expert ? '<div class="warnbox">高難度配方的製作狀態會隨機變化，求解器只模擬「通常」狀態，結果僅供參考。</div>' : ''}
        <p class="muted small">以光束搜尋＋模擬退火求解：品質優先，達到目標後選巨集時間最短的流程。屬於啟發式搜尋，不保證為最佳解。</p>`;
    } else if (M.tab === 'export') {
      const o = macroOpt();
      const macros = FFSim.buildMacros(M.seq, D().actionNames, o);
      box.innerHTML = `
        <div class="opt-grid">
          <span>新增完成提示</span>${seg('mnotify', o.notify, [['auto', '自動確定'], ['always', '總是提示'], ['none', '不提示']])}
          <span>拆分過長的巨集</span>${seg('msplit', o.split, [['even', '平均'], ['greedy', '貪婪']])}
          <span>提示音</span><select data-in="mse" style="width:180px">${SE_LIST.map(x => `<option value="${esc(x)}" ${o.se === x ? 'selected' : ''}>${x ? esc(x) : '無'}</option>`).join('')}</select>
          <span>增加等待時間</span><input type="number" min="0" max="5" value="${o.extraWait}" data-in="mwait" style="width:180px">
        </div>
        ${macros.length ? `<p class="muted small">點擊巨集文字即可複製。</p><div class="macros">${macros.map((m, i) => `<pre class="macro copyable" data-act="cpmacro" data-i="${i}" title="點擊複製巨集 #${i + 1}">${esc(m.text)}</pre>`).join('')}</div>`
          : '<div class="empty">尚無流程。可在「求解」計算，或點左側技能手動排列。</div>'}`;
      M.macros = macros;
    } else if (M.tab === 'import') {
      box.innerHTML = `<p class="muted small">貼上遊戲巨集（/ac 技能名 &lt;wait.3&gt;），可用來模擬別人分享的巨集。</p>
        <textarea id="mimp" rows="10" placeholder="/ac 堅信 <wait.3>"></textarea>
        <div class="row" style="margin-top:8px"><button class="pri" data-act="impmacro">匯入並模擬</button></div>`;
    } else if (M.tab === 'steps') {
      box.innerHTML = '<div id="steps"></div>';
      updateSteps();
    } else {
      const hqIngs = rec.ings.filter(([id]) => (D().items.get(id).flags & FF.FLAG.HQ) && id > 19);
      box.innerHTML = `<div class="kvs">
          <div class="kv"><b>${fmt(rp.difficulty)}</b><span>難度</span></div>
          <div class="kv"><b>${rp.quality ? fmt(rp.quality) : '—'}</b><span>最大品質</span></div>
          <div class="kv"><b>${rp.durability}</b><span>耐久</span></div>
          <div class="kv"><b>${rec.level}</b><span>配方等級</span></div>
          <div class="kv"><b>${fmt(rp.suggestedCs)}</b><span>建議作業精度</span></div>
          ${rp.reqCs ? `<div class="kv"><b>${fmt(rp.reqCs)}</b><span>需求作業精度</span></div>` : ''}
          ${rp.reqCtl ? `<div class="kv"><b>${fmt(rp.reqCtl)}</b><span>需求加工精度</span></div>` : ''}
          ${M.collect ? `<div class="kv"><b>${M.collect.join(' / ')}</b><span>收藏價值門檻</span></div>` : ''}
        </div>
        <h3>素材（HQ 素材會提高初期品質）</h3>
        ${rec.ings.map(([id, n]) => {
          const it = D().items.get(id);
          const can = hqIngs.some(x => x[0] === id) && rp.quality;
          return `<div class="row small" style="margin:4px 0">${icon(it, 's')}<span style="min-width:160px">${esc(it.name)} ×${n}</span>
            ${can ? `<label class="f">HQ 數量 <input type="number" class="xs" min="0" max="${n}" value="${M.hq[id] || 0}" data-in="mhq" data-id="${id}"></label>` : ''}</div>`;
        }).join('')}
        ${rp.quality && hqIngs.length ? `<p class="muted small">初期品質（估算）：<b>${fmt(hqInitial())}</b></p>` : ''}`;
    }
  }
  actions.mtarget = b => { M.target = b.dataset.t; renderTab(); };
  inputs.mtnum = el => { M.targetNum = Math.max(0, num(el.value)); };
  inputs.muspec = el => { M.useSpec = el.checked; };
  actions.meffort = b => { M.effort = b.dataset.t; renderTab(); };
  actions.mnotify = b => { setMacroOpt({ notify: b.dataset.t }); renderTab(); updateSim(); };
  actions.msplit = b => { setMacroOpt({ split: b.dataset.t }); renderTab(); updateSim(); };
  inputs.mse = el => { setMacroOpt({ se: el.value }); renderTab(); };
  inputs.mwait = el => { setMacroOpt({ extraWait: Math.max(0, Math.min(5, Math.floor(num(el.value)))) }); renderTab(); updateSim(); };

  const EFFORT = { fast: { t: 10000, r: 2 }, normal: { t: 30000, r: 3 }, deep: { t: 90000, r: 6 } };
  function targetValue(ctx) {
    if (M.target === 'none') return 0;
    if (M.target === 'custom') return Math.min(ctx.maxQ, Math.max(0, M.targetNum || ctx.maxQ));
    if (M.target.startsWith('c') && M.collect) return Math.min(ctx.maxQ, M.collect[num(M.target.slice(1))] * 10);
    return ctx.maxQ;
  }
  function setProg(html) { M.progText = html.replace(/<[^>]+>/g, ''); const p = $('#mprog'); if (p) p.innerHTML = html; }
  actions.msolve = () => {
    if (M.running) return;
    const { player } = curCtx();
    if (player.craftsmanship < 1) { toast('請輸入作業精度'); return; }
    player.specialist = player.specialist && M.useSpec;     // 預設不讓求解器使用專家技能
    const ctx = FFSim.makeCtx(player, M.rp);
    const target = targetValue(ctx);
    const ef = EFFORT[M.effort];
    const rid = M.rid;
    M.running = true;
    renderTab();
    const t0 = Date.now();
    setProg('計算中…');
    const timer = setInterval(() => { if (M.running) setProg('計算中…已 ' + Math.round((Date.now() - t0) / 1000) + ' 秒（上限約 ' + Math.round(ef.t / 1000) + ' 秒）'); }, 500);
    const finish = (keys, ok, reached) => {
      clearInterval(timer);
      M.running = false; M.worker = null;
      if (M.rid !== rid) return;
      if (!ok) setProg('<span class="bad">在目前屬性下找不到能完成製作的流程，請提高作業精度或 CP。</span>');
      else {
        M.seq = keys;
        setProg(reached ? '<span class="ok">已找到可達成目標品質的流程。</span>' : '<span class="warn">可完成製作，但無法達到目標品質（已盡量提高）。</span>');
      }
      renderTab(); updateSim();
    };
    const msg = { type: 'solve', player, recipe: M.rp, target, timeLimitMs: ef.t, rounds: ef.r };
    function runInline() {
      setTimeout(() => {
        const r = FFSim.solveBest(ctx, { target, timeLimitMs: Math.min(ef.t, 20000), rounds: 2 });
        finish(r.keys, r.finished, r.reachedTarget);
      }, 30);
    }
    try {
      const w = new Worker('js/solver.worker.js');
      M.worker = w;
      w.onmessage = e => {
        if (e.data.type === 'done') finish(e.data.keys, e.data.finished, e.data.reachedTarget);
        else if (e.data.type === 'error') { clearInterval(timer); M.running = false; setProg('<span class="bad">求解失敗：' + esc(e.data.message) + '</span>'); renderTab(); }
      };
      w.onerror = () => { w.terminate(); M.worker = null; runInline(); };
      w.postMessage(msg);
    } catch (e) { runInline(); }
  };
  actions.mstop = () => { stopWorker(); setProg('已停止。'); renderTab(); };
  actions.addact = b => { M.seq.push(b.dataset.key); updateSim(); };
  actions.delact = b => { M.seq.splice(num(b.dataset.idx), 1); updateSim(); };
  actions.clrseq = () => { M.seq = []; updateSim(); };
  actions.cpmacro = b => {
    const m = M.macros && M.macros[num(b.dataset.i)];
    if (!m) return;
    copy(m.text, '已複製巨集 #' + (num(b.dataset.i) + 1));
    b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 800);
  };
  actions.impmacro = () => {
    const r = FFSim.parseMacro($('#mimp').value, D().actionNames);
    if (!r.keys.length) { toast('沒有辨識到任何技能'); return; }
    M.seq = r.keys; M.tab = 'steps';
    $$('#mtabs button').forEach(x => x.classList.toggle('on', x.dataset.t === 'steps'));
    renderTab(); updateSim();
    toast('已匯入 ' + r.keys.length + ' 個技能' + (r.unknown.length ? '；未識別：' + r.unknown.slice(0, 3).join('、') : ''));
  };

  function updateSim() {
    if (!$('#seq')) return;
    const { ctx } = curCtx();
    const names = D().actionNames;
    const A = FFSim.ACTIONS;
    const sim = FFSim.simulate(ctx, M.seq);
    M.sim = sim; M.ctx = ctx;
    const s = sim.final;
    const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, a / b * 100)) : 0);
    $('#tDur').textContent = Math.max(0, s.d) + ' / ' + ctx.maxD;
    const boxes = Math.ceil(ctx.maxD / 10), full = Math.ceil(Math.max(0, s.d) / 10);
    $('#durbox').innerHTML = Array.from({ length: boxes }, (_, i) => '<i class="' + (i < full ? 'f' : '') + '"></i>').join('');
    $('#tCp').textContent = s.cp + ' / ' + ctx.maxCp;
    $('#bCp').style.width = pct(s.cp, ctx.maxCp) + '%';
    $('#tProg').textContent = fmt(Math.min(s.p, ctx.diff)) + ' / ' + fmt(ctx.diff);
    $('#bProg').style.width = pct(s.p, ctx.diff) + '%';
    const q = Math.min(s.q, ctx.maxQ || s.q);
    let qtxt = ctx.maxQ ? fmt(q) + ' / ' + fmt(ctx.maxQ) : '此配方無品質';
    if (ctx.maxQ) qtxt += '　優質率 ' + FFSim.hqChance(q, ctx.maxQ) + '%';
    if (M.collect) {
      const cv = Math.floor(q / 10);
      const lv = M.collect.filter(c => cv >= c).length;
      qtxt += '　收藏價值 ' + cv + '　收藏價值等級 ' + lv;
    }
    $('#tQual').textContent = qtxt;
    $('#bQual').style.width = pct(q, ctx.maxQ) + '%';
    // 收藏價值區間
    const cb = $('#collectBar');
    if (M.collect && ctx.maxQ) {
      const xs = M.collect.map(c => pct(c * 10, ctx.maxQ));
      const cls = ['c1', 'c2', 'c3'];
      cb.innerHTML = `<div class="cbar">${xs.map((x, i) => `<i class="seg ${cls[i]} ${q >= M.collect[i] * 10 ? 'on' : ''}" style="left:${x}%;width:${(i < 2 ? xs[i + 1] : 100) - x}%"></i><b class="dia ${cls[i]} ${q >= M.collect[i] * 10 ? 'on' : ''}" style="left:${x}%" title="收藏價值 ${M.collect[i]}（品質 ${fmt(M.collect[i] * 10)}）"></b>`).join('')}</div>
        <div class="clabels">${xs.map((x, i) => `<span style="left:${x}%">${M.collect[i]}</span>`).join('')}</div>`;
    } else cb.innerHTML = '';
    // 技能面板
    $('#palette').innerHTML = PAL_ROWS.map(row => `<div class="grp">${row.map(k => {
      const a = A[k];
      const locked = ctx.level < a.lvl || (a.spec && !ctx.specialist);
      const why = locked ? null : FFSim.whyNot(k, s, ctx);
      const cost = FFSim.cpCost(a, s);
      return `<button class="act ${why ? 'na' : ''}" data-act="addact" data-key="${k}" ${locked ? 'disabled' : ''} title="${esc(names[k])}（Lv${a.lvl}${cost ? '，' + cost + ' CP' : ''}${a.dur ? '，耐久 ' + a.dur : ''}）${why ? '\n目前無法使用：' + why : ''}">${actImg(k)}${cost ? '<i>' + cost + '</i>' : ''}</button>`;
    }).join('')}</div>`).join('');
    // 技能序列
    const errIdx = sim.error ? sim.error.index : -1;
    $('#seq').innerHTML = M.seq.length ? M.seq.map((k, i) => `<button class="act ${i === errIdx ? 'err' : ''} ${errIdx >= 0 && i > errIdx ? 'skip' : ''}" data-act="delact" data-idx="${i}" title="${i + 1}. ${esc(names[k])}（點擊移除）">${actImg(k)}</button>`).join('') + '<button class="clr" data-act="clrseq" title="清空">⊗</button>'
      : '<span class="muted small">點左側技能加入，或用「求解」自動計算。點這裡的技能可移除。</span>';
    const o = macroOpt();
    const macros = FFSim.buildMacros(M.seq, D().actionNames, o);
    const lines = macros.reduce((t, m) => t + m.lines.length, 0);
    const secs = macros.reduce((t, m) => t + m.seconds, 0);
    const manual = M.seq.reduce((t, k) => t + (FFSim.actionWait(k) === 2 ? 1.5 : 2), 0);
    let status = '';
    if (M.seq.length) {
      if (sim.status === 1) status = '<span class="tag ok">製作完成</span>';
      else if (sim.status === 2) status = '<span class="tag bad">耐久歸零，失敗</span>';
      else status = '<span class="tag">進展未完成</span>';
    }
    $('#seqtags').innerHTML = `<span class="tag ok">巨集長度: ${M.seq.length}</span><span class="tag">巨集數: ${macros.length}（${lines} 行）</span><span class="tag">工次: ${M.seq.length}</span><span class="tag">巨集耗時: ${secs}s</span><span class="tag">手搓耗時: ${manual.toFixed(1)}s</span>${status}
      ${sim.error && M.seq.length ? `<span class="tag bad">第 ${sim.error.index + 1} 步「${esc(names[sim.error.key])}」：${esc(sim.error.reason)}</span>` : ''}`;
    if (M.tab === 'export') renderTab();
    if (M.tab === 'steps') updateSteps();
  }
  function updateSteps() {
    const box = $('#steps'); if (!box || !M.sim) return;
    const names = D().actionNames, ctx = M.ctx;
    const rows = M.sim.steps.map((st, i) => {
      const x = st.s;
      const bf = Object.keys(BUFF_LABEL).filter(k => x[k] > 0).map(k => BUFF_LABEL[k] + x[k]).join(' ');
      return `<tr><td class="num">${i + 1}</td><td><div class="row" style="gap:6px;flex-wrap:nowrap">${img(D().actionIcons[st.key], 's')}${esc(names[st.key])}</div></td><td class="num">${fmt(Math.min(x.p, ctx.diff))}</td><td class="num">${fmt(Math.min(x.q, ctx.maxQ || x.q))}</td><td class="num">${Math.max(0, x.d)}</td><td class="num">${x.cp}</td><td class="num">${x.iq}</td><td class="small muted">${bf}</td></tr>`;
    }).join('');
    box.innerHTML = rows ? `<div style="overflow-x:auto"><table><thead><tr><th class="num">#</th><th>技能</th><th class="num">進展</th><th class="num">品質</th><th class="num">耐久</th><th class="num">CP</th><th class="num">內靜</th><th>增益</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted small">模擬假設製作狀態恆為「通常」；公式依社群資料實作，與遊戲可能相差 1 左右。</p>` : '<div class="empty">尚無步驟。</div>';
  }

  // ============================================================ 啟動
  async function boot() {
    Store.load();
    try {
      await FF.loadData('data/');
    } catch (e) {
      view.innerHTML = '<div class="empty bad">資料載入失敗：' + esc(e.message) + '<br>請透過 http(s) 開啟（例如 GitHub Pages），不要直接雙擊 index.html。</div>';
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
