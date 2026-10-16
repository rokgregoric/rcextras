// Shared helpers for the content scripts: which page we're on, and the overview cards.
// The All projects view and a single project use the same cards and chart APIs; only the
// paths differ (/charts/x vs /projects/<id>/charts/x), so features match both by default.
var rcx = {
  // { scope: 'all' | 'project', projectId, view: 'overview' | 'charts' | 'customer-lists' | … }
  page() {
    const m = location.pathname.match(/^\/(?:projects\/([^/]+)\/?)?([^/]*)/);
    return { scope: m[1] ? 'project' : 'all', projectId: m[1] || null, view: m[2] || 'overview' };
  },
  // Overview cards linking to a chart, e.g. cards('revenue_v3'), in either view.
  cards(chart) {
    const path = new RegExp(`^(/projects/[^/]+)?/charts/${chart}(\\?|$)`);
    return [...document.querySelectorAll(`a[href*="/charts/${chart}"]`)].filter((a) => path.test(a.getAttribute('href')));
  },
};
