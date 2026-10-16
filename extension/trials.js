// Trial end dates and renewals. Customer lists: next to a "Trialing" status (RC's list has no
// expiry column; each trialing customer's live subscription has it). Transaction tables: a capsule
// after a future expiry date says whether it renews (a trial converts) or expires, from the
// unsubscribe / billing-issue fields of RC's own transaction data (main.js, Load more).
(() => {
  const HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };
  const MAX_PARALLEL = 4;
  const cache = new Map(); // "projectId/customerId" → Promise<Date | null>
  const queue = [];
  let running = 0;
  let enabled = true;

  const rel = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function relative(date) {
    const days = (date - Date.now()) / 86400000;
    return Math.abs(days) < 1 ? rel.format(Math.round(days * 24), 'hour') : rel.format(Math.round(days), 'day');
  }

  function pump() {
    while (running < MAX_PARALLEL && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  }

  function trialEnd(projectId, customerId) {
    const key = `${projectId}/${customerId}`;
    if (!cache.has(key)) {
      cache.set(key, new Promise((resolve) => {
        queue.push(async () => {
          try {
            const res = await fetch(`/v1/developers/me/projects/${projectId}/subscribers/${encodeURIComponent(customerId)}`,
              { credentials: 'include', headers: HEADERS });
            const body = await res.json();
            const live = body.subscriber?.subscription_status?.live || [];
            const trial = live.filter((s) => s.is_trial && s.expires_date)
              .sort((a, b) => Date.parse(b.expires_date) - Date.parse(a.expires_date))[0];
            resolve(trial ? new Date(trial.expires_date) : null);
          } catch { resolve(null); }
        });
        pump();
      }));
    }
    return cache.get(key);
  }

  // "customer|product" → [unsubscribed at, billing issue at, purchased]; the latest purchase wins
  const status = new Map();
  document.addEventListener('rcx-tx-status', (e) => {
    try {
      for (const [customer, product, unsub, billing, purchased] of JSON.parse(e.detail)) {
        const key = `${customer}|${product}`;
        if (!status.has(key) || status.get(key)[2] < purchased) status.set(key, [unsub, billing, purchased]);
      }
      apply();
    } catch { /* ignore */ }
  });
  document.dispatchEvent(new CustomEvent('rcx-tx-status-get'));

  // Transactions tables (Overview, All projects and per project): renews / expires after the date.
  function labelTransactions() {
    for (const header of document.querySelectorAll('[role=columnheader]')) {
      if (header.textContent.trim() !== 'Expires') continue;
      const cols = [...header.parentElement.children].map((h) => h.textContent.trim());
      const [exp, type, product] = ['Expires', 'Type', 'Product'].map((c) => cols.indexOf(c));
      if (type < 0 || product < 0) continue;
      for (const row of header.closest('[role=table]').querySelectorAll(':scope > [role=row]')) {
        const cell = row.children[exp];
        if (!cell || cell === header) continue;
        let tag = cell.querySelector('.rcx-renew');
        const date = cell.textContent.replace(tag?.textContent || '', '');
        const customer = decodeURIComponent(row.querySelector('a[href*="/customers/"]')?.getAttribute('href')?.match(/\/customers\/([^/?#]+)/)?.[1] || '');
        const s = /^in /.test(date.trim()) && status.get(`${customer}|${row.children[product]?.textContent.trim()}`);
        if (!s) { tag?.remove(); continue; }
        const trial = row.children[type]?.textContent.trim() === 'Trial'; // still in trial (not Trial Converted)
        const [kind, text, title] = s[1] ? ['warn', '! billing issue', 'Billing issue: renewal payment is failing']
          : s[0] ? ['off', '✕ expires', `Auto-renew turned off ${full.format(new Date(s[0]))}`]
          : ['on', trial ? '✓ converts' : '✓ renews', trial ? 'Trial converts to paid' : 'Auto-renew is on'];
        if (!tag) cell.append(tag = Object.assign(document.createElement('span'), { className: 'rcx-renew' }));
        if (tag.textContent !== text) tag.textContent = text;
        tag.className = `rcx-renew rcx-${kind}`;
        tag.title = title;
      }
    }
  }

  function apply() {
    if (!enabled) return;
    labelTransactions();
    if (!/\/customer-lists\//.test(location.pathname)) return;
    const header = [...document.querySelectorAll('[role=columnheader],th')].find((h) => h.textContent.trim() === 'Subscription Status');
    if (!header) return;
    const col = [...header.parentElement.children].indexOf(header);
    const rows = header.closest('[role=table],table')?.querySelectorAll('[role=row],tr') || [];
    for (const row of rows) {
      const cell = row.children[col];
      if (!cell || cell === header || cell.querySelector('.rcx-trial') || !/trial/i.test(cell.textContent)) continue;
      const m = row.querySelector('a[href*="/customers/"]')?.getAttribute('href')?.match(/projects\/([^/]+)\/customers\/([^/?#]+)/);
      if (!m) continue;
      const tag = Object.assign(document.createElement('span'), { className: 'rcx-trial', textContent: '…' });
      cell.classList.add('rcx-trial-cell'); // narrow column: date goes on its own line under the badge
      cell.append(tag);
      trialEnd(m[1], decodeURIComponent(m[2])).then((date) => {
        if (!date) { tag.remove(); return; }
        tag.textContent = `${date < Date.now() ? 'Ended' : 'Ends'} ${relative(date)}`;
        tag.title = full.format(date);
      });
    }
  }

  chrome.storage.sync.get({ trialEnds: true }, (r) => { enabled = r.trialEnds; apply(); });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync' || !c.trialEnds) return;
    enabled = c.trialEnds.newValue;
    if (!enabled) document.querySelectorAll('.rcx-trial, .rcx-renew').forEach((t) => t.remove());
    apply();
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; apply(); }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
