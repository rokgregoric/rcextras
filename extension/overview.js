// Overview cards: a Σ toggle per chart (running total, applied by main.js as data loads) and a
// period picker on the "Last N days" label of Revenue and New Customers, set per card (Active
// Customers is unique over RC's fixed 28 days). Changes refetch the charts in place, no reload.
(() => {
  const CARDS = { revenue: 'revenue_v3', customers_new: 'customers_new_v3', customers_active: 'customers_active_v3' };
  const PERIOD_CARDS = ['revenue', 'customers_new'];
  const PERIODS = [7, 14, 28, 30, 60, 90, 180, 365];
  const ds = document.documentElement.dataset;

  let charts = []; // cumulative charts
  let periods = {}; // chart → days (missing = RC's 28)
  let menu = null;

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  const closeMenu = () => { menu?.remove(); menu = null; };

  function refresh() {
    ds.rcxCumulative = charts.join(',');
    ds.rcxDays = Object.entries(periods).map(([k, v]) => `${k}:${v}`).join(',');
    if (['overview', 'charts'].includes(rcx.page().view)) {
      document.dispatchEvent(new CustomEvent('rcx-refresh')); // handled in the page by main.js
    }
  }

  // ---- Σ per card ----
  function addSigma(name, card) {
    const icon = [...card.querySelectorAll('svg.MuiSvgIcon-root')]
      .find((s) => /icons\/(currency-usd|user-add|person)/.test(s.querySelector('use')?.getAttribute('href') || ''));
    if (!icon) return;
    let button = card.querySelector('.rcx-sigma');
    if (!button) {
      button = Object.assign(document.createElement('button'), { type: 'button', className: 'rcx-sigma', textContent: 'Σ' });
      button.addEventListener('mousedown', (e) => e.stopPropagation());
      button.addEventListener('click', (e) => {
        stop(e);
        const next = charts.includes(name) ? charts.filter((c) => c !== name) : [...charts, name];
        chrome.storage.sync.set({ cumulativeCharts: next });
      });
      icon.before(button);
    }
    const on = charts.includes(name);
    button.classList.toggle('rcx-on', on);
    button.title = on ? 'Running total (RC Extras). Click for per-day values.' : 'Show as running total (RC Extras)';
  }

  // ---- period picker on the card's "Last N days" label ----
  function openPeriodMenu(name, label) {
    if (menu) { closeMenu(); return; }
    const card = label.closest('a');
    const cs = getComputedStyle(card);
    menu = Object.assign(document.createElement('div'), { className: 'rcx-menu' });
    menu.style.background = cs.backgroundColor;
    menu.style.color = cs.color;
    const current = periods[name] || 28;
    for (const n of PERIODS) {
      const item = Object.assign(document.createElement('button'), { type: 'button', className: 'rcx-menu-item', textContent: `Last ${n} days` });
      if (n === current) item.classList.add('rcx-on');
      item.addEventListener('click', () => {
        const next = { ...periods };
        if (n === 28) delete next[name]; else next[name] = n;
        chrome.storage.sync.set({ periodDays: next });
        closeMenu();
      });
      menu.append(item);
    }
    const r = label.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${r.left}px`;
    document.body.append(menu);
  }

  function addPeriod(name, card) {
    const label = [...card.querySelectorAll('p,span,div')].find((e) => e.childElementCount === 0 && /^Last \d+ days$/.test(e.textContent.trim()));
    if (!label || label.classList.contains('rcx-period')) return;
    label.classList.add('rcx-period');
    label.title = 'Change period for this card (RC Extras)';
    label.addEventListener('mousedown', (e) => e.stopPropagation());
    label.addEventListener('click', (e) => { stop(e); openPeriodMenu(name, label); });
  }

  function apply() {
    for (const [name, chart] of Object.entries(CARDS)) {
      for (const card of rcx.cards(chart)) {
        addSigma(name, card);
        if (PERIOD_CARDS.includes(name)) addPeriod(name, card);
      }
    }
  }

  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);

  chrome.storage.sync.get({ cumulativeCharts: [], periodDays: {} }, (r) => {
    charts = r.cumulativeCharts;
    periods = r.periodDays;
    apply();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync' || (!c.cumulativeCharts && !c.periodDays)) return;
    if (c.cumulativeCharts) charts = c.cumulativeCharts.newValue || [];
    if (c.periodDays) periods = c.periodDays.newValue || {};
    apply();
    refresh();
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
