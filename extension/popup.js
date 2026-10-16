// Icon size: writes storage.local on every move; content.js applies it live.
const size = document.getElementById('size');
const val = document.getElementById('val');
const show = () => {
  val.textContent = `${size.value}px`;
  size.style.setProperty('--fill', `${((size.value - size.min) / (size.max - size.min)) * 100}%`);
};

chrome.storage.local.get({ iconSize: 36 }, ({ iconSize }) => { size.value = iconSize; show(); });
size.addEventListener('input', () => {
  show();
  chrome.storage.local.set({ iconSize: Number(size.value) });
});

// Website icons: only the websites the user added, plus "+ Add" to pick another
// letter-avatar project (names collected by content.js). Others stay on auto-detect.
const sites = document.getElementById('sites');
const hint = document.getElementById('hint');
const addButton = document.getElementById('add');
const clean = (v) => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');

let letterProjects = [];
let detected = {};
let webDomains = {};

async function saveDomain(name, domain) {
  const next = { ...(await chrome.storage.sync.get({ webDomains: {} })).webDomains };
  if (domain) next[name] = domain; else delete next[name];
  webDomains = next;
  await chrome.storage.sync.set({ webDomains: next });
  // Optional: lets background.js read the site's own icon when Google has none.
  if (domain) chrome.permissions.request({ origins: [`https://${domain}/*`] }).catch(() => {});
}

function siteRow(name) {
  const row = document.createElement('div');
  row.className = 'row';
  const picker = name ? Object.assign(document.createElement('span'), { textContent: name, title: name }) : document.createElement('select');
  if (!name) {
    picker.append(new Option('Project…', ''));
    for (const p of letterProjects.filter((p) => !webDomains[p])) picker.append(new Option(p, p));
  }
  const input = Object.assign(document.createElement('input'), { placeholder: 'example.com', value: name ? webDomains[name] : '' });
  const remove = Object.assign(document.createElement('button'), { className: 'remove', type: 'button', textContent: '×', title: 'Back to automatic' });

  const current = () => name || picker.value;
  if (!name) picker.addEventListener('change', () => { input.placeholder = detected[picker.value] ? `Auto: ${detected[picker.value]}` : 'example.com'; input.focus(); });
  input.addEventListener('change', async () => {
    const project = current();
    input.value = clean(input.value);
    if (!project) return;
    await saveDomain(project, input.value);
    render();
  });
  remove.addEventListener('click', async () => {
    if (name) await saveDomain(name, '');
    render();
  });
  row.append(picker, input, remove);
  return row;
}

function render() {
  sites.replaceChildren(...Object.keys(webDomains).sort().map(siteRow));
  const free = letterProjects.filter((p) => !webDomains[p]);
  addButton.hidden = !free.length;
  hint.hidden = Object.keys(webDomains).length > 0;
  if (!letterProjects.length) hint.textContent = 'Open the RevenueCat Overview page first to find projects without an app icon.';
}

addButton.addEventListener('click', () => {
  if (sites.querySelector('select')) return;
  const row = siteRow(null);
  sites.append(row);
  hint.hidden = true;
  row.querySelector('select').focus();
});

chrome.storage.local.get({ letterProjects: [], detected: {} }, (local) => {
  ({ letterProjects, detected } = local);
  chrome.storage.sync.get({ webDomains: {} }, (sync) => {
    webDomains = sync.webDomains;
    render();
  });
});

// Dashboard options (storage.sync; content scripts apply them live).
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'HKD', 'SGD', 'KRW', 'INR', 'IDR', 'MYR', 'PHP', 'THB',
  'SEK', 'NOK', 'DKK', 'ISK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ILS', 'ZAR', 'BRL', 'MXN'];
const currencySel = document.getElementById('currency');
const names = new Intl.DisplayNames(undefined, { type: 'currency' });
for (const code of CURRENCIES) currencySel.append(new Option(code === 'USD' ? 'USD (off)' : `${code} · ${names.of(code)}`, code));

const OPTIONS = { moreTransactions: true, trialEnds: true, currency: 'USD', revenueType: 'Revenue', syncProjects: true };
chrome.storage.sync.get(OPTIONS, (o) => {
  for (const [key, fallback] of Object.entries(OPTIONS)) {
    const value = o[key] ?? fallback;
    const el = document.getElementById(key);
    if (el.type === 'checkbox') el.checked = value; else el.value = value;
    const read = () => (el.type === 'checkbox' ? el.checked : typeof fallback === 'number' ? Number(el.value) : el.value);
    el.addEventListener('change', () => chrome.storage.sync.set({ [key]: read() }));
  }
});

// Cumulative charts: one pill per Overview card (same setting as the Σ buttons on the cards).
const pills = [...document.querySelectorAll('#cumulativeCharts button')];
const showPills = (list) => pills.forEach((b) => b.classList.toggle('on', list.includes(b.dataset.chart)));
chrome.storage.sync.get({ cumulativeCharts: [] }, ({ cumulativeCharts }) => {
  let current = cumulativeCharts;
  showPills(current);
  for (const b of pills) {
    b.addEventListener('click', () => {
      const chart = b.dataset.chart;
      current = current.includes(chart) ? current.filter((c) => c !== chart) : [...current, chart];
      showPills(current);
      chrome.storage.sync.set({ cumulativeCharts: current });
    });
  }
});
