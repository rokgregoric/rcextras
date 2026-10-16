// Name on hover + make RC recount how many chips fit (it only recounts on row resize).
const CHIP = 'a.MuiButtonBase-root:not(.MuiButton-root):has(> span):has(> div > .MuiTypography-noWrap)';
let seenRows = new WeakSet();

// Icons for projects that only have a letter avatar:
// 1) website typed in the popup  2) auto-detected from RC's own project settings (read-only).
let webDomains = {};
const favicons = {}; // domain → Promise<data URL | null>; fetched by background.js (RC's CSP blocks remote images)
const letterProjects = new Set(); // names → listed in the popup
const detected = {}; // name → what auto-detect found, shown in the popup

function favicon(domain) {
  favicons[domain] ??= chrome.runtime.sendMessage({ type: 'favicon', domain }).catch(() => null);
  return favicons[domain];
}

// Auto-detect via RC's internal API (same origin, user's session): Web Billing app icon uploaded
// in RC, else the domain of its terms URL or support email (free-mail domains skipped).
const API = '/internal/v1/developers/me/projects/';
const FREE_MAIL = /^(gmail|googlemail|outlook|hotmail|live|icloud|me|mac|yahoo|proton|protonmail|pm|aol|gmx)\./i;
const autoInfo = {}; // projectId → Promise<{ icon?, domain? }>

async function rcGet(path) {
  const res = await fetch(API + path, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function projectAuto(id) {
  autoInfo[id] ??= (async () => {
    const project = await rcGet(id);
    for (const app of project.apps || []) {
      if (app.type !== 'rc_billing') continue;
      const a = await rcGet(`${id}/apps/${app.id}`);
      if (a.app_icon && a.app_icon_base_url) return { icon: `${a.app_icon_base_url}/${a.app_icon}` };
      const host = hostOf(a.terms_and_conditions_url) || a.support_email?.split('@')[1];
      if (host && !FREE_MAIL.test(host)) return { domain: host.replace(/^www\./, '') };
    }
    return {};
  })().catch(() => ({}));
  return autoInfo[id];
}

async function iconFor(chip, name) {
  if (webDomains[name]) return favicon(webDomains[name]);
  const id = chip.getAttribute('href')?.match(/projects\/([^/?#]+)/)?.[1];
  if (!id) return null;
  const auto = await projectAuto(id);
  remember(name, auto.icon ? 'RC icon' : auto.domain || '');
  if (auto.icon) return auto.icon; // RC's icon CDN is allowed by its CSP
  return auto.domain ? favicon(auto.domain) : null;
}

function setFavicon(chip, name) {
  const avatar = chip.querySelector(':scope > span > .MuiAvatar-root');
  if (!avatar) return;
  if (!letterProjects.has(name)) {
    letterProjects.add(name);
    save();
  }
  const key = webDomains[name] || 'auto';
  if (avatar.dataset.rcioFav === key) return;
  avatar.dataset.rcioFav = key;
  avatar.style.backgroundImage = '';
  avatar.classList.remove('rcio-fav');
  iconFor(chip, name).then((url) => {
    if (!url || avatar.dataset.rcioFav !== key) return;
    avatar.style.backgroundImage = `url("${url}")`;
    avatar.classList.add('rcio-fav');
  });
}

function remember(name, value) {
  if (detected[name] === value) return;
  detected[name] = value;
  save();
}

let saveQueued = false;
function save() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    chrome.storage.local.set({ letterProjects: [...letterProjects].sort(), detected });
  }, 500);
}

function apply() {
  document.querySelectorAll(CHIP).forEach((chip) => {
    const name = chip.querySelector('.MuiTypography-noWrap')?.textContent.trim();
    if (name && chip.title !== name) chip.title = name;
    if (name) setFavicon(chip, name);

    const row = chip.closest('.MuiStack-root')?.parentElement; // hidden measuring copies have no Stack
    if (row && !seenRows.has(row)) {
      seenRows.add(row);
      row.style.width = `${row.offsetWidth - 1}px`;
      requestAnimationFrame(() => requestAnimationFrame(() => { row.style.width = ''; }));
    }
  });
}

// Icon size from the popup slider; applies live while dragging.
const DEFAULT_SIZE = 36;
function setSize(px) {
  document.documentElement.style.setProperty('--rcio-icon', `${px}px`);
  seenRows = new WeakSet(); // chip width changed → let RC recount what fits
  apply();
}
chrome.storage.local.get({ iconSize: DEFAULT_SIZE }, ({ iconSize }) => setSize(iconSize));
chrome.storage.sync.get({ webDomains: {} }, (r) => { webDomains = r.webDomains; apply(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.iconSize) setSize(changes.iconSize.newValue);
  if (area === 'sync' && changes.webDomains) { webDomains = changes.webDomains.newValue || {}; apply(); }
});

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; apply(); });
}).observe(document.documentElement, { childList: true, subtree: true });
apply();
