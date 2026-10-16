// Syncs RC's "Customize projects" choices (order, hidden, default) across your Chrome profiles.
// RC keeps them in localStorage.projectPreferences only; this mirrors them to chrome.storage.sync.
// Runs at document_start so a synced value is in place before the dashboard reads it.
// (Also hands the chart settings to main.js early.)
(() => {
  // Cumulative charts + Overview period for main.js (page world), set before the dashboard loads.
  chrome.storage.sync.get({ cumulativeCharts: [], periodDays: {} }, ({ cumulativeCharts, periodDays }) => {
    document.documentElement.dataset.rcxCumulative = cumulativeCharts.join(',');
    document.documentElement.dataset.rcxDays = Object.entries(periodDays).map(([k, v]) => `${k}:${v}`).join(',');
  });

  const KEY = 'projectPreferences';
  let last = localStorage.getItem(KEY);

  chrome.storage.sync.get({ syncProjects: true, projectPrefs: null }, ({ syncProjects, projectPrefs }) => {
    if (!syncProjects) return;
    chrome.storage.local.get({ projectPrefsAt: 0 }, ({ projectPrefsAt }) => {
      if (projectPrefs && projectPrefs.value !== last && projectPrefs.at > projectPrefsAt) {
        localStorage.setItem(KEY, projectPrefs.value); // newer from another browser
        last = projectPrefs.value;
        chrome.storage.local.set({ projectPrefsAt: projectPrefs.at });
      } else if (last && last !== projectPrefs?.value) {
        push(last);
      }
    });

    // RC writes localStorage in this tab (no storage event), so check for changes.
    setInterval(() => {
      const now = localStorage.getItem(KEY);
      if (now && now !== last) { last = now; push(now); }
    }, 2000);
  });

  function push(value) {
    const at = Date.now();
    chrome.storage.sync.set({ projectPrefs: { value, at } });
    chrome.storage.local.set({ projectPrefsAt: at });
  }
})();
