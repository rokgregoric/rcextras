// Fetch a site's icon and return it as a data URL (RC's CSP only allows data: images).
// Google's favicon service first; sites it hasn't indexed fall back to the site's own icons,
// which works only once the user granted access to that site in the popup.
async function toDataUrl(res) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return `data:${res.headers.get('content-type')};base64,${btoa(bin)}`;
}

async function favicon(domain) {
  const urls = [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, // 404 = generic globe
    `https://${domain}/apple-touch-icon.png`,
    `https://${domain}/favicon.ico`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok && res.headers.get('content-type')?.startsWith('image/')) return await toDataUrl(res);
    } catch { /* no access or not found → try next */ }
  }
  return null;
}

// USD → other currencies (European Central Bank reference rates via Frankfurter), cached 12 h.
async function rates() {
  const { fx } = await chrome.storage.local.get('fx');
  if (fx && Date.now() - fx.at < 12 * 3600 * 1000) return fx.rates;
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=USD');
    const body = await res.json();
    await chrome.storage.local.set({ fx: { at: Date.now(), date: body.date, rates: body.rates } });
    return body.rates;
  } catch {
    return fx?.rates || null; // stale is better than nothing
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'rates') {
    rates().then(reply);
    return true;
  }
  if (msg.type !== 'favicon' || !/^[a-z0-9.-]+$/i.test(msg.domain)) return;
  favicon(msg.domain).then(reply);
  return true; // async reply
});
