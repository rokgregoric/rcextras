// "Load more" under the All projects "Recent transactions" table. RC shows at most 20 rows there
// with no paging (single projects already have their own Load more). Extra rows are clones of
// RC's own rows, filled from the same v1 endpoint, paged with start_from (main.js records the cursor).
(() => {
  const API = '/v1/developers/me/transactions';
  const HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
  const PAGE = 25;

  let enabled = true;
  let state = null; // { stamp, cursor, params, buffer: [], done, loading }
  let projectsByApp = null; // Promise<Map projectId → { id, icon, name }>

  const rcGet = async (path) => {
    const res = await fetch(path, { credentials: 'include', headers: HEADERS });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  };

  // Transaction `app.id` is the project id; the project list has names and icons.
  function appProjects() {
    projectsByApp ??= rcGet('/internal/v1/developers/me/projects')
      .then((list) => new Map(list.map((p) => [p.id, { id: p.id, icon: p.icon_url, name: p.name }])))
      .catch(() => new Map());
    return projectsByApp;
  }

  function findTable() {
    const page = rcx.page(); // All projects only: projects use transactions_v2, which has RC's own Load more
    if (page.scope !== 'all' || page.view !== 'overview') return null;
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,p')]
      .find((e) => e.childElementCount === 0 && /^Recent (sandbox )?transactions$/.test(e.textContent.trim()));
    let el = heading;
    for (let i = 0; i < 10 && el; i++) {
      const table = el.querySelector('[role=table]');
      if (table) return table;
      el = el.parentElement;
    }
    return null;
  }

  const nativeRows = (table) => [...table.querySelectorAll(':scope > [role=row]:not(.rcx-row)')].slice(1);

  // ---- formatting (matches RC's table) ----
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const utc = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true });
  const rel = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

  function relative(date) {
    const s = (date - Date.now()) / 1000;
    const a = Math.abs(s);
    const [v, unit] = a < 3600 ? [s / 60, 'minute'] : a < 86400 ? [s / 3600, 'hour'] : a < 86400 * 30 ? [s / 86400, 'day']
      : a < 86400 * 365 ? [s / (86400 * 30), 'month'] : [s / (86400 * 365), 'year'];
    return rel.format(Math.round(v) || (s < 0 ? -1 : 1), unit);
  }

  function typeOf(t) {
    if (t.was_refunded) return 'Refund';
    if (t.ownership_type === 'FAMILY_SHARED') return 'Family Shared';
    if (t.is_trial_period) {
      if (t.billing_issues_detected_at) return 'Trial Issue';
      if (t.unsubscribe_detected_at) return 'Trial Canceled';
      return Date.parse(t.expires_date) < Date.now() ? 'Trial Ended' : 'Trial';
    }
    if (t.is_trial_conversion) return 'Trial Converted';
    if (t.is_renewal) return 'Renewal';
    if (!t.expires_date) return 'One Time';
    return 'New Sub';
  }

  const mask = (id) => (id.length > 10 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : id);

  function setText(el, text) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    if (!node) { el.textContent = text; return; }
    node.data = text;
    while ((node = walker.nextNode())) node.data = '';
  }

  // ---- row rendering ----
  function buildRow(t, rows, projects) {
    const anon = t.subscriber_id.startsWith('$RCAnonymousID:');
    const tpl = rows.find((r) => /Anonymous/i.test(r.children[0].textContent) === anon) || rows[0];
    const row = tpl.cloneNode(true);
    row.classList.add('rcx-row');
    const cells = row.children;
    const project = projects.get(t.app?.id) || {};

    // App User ID: flag, link, masked like RC (unless RC currently shows full IDs)
    const flag = cells[0].querySelector('img');
    if (flag) {
      if (t.subscriber_country_code) flag.src = `/country-flags/${t.subscriber_country_code.toLowerCase()}.svg`;
      else flag.style.visibility = 'hidden';
    }
    const link = cells[0].querySelector('a');
    if (link) {
      if (project.id) link.href = `/projects/${project.id}/customers/${encodeURIComponent(t.subscriber_id)}`;
      const id = anon ? t.subscriber_id.slice('$RCAnonymousID:'.length) : t.subscriber_id;
      const showFull = !tpl.children[0].textContent.includes('••••');
      const label = showFull ? id : mask(id);
      // The ID is the text node that isn't RC's "Anonymous" badge
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      let idText = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/^Anonymous$/i.test(n.data.trim()) && n.data.trim()) { idText = n; break; }
      }
      if (idText) idText.data = label;
      else link.append(label);
    }
    cells[0].querySelector('button')?.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      navigator.clipboard?.writeText(t.subscriber_id);
    });

    // Project
    const plink = cells[1].querySelector('a');
    if (plink) {
      plink.href = project.id ? `/projects/${project.id}/overview` : '#';
      plink.title = project.name || t.app?.name || '';
      const img = plink.querySelector('img');
      if (img && project.icon) img.src = project.icon;
      else if (img) img.replaceWith(Object.assign(document.createElement('span'), { className: 'rcx-letter', textContent: (project.name || t.app?.name || '?')[0] }));
    }

    setText(cells[2], t.store || '');
    setText(cells[3], t.product_display_name || t.product_identifier || '');

    const purchased = new Date(t.purchase_date);
    const pAbbr = cells[4].querySelector('abbr') || cells[4];
    setText(pAbbr, relative(purchased));
    pAbbr.title = `${utc.format(purchased)} UTC`;

    const eAbbr = cells[5].querySelector('abbr') || cells[5];
    if (t.expires_date) {
      const expires = new Date(t.expires_date);
      setText(eAbbr, relative(expires));
      eAbbr.title = `${utc.format(expires)} UTC`;
    } else {
      setText(eAbbr, 'No expiration');
      eAbbr.removeAttribute('title');
    }

    setText(cells[6], t.revenue > 0 ? usd.format(t.revenue) : '–');

    const type = typeOf(t);
    const badge = rows.find((r) => r.children[7].textContent.trim() === type);
    if (badge) cells[7].innerHTML = badge.children[7].innerHTML;
    else setText(cells[7], type);
    return row;
  }

  // ---- paging ----
  async function loadMore(table, button) {
    if (!state || state.loading || state.done) return;
    state.loading = true;
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
      while (state.buffer.length < PAGE && !state.done) {
        const q = new URLSearchParams({ ...state.params, start_from: state.cursor, limit: String(PAGE) });
        const body = await rcGet(`${API}?${q}`);
        const txs = body.transactions || [];
        state.buffer.push(...txs);
        document.dispatchEvent(new CustomEvent('rcx-tx-status', { // renews/expires capsule (trials.js)
          detail: JSON.stringify(txs.map((t) => [t.subscriber_id, t.product_display_name || t.product_identifier, t.unsubscribe_detected_at, t.billing_issues_detected_at, t.purchase_date])),
        }));
        if (!txs.length || !body.last_purchase_ms || body.last_purchase_ms >= state.cursor) state.done = true;
        else state.cursor = body.last_purchase_ms;
      }
      const rows = nativeRows(table);
      const projects = await appProjects();
      const frag = document.createDocumentFragment();
      for (const t of state.buffer.splice(0, PAGE)) frag.append(buildRow(t, rows, projects));
      table.append(frag);
    } catch {
      state.done = true;
    }
    state.loading = false;
    button.disabled = false;
    button.textContent = state.done && !state.buffer.length ? 'No more transactions' : 'Load more';
    if (state.done && !state.buffer.length) button.disabled = true;
  }

  function sync() {
    const table = findTable();
    const old = document.querySelector('.rcx-more');
    if (!enabled || !table) { old?.remove(); return; }

    let info = null;
    try { info = JSON.parse(document.documentElement.dataset.rcxTx || 'null'); } catch { /* ignore */ }
    const rows = nativeRows(table);
    if (!info || !info.cursor || rows.length < info.count || info.count < 20) { old?.remove(); return; }

    if (!state || state.stamp !== info.stamp) { // new data from RC (filter, sandbox, refresh)
      table.querySelectorAll(':scope > .rcx-row').forEach((r) => r.remove());
      state = { stamp: info.stamp, cursor: info.cursor, params: info.params, buffer: [], done: false, loading: false };
    }
    if (old && old.previousElementSibling === table) return;
    old?.remove();
    const button = Object.assign(document.createElement('button'), { className: 'rcx-more', type: 'button', textContent: 'Load more' });
    button.addEventListener('click', () => loadMore(table, button));
    table.after(button);
  }

  function setEnabled(on) {
    enabled = on;
    document.documentElement.dataset.rcxMore = on ? 'on' : 'off';
    if (!on) document.querySelectorAll('.rcx-row').forEach((r) => r.remove());
    sync();
  }

  chrome.storage.sync.get({ moreTransactions: true }, (r) => setEnabled(r.moreTransactions));
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.moreTransactions) setEnabled(c.moreTransactions.newValue); });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; sync(); }, 200);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-rcx-tx'] });
})();
