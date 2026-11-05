/* INFORMS 日程检索页 —— 纯前端，数据来自同目录 data.js */
(function () {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = window.__DATA;
  const app = el('app');

  if (!D || !D.talks) {
    app.innerHTML = '<p class="empty">数据加载失败。</p>';
    return;
  }

  const { sessions = [], talks = [], paperLabels = {}, aliases = {}, topicLookup = {} } = D;
  const sessionById = new Map(sessions.map((session) => [session.evt, session]));
  const orgAliases = new Map();
  for (const [name, variants] of Object.entries(aliases)) {
    for (const value of [name, ...variants]) orgAliases.set(value.toLowerCase(), name);
  }
  const canonicalOrg = (value) => orgAliases.get(value.trim().toLowerCase()) || value.trim();
  const topicOf = (record) => record.topic || '__unclassified';
  const topicLabel = (topic) => topic === '__unclassified' ? '未分类' : topic;

  // ---------- 索引
  const talksByEvt = new Map();
  for (const t of talks) {
    if (!talksByEvt.has(t.evt)) talksByEvt.set(t.evt, []);
    talksByEvt.get(t.evt).push(t);
  }

  const days = [...new Set(sessions.map((s) => s.dayRaw).filter(Boolean))];
  const dayRank = new Map(days.map((d, i) => [d, i]));
  const toMin = (tr) => {
    const m = (tr || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return 9999;
    let h = Number(m[1]) % 12;
    if (/PM/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  };
  const chrono = (a, b) => (dayRank.get(a.dayRaw) ?? 99) - (dayRank.get(b.dayRaw) ?? 99) || toMin(a.timeRange) - toMin(b.timeRange);
  sessions.sort(chrono);
  talks.sort(chrono);
  for (const arr of talksByEvt.values()) arr.sort(chrono);
  const topics = [...new Set(sessions.map(topicOf))].sort((a, b) => a.localeCompare(b));
  const types = [...new Set(sessions.map((s) => s.type).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const affCount = new Map();
  const authorCount = new Map();
  const topicCount = new Map();
  const dayCount = new Map();
  for (const t of talks) {
    topicCount.set(topicLabel(topicOf(t)), (topicCount.get(topicLabel(topicOf(t))) || 0) + 1);
    dayCount.set(t.dayRaw, (dayCount.get(t.dayRaw) || 0) + 1);
    for (const org of new Set(t.authors.filter((a) => a.presenter).map((a) => a.organization).filter(Boolean))) {
      affCount.set(org, (affCount.get(org) || 0) + 1);
    }
    for (const a of t.authors || []) {
      if (a.name) authorCount.set(a.name, (authorCount.get(a.name) || 0) + 1);
    }
  }

  const filterKeys = ['q', 'day', 'topic', 'type', 'org', 'paper', 'author'];
  const defaults = { tab: 'talks', q: '', day: '', topic: '', type: '', org: '', paper: '', author: '', limit: 80 };
  const state = { ...defaults, open: new Set() };
  function readLocation() {
    Object.assign(state, defaults);
    const tab = location.hash.slice(1);
    if (['overview', 'sessions', 'talks', 'authors', 'orgs'].includes(tab)) state.tab = tab;
    const params = new URLSearchParams(location.search);
    for (const key of filterKeys) state[key] = params.get(key) || '';
    state.org = canonicalOrg(state.org);
    state.topic = topicLookup[state.topic] || state.topic;
    if (['published', 'working_paper'].includes(state.paper)) state.paper = 'available';
    if (['needs_metadata', 'search_failed'].includes(state.paper)) state.paper = 'unsearched';
    if (['needs_review', 'submitted', 'in_preparation'].includes(state.paper)) state.paper = 'not_found';
    state.open.clear();
  }
  readLocation();
  function saveLocation() {
    const params = new URLSearchParams();
    for (const key of filterKeys) if (state[key]) params.set(key, state[key]);
    const query = params.size ? '?' + params.toString() : '';
    history.replaceState(null, '', location.pathname + query + '#' + state.tab);
  }

  const hay = (t) =>
    [t.title, t.sessionTitle, t.sessionCode, t.topic, t.room, (t.authors || []).map((a) => a.name + ' ' + a.affiliation + ' ' + a.organization).join(' '), t.abstract]
      .join(' \n ')
      .toLowerCase();

  const talkIndex = talks.map((t) => ({ t, h: hay(t) }));
  const sessIndex = sessions.map((s) => ({
    s,
    h: [s.code, s.title, s.topic, s.room, (s.chairs || []).join(' '), (s.talks || []).map((x) => x.titleShort).join(' ')].join(' \n ').toLowerCase(),
  }));

  function matchesTalk({ t, h }) {
    return (!state.day || t.dayRaw === state.day)
      && (!state.topic || topicOf(t) === state.topic)
      && (!state.type || sessionById.get(t.evt)?.type === state.type)
      && (!state.q || h.includes(state.q.trim().toLowerCase()))
      && (!state.org || t.authors.some((a) => a.presenter && a.organization.toLowerCase() === canonicalOrg(state.org).toLowerCase()))
      && (!state.author || t.authors.some((a) => a.name === state.author))
      && (!state.paper || t.paperCategory === state.paper);
  }

  function authorsHtml(t) {
    return t.authors.map((a) => `<b>${esc(a.name)}</b>${a.presenter ? '<span class="presenter">报告人</span>' : ''} · <span title="${esc(a.affiliation)}">${esc(a.organization || a.affiliation)}</span>`).join('，');
  }

  function paperHtml(t) {
    return `<div class="paper"><span class="tag">${esc(paperLabels[t.paperCategory])}</span>
      ${t.paperSource ? `<a href="${esc(t.paperSource.url)}" target="_blank" rel="noopener noreferrer">论文</a>` : ''}
      </div>`;
  }

  // ---------- 组件
  function card(n, l) {
    return `<div class="card"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
  }

  function dayBars(map) {
    const order = days.filter((d) => map.has(d));
    const top = Math.max(1, ...order.map((d) => map.get(d)));
    return order.map((d) => {
      const v = map.get(d);
      return `<div class="barrow"><div class="lab">${esc(d)}</div><div><div class="bar" style="width:${Math.max(2, (v / top) * 100)}%"></div></div><div>${v}</div></div>`;
    }).join('');
  }

  function bars(map, max, n = 15) {
    const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const top = rows.length ? rows[0][1] : 1;
    return rows
      .map(([k, v]) => `<div class="barrow"><div class="lab" title="${esc(k)}">${esc(k)}</div><div><div class="bar" style="width:${Math.max(2, (v / top) * 100)}%"></div></div><div>${v}</div></div>`)
      .join('');
  }

  function selectFilter(id, label, rows) {
    return `<label>${label}<select id="${id}"><option value="">全部</option>${rows.map(([value, text]) => `<option value="${esc(value)}" ${state[id] === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  }

  function filters() {
    const orgs = [...affCount.keys()].sort((a, b) => a.localeCompare(b));
    return `<div class="filters">
      <label class="keyword">关键词<input type="search" id="q" value="${esc(state.q)}"></label>
      <label class="school">报告人学校 / 机构<input type="search" id="org" list="org-options" value="${esc(state.org)}" autocomplete="off"></label>
      <datalist id="org-options">${orgs.map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist>
      ${selectFilter('topic', '主题', topics.map((topic) => [topic, topicLabel(topic)]))}
      ${selectFilter('paper', '论文状态', Object.entries(paperLabels))}
      ${selectFilter('day', '日期', days.map((day) => [day, day]))}
      ${selectFilter('type', '报告类型', types.map((type) => [type, type]))}
      <button id="clear" class="reset">清空筛选</button>
    </div>
    ${state.author ? `<p class="note">作者 · ${esc(state.author)}</p>` : ''}`;
  }

  function talkBlock(t) {
    const authors = authorsHtml(t);
    const open = state.open.has('a' + t.evdid);
    return `<div class="talk">
      <div class="tt">${esc(t.title)}</div>
      <div class="tm">${esc(t.timeRange || '')}${t.programNumber ? ` · #${t.programNumber}` : ''}</div>
      <div class="authors">${authors}</div>
      ${paperHtml(t)}
      ${t.abstract ? `<button class="link" data-abs="${t.evdid}">${open ? '收起摘要' : '展开摘要'}</button><div class="abstract" id="abs-${t.evdid}" ${open ? '' : 'hidden'}>${esc(t.abstract)}</div>` : ''}
    </div>`;
  }

  // ---------- 视图
  function viewOverview() {
    const withAbs = talks.filter((t) => (t.abstract || '').length > 0).length;
    return `
      <div class="cards">
        ${card(sessions.length, '场次')}
        ${card(talks.length, '报告')}
        ${card(authorCount.size, '作者')}
        ${card(affCount.size, '报告人学校 / 机构')}
        ${card(topics.filter((topic) => topic !== '__unclassified').length, '主题')}
        ${card(withAbs, '含摘要')}
      </div>
      <h3>按天</h3>${dayBars(dayCount)}
      <h3>主题分布</h3>${bars(topicCount, 1, 20)}
      <h3>报告人学校 / 机构</h3>${bars(affCount, 1, 20)}
    `;
  }

  function viewSessions() {
    const list = sessIndex.filter(({ s, h }) => {
      if (state.day && s.dayRaw !== state.day) return false;
      if (state.topic && topicOf(s) !== state.topic) return false;
      if (state.type && s.type !== state.type) return false;
      if (state.q && !h.includes(state.q.toLowerCase()) && !(talksByEvt.get(s.evt) || []).some((t) => hay(t).includes(state.q.toLowerCase()))) return false;
      if ((state.org || state.paper || state.author) && !(talksByEvt.get(s.evt) || []).some((t) => matchesTalk({ t, h: hay(t) }))) return false;
      return true;
    }).map((x) => x.s);

    const shown = list.slice(0, state.limit);
    return `
      ${filters()}
      <p class="note">共 ${list.length} 场，显示 ${shown.length} 场</p>
      <div class="list">${shown.map((s) => {
        const open = state.open.has(s.evt);
        const sessionText = sessIndex.find((entry) => entry.s.evt === s.evt).h;
        const ts = (talksByEvt.get(s.evt) || []).filter((t) => matchesTalk({ t, h: hay(t) + ' ' + sessionText }));
        return `<div class="item">
          <div class="row1"><span class="code">${esc(s.code || '—')}</span><span class="title">${esc(s.title || s.listTitle)}</span></div>
          <div class="meta">${esc(s.dayRaw)} ${esc(s.timeRange)} · ${esc(s.room)} · ${esc(s.type)}</div>
          <div class="tags"><span class="tag">${esc(topicLabel(topicOf(s)))}</span>${(s.chairs || []).length ? `<span class="tag">主席 ${esc(s.chairs.join(' / '))}</span>` : ''}<span class="tag">${ts.length} 个报告</span></div>
          ${ts.length ? `<button class="link" data-toggle="${s.evt}">${open ? '收起' : '展开报告'}</button>` : ''}
          ${open ? ts.map((t) => talkBlock(t)).join('') : ''}
        </div>`;
      }).join('')}</div>
      ${list.length > shown.length ? `<button class="more" id="more">显示更多</button>` : ''}
    `;
  }

  function viewTalks() {
    const list = talkIndex.filter(matchesTalk);
    const shown = list.slice(0, state.limit);
    return `
      ${filters()}
      <p class="note">共 ${list.length} 个报告，显示 ${shown.length} 个</p>
      ${list.length ? '' : '<p class="empty">没有符合条件的报告。</p>'}
      <div class="list">${shown.map(({ t }) => {
        const open = state.open.has('a' + t.evdid);
        return `<div class="item" data-talk-id="${t.evdid}">
          <div class="row1"><span class="code">${esc(t.sessionCode || '—')}</span><span class="title">${esc(t.title)}</span></div>
          <div class="meta">${esc(t.dayRaw)} ${esc(t.timeRange)} · ${esc(t.room)} · ${esc(topicLabel(topicOf(t)))}</div>
          <div class="authors">${authorsHtml(t)}</div>
          ${paperHtml(t)}
          ${t.abstract ? `<div class="abstract" ${open ? '' : 'hidden'} id="abs-${t.evdid}">${esc(t.abstract)}</div><button class="link" data-abs="${t.evdid}">${open ? '收起摘要' : '展开摘要'}</button>` : ''}
        </div>`;
      }).join('')}</div>
      ${list.length > shown.length ? `<button class="more" id="more">显示更多</button>` : ''}
    `;
  }

  function viewAuthors() {
    const rows = [...authorCount.entries()].sort((a, b) => b[1] - a[1]);
    const filtered = state.q ? rows.filter(([n]) => n.toLowerCase().includes(state.q.toLowerCase())) : rows;
    const shown = filtered.slice(0, state.limit);
    return `
      <div class="filters"><label>搜索<input type="search" id="q" value="${esc(state.q)}"></label></div>
      <p class="note">共 ${filtered.length} 位作者，显示 ${shown.length} 位</p>
      <div class="list">${shown.map(([n, c]) => {
        const ts = talks.filter((t) => (t.authors || []).some((a) => a.name === n));
        const affs = [...new Set(ts.flatMap((t) => (t.authors || []).filter((a) => a.name === n).map((a) => a.affiliation)).filter(Boolean))];
        return `<div class="item"><div class="row1"><button class="link title" data-author="${esc(n)}">${esc(n)}</button><span class="code">${c}</span></div>
          <div class="meta">${esc(affs.join(' / '))}</div>
          <div class="tags">${ts.slice(0, 3).map((t) => `<span class="tag">${esc(t.sessionCode || '—')} ${esc(t.title.slice(0, 42))}${t.title.length > 42 ? '…' : ''}</span>`).join('')}</div></div>`;
      }).join('')}</div>
      ${filtered.length > shown.length ? `<button class="more" id="more">显示更多</button>` : ''}
    `;
  }

  function viewOrgs() {
    const rows = [...affCount.entries()].sort((a, b) => b[1] - a[1]);
    const filtered = state.q ? rows.filter(([n]) => n.toLowerCase().includes(canonicalOrg(state.q).toLowerCase())) : rows;
    const shown = filtered.slice(0, state.limit);
    return `
      <div class="filters"><label>搜索<input type="search" id="q" value="${esc(state.q)}"></label></div>
      <p class="note">共 ${filtered.length} 个报告人学校 / 机构，显示 ${shown.length} 个</p>
      <div class="list">${shown.map(([n, c]) => `<div class="item"><div class="row1"><button class="link title" data-org="${esc(n)}">${esc(n)}</button><span class="code">${c}</span></div></div>`).join('')}</div>
      ${filtered.length > shown.length ? `<button class="more" id="more">显示更多</button>` : ''}
    `;
  }

  const views = { overview: viewOverview, sessions: viewSessions, talks: viewTalks, authors: viewAuthors, orgs: viewOrgs };

  function render() {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
    app.innerHTML = views[state.tab]();
    saveLocation();
  }

  document.querySelector('nav.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    state.limit = 80;
    state.open.clear();
    render();
  });

  app.addEventListener('input', (e) => {
    if (e.target.id === 'q' && !e.isComposing) {
      state.q = e.target.value;
      state.limit = 80;
      const pos = e.target.selectionStart;
      render();
      const nq = el('q');
      if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
    }
  });

  app.addEventListener('compositionend', (e) => {
    if (e.target.id === 'q') e.target.dispatchEvent(new Event('input', { bubbles: true }));
  });
  app.addEventListener('keydown', (e) => {
    if (e.target.id === 'org' && e.key === 'Enter') e.target.blur();
  });
  app.addEventListener('change', (e) => {
    if (!filterKeys.includes(e.target.id)) return;
    state[e.target.id] = e.target.id === 'org' ? canonicalOrg(e.target.value) : e.target.value;
    state.limit = 80;
    render();
  });

  app.addEventListener('click', (e) => {
    const tgl = e.target.closest('[data-toggle]');
    if (tgl) {
      const k = Number(tgl.dataset.toggle);
      state.open.has(k) ? state.open.delete(k) : state.open.add(k);
      render();
      return;
    }
    const abs = e.target.closest('[data-abs]');
    if (abs) {
      const k = 'a' + abs.dataset.abs;
      const box = document.getElementById('abs-' + abs.dataset.abs);
      state.open.has(k) ? state.open.delete(k) : state.open.add(k);
      if (box) box.hidden = !box.hidden;
      abs.textContent = box && !box.hidden ? '收起摘要' : '展开摘要';
      return;
    }
    if (e.target.id === 'more') {
      state.limit += 120;
      render();
      return;
    }
    if (e.target.id === 'clear') {
      const tab = state.tab;
      Object.assign(state, defaults, { tab });
      state.open.clear();
      render();
      return;
    }
    const organization = e.target.closest('[data-org]');
    const author = e.target.closest('[data-author]');
    if (organization || author) {
      Object.assign(state, defaults);
      state.org = organization?.dataset.org || '';
      state.author = author?.dataset.author || '';
      state.open.clear();
      render();
    }
  });

  window.addEventListener('popstate', () => { readLocation(); render(); });
  render();
})();
