// Runs in the page (MAIN world) at document_start and adjusts RC's own API traffic.
// Settings arrive as data attributes on <html> (set by sync.js / overview.js):
//   data-rcx-more        "off" disables the transactions tweak
//   data-rcx-cumulative  charts shown as running totals, e.g. "revenue,customers_new"
//   data-rcx-days        Overview period per card, e.g. "revenue:7,customers_new:90" (RC's default 28)
// Renew/expire status of transaction rows goes to trials.js as `rcx-tx-status` events.
(() => {
  const TX = /\/v1\/developers\/me\/transactions(\?|$)/;
  const TX_ANY = /\/v1\/developers\/me\/transactions(_v2)?(\?|$)/; // v2: single projects
  const CHART = /\/v1\/developers\/me\/charts\/([a-z_]+)_v3(\?|$)/;
  const OVERVIEW = /\/v1\/developers\/me\/charts\/overview(\?|$)/;
  const PERIOD_CHARTS = new Set(['revenue', 'customers_new']); // Active Customers stays on RC's 28 days
  const DAY = 86400000;
  const nativeFetch = window.fetch;
  const ds = document.documentElement.dataset;

  const daysFor = (name) => {
    const hit = (ds.rcxDays || '').split(',').map((p) => p.split(':')).find(([k]) => k === name);
    return Number(hit?.[1]) || 28;
  };
  const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
  const toUrl = (input) => {
    try { return typeof input === 'string' ? input : input instanceof Request ? input.url : String(input); } catch { return ''; }
  };
  const withUrl = (input, u) => (input instanceof Request ? new Request(u.toString(), input) : u.toString());
  const json = (body, res) => new Response(JSON.stringify(body), { status: res.status, statusText: res.statusText, headers: res.headers });

  // Running total per measure/segment in time order; values keep RC's original order.
  async function cumulative(res) {
    try {
      const body = await res.clone().json();
      if (!Array.isArray(body.values)) return res;
      const sums = new Map();
      const out = body.values.map((v) => ({ ...v }));
      out.map((v, i) => [v, i]).sort(([a, i], [b, j]) => a.cohort - b.cohort || i - j).forEach(([v]) => {
        const key = `${v.measure}|${v.segment ?? ''}`;
        v.value = (sums.get(key) || 0) + (Number(v.value) || 0);
        sums.set(key, v.value);
      });
      body.values = out;
      return json(body, res);
    } catch { return res; }
  }

  // Overview numbers come from charts/overview, which is always 28 days. For another period,
  // take Revenue and New Customers totals from the charts for that range. Active Customers
  // (unique over the period) can't be rebuilt from daily data, so it keeps RC's 28 days.
  async function overviewForPeriod(res, u) {
    const want = [['revenue', 'revenue', (k) => /revenue|proceeds/i.test(k)], ['customers_new', 'new_customers', (k) => /customer/i.test(k)]]
      .map(([chart, metric, pick]) => ({ chart, metric, pick, n: daysFor(chart) }))
      .filter((w) => w.n !== 28);
    if (!want.length) return res;
    try {
      const body = await res.clone().json();
      const total = async ({ chart, pick, n }) => {
        const params = new URLSearchParams({ start_date: isoDay(Date.now() - n * DAY), end_date: isoDay(Date.now()), resolution: '0', is_sparkline: 'true' });
        for (const k of ['app_uuid', 'sandbox_mode', 'revenue_type']) if (u.searchParams.has(k)) params.set(k, u.searchParams.get(k));
        const r = await nativeFetch(`/v1/developers/me/charts/${chart}_v3?${params}`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const t = (await r.json()).summary?.total || {};
        const key = Object.keys(t).find(pick);
        return key == null ? null : t[key];
      };
      const totals = await Promise.all(want.map(total));
      for (const m of body.metrics || []) {
        const i = want.findIndex((w) => w.metric === (m.id || m.name));
        if (i >= 0 && totals[i] != null) Object.assign(m, { value: totals[i], description: `Last ${want[i].n} days`, period: `P${want[i].n}D` });
      }
      return json(body, res);
    } catch { return res; }
  }

  // [customer, product, unsubscribed at, billing issue at, purchased] per row, for the Expires capsule
  const statuses = [];
  const shareStatus = (rows) => document.dispatchEvent(new CustomEvent('rcx-tx-status', { detail: JSON.stringify(rows) }));
  async function recordStatus(res) {
    try {
      const rows = ((await res.clone().json()).transactions || [])
        .map((t) => [t.subscriber_id, t.product_display_name || t.product_identifier, t.unsubscribe_detected_at, t.billing_issues_detected_at, t.purchase_date]);
      statuses.push(...rows);
      shareStatus(rows);
    } catch { /* not JSON */ }
    return res;
  }
  document.addEventListener('rcx-tx-status-get', () => shareStatus(statuses)); // trials.js loads after the first responses

  async function transactions(input, init, url) {
    const u = new URL(url, location.origin);
    if (u.searchParams.has('start_from')) return nativeFetch(input, init);
    // RC renders at most 20 rows here and asks for 10: ask for 20, remember cursor for "Load more"
    if (!u.searchParams.has('limit')) u.searchParams.set('limit', '20');
    const res = await nativeFetch(withUrl(input, u), init);
    try {
      const body = await res.clone().json();
      ds.rcxTx = JSON.stringify({
        params: Object.fromEntries([...u.searchParams].filter(([k]) => k !== 'limit')),
        cursor: body.last_purchase_ms ?? null,
        count: body.transactions?.length ?? 0,
        stamp: `${u.search}|${body.transactions?.[0]?.store_transaction_identifier ?? ''}`,
      });
    } catch { /* not JSON: leave RC alone */ }
    return res;
  }

  // In-place refresh instead of a page reload: content scripts fire `rcx-refresh` after a setting
  // changes; RC's chart queries (RTK Query tag "Charts") then refetch through this patch.
  let store = null;
  function findStore() {
    if (store) return store;
    const root = document.getElementById('root');
    const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    const stack = key ? [root[key]] : [];
    for (let n = 0; stack.length && n < 20000; n++) {
      const f = stack.pop();
      const s = f?.memoizedProps?.store;
      if (s && typeof s.dispatch === 'function' && typeof s.getState === 'function') return (store = s);
      if (f?.child) stack.push(f.child);
      if (f?.sibling) stack.push(f.sibling);
    }
    return null;
  }
  document.addEventListener('rcx-refresh', () => {
    const s = findStore();
    const state = s?.getState() || {};
    const api = Object.keys(state).find((k) => {
      const tags = state[k]?.provided?.tags || state[k]?.provided;
      return tags && typeof tags === 'object' && 'Charts' in tags;
    });
    if (!api) return; // nothing cached to refresh; next load picks the settings up
    s.dispatch({ type: `${api}/invalidateTags`, payload: ['Charts'] });
  });

  window.fetch = async function (input, init) {
    const url = toUrl(input);

    const chart = url.match(CHART);
    if (chart) {
      const u = new URL(url, location.origin);
      const name = chart[1];
      if (u.searchParams.get('is_sparkline') === 'true' && PERIOD_CHARTS.has(name) && daysFor(name) !== 28 && u.searchParams.has('end_date')) {
        u.searchParams.set('start_date', isoDay(Date.parse(u.searchParams.get('end_date')) - daysFor(name) * DAY));
        input = withUrl(input, u);
      }
      const res = await nativeFetch.call(this, input, init);
      return (ds.rcxCumulative || '').split(',').includes(name) ? cumulative(res) : res;
    }
    if (OVERVIEW.test(url)) return overviewForPeriod(await nativeFetch.call(this, input, init), new URL(url, location.origin));
    if (TX.test(url) && ds.rcxMore !== 'off') return recordStatus(await transactions(input, init, url));
    if (TX_ANY.test(url)) return recordStatus(await nativeFetch.call(this, input, init));
    return nativeFetch.call(this, input, init);
  };
})();
