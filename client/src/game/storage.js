const KEY = 'runeduel';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

export const storage = {
  get deck() { return load().deck || null; },
  set deck(v) { save({ ...load(), deck: v }); },
  get name() { return load().name || ''; },
  set name(v) { save({ ...load(), name: v }); },
  get matchesPlayed() { return load().matchesPlayed || 0; },
  bumpMatches() { const d = load(); d.matchesPlayed = (d.matchesPlayed || 0) + 1; save(d); },
  get showGuide() {
    const d = load();
    if (typeof d.showGuide === 'boolean') return d.showGuide;
    return (d.matchesPlayed || 0) < 3; // ghost outline for the first 3 matches
  },
  set showGuide(v) { save({ ...load(), showGuide: v }); },
  bestFor(spellId) { return (load().best || {})[spellId] || 0; },
  setBest(spellId, score) {
    const d = load();
    d.best = d.best || {};
    if (score > (d.best[spellId] || 0)) { d.best[spellId] = score; save(d); }
  },
};
