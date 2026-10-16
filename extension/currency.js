// Display settings: dollar amounts in your currency (ECB rates via background.js), and the
// Overview "Revenue type" default (RC resets it to Revenue on every load).
(() => {
  // ---- currency ----
  const MONEY = /^\s*\$\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?\s?([KMB])?\s*$/; // "$1,305", "$6.06", "$1.2K"
  const SCALE = { K: 1e3, M: 1e6, B: 1e9 };
  const seen = new WeakMap(); // text node → { orig, shown }
  let currency = 'USD';
  let rate = 1;

  function convert(text) {
    const m = text.match(MONEY);
    if (!m) return null;
    const decimals = m[2] ? m[2].length - 1 : 0;
    const usd = parseFloat(m[1].replace(/,/g, '') + (m[2] || '')) * (SCALE[m[3]] || 1);
    const value = usd * rate;
    const fmt = new Intl.NumberFormat(undefined, {
      style: 'currency', currency,
      notation: m[3] ? 'compact' : 'standard',
      minimumFractionDigits: m[3] ? 0 : decimals,
      maximumFractionDigits: m[3] ? 1 : decimals,
    });
    return fmt.format(value);
  }

  function applyCurrency(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('input,textarea,[contenteditable=true],script,style,.rcx-menu,.rcx-cur') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const prev = seen.get(node);
      if (prev && node.data === prev.shown) continue;
      const orig = node.data; // new text from RC (or first visit)
      if (currency === 'USD') {
        if (prev) { node.data = prev.orig; seen.delete(node); }
        continue;
      }
      const shown = convert(orig);
      if (!shown) continue;
      seen.set(node, { orig, shown });
      node.data = shown;
      node.parentElement.title = `${orig.trim()} USD`;
    }
  }

  async function setCurrency(code) {
    if (code === 'USD') {
      currency = 'USD'; rate = 1;
    } else {
      const rates = await chrome.runtime.sendMessage({ type: 'rates' }).catch(() => null);
      if (!rates?.[code]) return; // keep USD if rates are unavailable
      currency = code; rate = rates[code];
    }
    // Re-render everything from the original USD text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const prev = seen.get(node);
      if (prev && node.data === prev.shown) { node.data = prev.orig; seen.delete(node); }
    }
    applyCurrency();
  }

  // ---- default revenue type ----
  // RC renders the card before its data and redraws it once loaded, which closes a menu opened
  // too early. So wait until the button has been stable for a moment, then retry a few times.
  // Once it matches (or after 3 tries) leave it alone, so a manual change sticks.
  let revenueType = 'Revenue';
  let rt = { page: '', done: false, tries: 0, button: null, since: 0 };
  let rtTimer = 0;

  function applyRevenueType() {
    clearTimeout(rtTimer);
    if (revenueType === 'Revenue' && rt.tries === 0) return;
    const page = location.pathname + location.search;
    if (rt.page !== page) rt = { page, done: false, tries: 0, button: null, since: 0 };
    if (rt.done) return;
    const button = document.querySelector('button[aria-label^="Revenue type:"]');
    if (!button) return;
    if (button.getAttribute('aria-label') === `Revenue type: ${revenueType}`) { rt.done = true; return; }
    if (button !== rt.button) { rt.button = button; rt.since = Date.now(); }
    if (Date.now() - rt.since < 1200) { rtTimer = setTimeout(applyRevenueType, 400); return; }
    if (rt.tries >= 3) { rt.done = true; return; }
    rt.tries++;
    button.click();
    let polls = 0;
    const pick = () => {
      const option = [...document.querySelectorAll('[role=menuitem],[role=option]')].find((e) => e.textContent.trim() === revenueType);
      if (option) option.click();
      else if (++polls < 20) return void setTimeout(pick, 50);
      rt.since = Date.now();
      rtTimer = setTimeout(applyRevenueType, 600); // verify, retry if RC closed it
    };
    setTimeout(pick, 50);
  }

  // ---- currency picker on the Revenue card ($ icon) ----
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'HKD', 'SGD', 'KRW', 'INR', 'IDR', 'MYR', 'PHP', 'THB',
    'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ILS', 'ZAR', 'BRL', 'MXN'];
  const symbol = (code) => new Intl.NumberFormat(undefined, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0).find((p) => p.type === 'currency')?.value || code;
  let menu = null;

  function closeMenu() { menu?.remove(); menu = null; }

  function openMenu(button) {
    if (menu) { closeMenu(); return; }
    const card = button.closest('a') || document.body;
    const cs = getComputedStyle(card);
    menu = Object.assign(document.createElement('div'), { className: 'rcx-menu' });
    menu.style.background = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : getComputedStyle(document.body).backgroundColor;
    menu.style.color = cs.color;


    for (const code of CURRENCIES) {
      const item = Object.assign(document.createElement('button'), { type: 'button', className: 'rcx-menu-item' });
      const sym = symbol(code);
      item.textContent = sym === code ? code : `${sym}  ${code}`;
      if (code === currency) item.classList.add('rcx-on');
      item.addEventListener('click', () => { chrome.storage.sync.set({ currency: code }); closeMenu(); });
      menu.append(item);
    }
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.left = `${Math.max(8, r.right - 180)}px`;
    document.body.append(menu);
    menu.querySelector('.rcx-on')?.scrollIntoView({ block: 'center' });
  }

  function addPicker() {
    for (const use of rcx.cards('revenue_v3').flatMap((a) => [...a.querySelectorAll('svg use[href^="/icons/currency-usd"]')])) {
      const svg = use.closest('svg');
      let button = svg.nextElementSibling?.classList.contains('rcx-cur') ? svg.nextElementSibling : null;
      if (!button) {
        button = Object.assign(document.createElement('button'), { type: 'button', className: 'rcx-cur', title: 'Currency (RC Extras)' });
        const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
        button.addEventListener('mousedown', (e) => e.stopPropagation());
        button.addEventListener('click', (e) => { stop(e); openMenu(button); });
        svg.style.display = 'none';
        svg.after(button);
      }
      const label = `${symbol(currency)} ▾`;
      if (button.textContent !== label) button.textContent = label;
    }
  }

  document.addEventListener('click', (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.rcx-cur')) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);

  chrome.storage.sync.get({ currency: 'USD', revenueType: 'Revenue' }, (r) => {
    revenueType = r.revenueType;
    setCurrency(r.currency).then(addPicker);
    applyRevenueType();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'sync') return;
    if (c.currency) setCurrency(c.currency.newValue).then(addPicker);
    if (c.revenueType) { revenueType = c.revenueType.newValue; rt = { page: '', done: false, tries: 0, button: null, since: 0 }; applyRevenueType(); }
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (currency !== 'USD') applyCurrency();
      applyRevenueType();
      addPicker();
    });
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
