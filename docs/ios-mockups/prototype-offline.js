/*
 * PROTOTYPE — throwaway UI for SAA-12.
 * Three global-state presentations, switchable with ?variant=A|B|C.
 * Representative surfaces use ?screen=home|activity|plan|detail|advisor.
 * Connectivity/data cases use ?state=live|saved|stale|partial|revoked|conflict.
 */
(() => {
  const variants = {
    A: { name: 'Status row', thesis: 'A compact, tappable row below each title carries trust without dominating the finance UI.' },
    B: { name: 'Persistent banner', thesis: 'A full-width message always explains the current mode and its recovery action.' },
    C: { name: 'Mode dock', thesis: 'The app stays visually quiet; a persistent mode control lives above navigation and opens details.' },
  };
  const states = {
    live: { label: 'Live', short: 'Updated just now', tone: 'good', title: 'Connected to your Mac', detail: 'Changes save immediately.', action: 'Sync now' },
    saved: { label: 'Saved view', short: 'Saved 18 min ago', tone: 'saved', title: 'Viewing saved data', detail: 'Your Mac is unavailable. You can browse, but changes and Advisor require a live connection.', action: 'Try again' },
    stale: { label: 'Saved · 2d old', short: 'Last updated Monday, 20:41', tone: 'warn', title: 'Saved data may be out of date', detail: 'Values are from Monday. Reconnect to your Mac before relying on current balances.', action: 'Try again' },
    partial: { label: 'Partial', short: 'Updated 2 min ago', tone: 'warn', title: 'Some values are unavailable', detail: 'The Mac responded, but two accounts did not provide current balances. Available totals are clearly marked.', action: 'View details' },
    revoked: { label: 'Access removed', short: 'Pair again to continue', tone: 'danger', title: 'This iPhone no longer has access', detail: 'The Mac revoked this pairing. Saved financial data is no longer shown on this device.', action: 'Pair with Mac' },
    conflict: { label: 'Changed on Mac', short: 'Review the latest version', tone: 'danger', title: 'This item changed on your Mac', detail: 'Your edit was not applied. Reload the latest version before making another change.', action: 'Review latest' },
  };
  const screens = ['home', 'activity', 'plan', 'detail', 'advisor'];
  const params = new URLSearchParams(location.search);
  const variant = variants[params.get('variant')] ? params.get('variant') : 'A';
  const stateKey = states[params.get('state')] ? params.get('state') : 'saved';
  const screen = screens.includes(params.get('screen')) ? params.get('screen') : 'home';
  const state = states[stateKey];
  const isReadOnly = ['saved', 'stale'].includes(stateKey);

  const icon = (name) => {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5v8H15v-6H9v6H3z"/>',
      activity: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6M15 9v6M11 15v6"/>',
      plan: '<path d="M4 20V11M10 20V5M16 20v-7M22 20H2"/>',
      advisor: '<path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3z"/>',
      detail: '<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/>',
      person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>',
      refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.5-1.5L20 9M4 15l2.4 2.5A7 7 0 0 0 18 16"/>',
      lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.lock}</svg>`;
  };
  const statusBar = () => '<div class="status-bar"><b>9:41</b><span class="island"></span><span>▮▮▮ ᯤ ▰</span></div>';
  const appHeader = (title) => `<header class="app-header"><h1>${title}</h1><button class="profile">${icon('person')}</button></header>`;
  const modeSurface = () => {
    if (stateKey === 'live' && variant !== 'A') return '';
    if (variant === 'A') return `<button class="mode-row ${state.tone}" data-explain><i></i><span><b>${state.label}</b><small>${state.short}</small></span><span>›</span></button>`;
    if (variant === 'B') return `<section class="mode-banner ${state.tone}"><span class="mode-symbol">${isReadOnly ? icon('lock') : '!'}</span><div><b>${state.title}</b><small>${state.detail}</small></div><button>${state.action}</button></section>`;
    return '';
  };
  const amount = (value, label) => `<div class="amount"><small>${label}</small><b>${value}</b></div>`;
  const chart = () => '<svg class="offline-chart" viewBox="0 0 320 110" preserveAspectRatio="none"><path class="grid" d="M0 28h320M0 58h320M0 88h320"/><path class="area" d="M0 92 C35 82 45 65 76 71 S122 48 155 56 200 30 236 40 278 23 320 18V110H0Z"/><path class="line" d="M0 92 C35 82 45 65 76 71 S122 48 155 56 200 30 236 40 278 23 320 18"/></svg>';
  const disabledNote = () => isReadOnly ? '<p class="disabled-note">Changes are unavailable in Saved view. Reconnect to your Mac.</p>' : '';

  const home = () => `${appHeader('Home')}${modeSurface()}<div class="offline-scroll home-content">
    <section class="summary-card"><div class="section-title"><span>This month</span><small>${stateKey === 'partial' ? 'Partial total' : 'Calculated on Mac'}</small></div><div class="summary-grid">${amount('₪4,781', 'Spent')}${amount(stateKey === 'partial' ? '₪109,551*' : '₪109,551', 'Available')}</div>${chart()}${stateKey === 'partial' ? '<p class="partial-note">* Excludes two unavailable account balances.</p>' : ''}</section>
    <div class="metric-grid">${amount('₪8,219', 'Budget left')}${amount('₪715,709', 'Net worth')}</div>
    <section class="data-card"><div class="section-title"><b>Where money went</b><button>Details</button></div><div class="bar"><span>Dining</span><i style="--w:82%"></i><b>₪1,146</b></div><div class="bar"><span>Groceries</span><i style="--w:68%"></i><b>₪948</b></div><div class="bar"><span>Housing</span><i style="--w:55%"></i><b>₪768</b></div></section>
  </div>`;
  const tx = (emoji, name, meta, value) => `<button class="tx"><span>${emoji}</span><span><b>${name}</b><small>${meta}</small></span><strong>${value}</strong></button>`;
  const activity = () => `${appHeader('Activity')}${modeSurface()}<div class="activity-tools"><label>⌕ <input placeholder="Search saved transactions" ${stateKey === 'revoked' ? 'disabled' : ''}></label><button>☷</button></div><div class="offline-scroll activity-content"><div class="section-title"><span>Today · July 14</span><small>${isReadOnly ? 'Saved results' : 'Newest first'}</small></div>${tx('🍜','Wolt','Dining · Today','−₪86.40')}${tx('🛒','רמי לוי','Groceries · Yesterday','−₪342.18')}${tx('💼','Salary','Income · Jul 13','+₪18,400')}<button class="primary-action" ${isReadOnly ? 'disabled' : ''}>Review 3 transactions</button>${disabledNote()}</div>`;
  const plan = () => `${appHeader('Plan')}${modeSurface()}<div class="offline-scroll plan-content"><div class="segment"><button class="active">Budgets</button><button>Net worth</button><button>Assets</button></div><section class="budget-card"><div class="ring"><span>68%<small>used</small></span></div><div>${amount('₪8,219', 'July budgets')}<small>On track · 17 days left</small></div></section><div class="section-title"><b>Budgets</b><button ${isReadOnly ? 'disabled' : ''}>＋ Add</button></div><div class="budget-row"><span>Dining</span><b>₪654 left</b><button ${isReadOnly ? 'disabled' : ''}>Edit</button></div><div class="budget-row"><span>Groceries</span><b>₪852 left</b><button ${isReadOnly ? 'disabled' : ''}>Edit</button></div>${disabledNote()}</div>`;
  const detail = () => `${appHeader('Dining budget')}${modeSurface()}<div class="offline-scroll detail-content"><section class="detail-hero">${amount('₪654', 'Remaining')}<span>43% left</span></section><section class="form-card"><label>Monthly limit<input value="1800" ${isReadOnly || stateKey === 'conflict' ? 'disabled' : ''}></label><label>Included categories<button ${isReadOnly || stateKey === 'conflict' ? 'disabled' : ''}>Dining, Coffee ›</button></label><button class="primary-action" ${isReadOnly || stateKey === 'conflict' ? 'disabled' : ''}>Save changes</button></section>${stateKey === 'conflict' ? `<section class="conflict-card"><b>${state.title}</b><p>${state.detail}</p><button>${state.action}</button></section>` : disabledNote()}</div>`;
  const advisor = () => `${appHeader('Advisor')}${modeSurface()}<div class="offline-scroll advisor-content"><div class="advisor-mark">✦</div><h2>${isReadOnly ? 'Advisor needs your Mac' : 'What do you want to understand?'}</h2><p>${isReadOnly ? 'Saved data remains available in the other tabs, but Advisor never runs or queues requests offline.' : 'Advisor uses the same tools and financial context as the Mac.'}</p><div class="prompt-grid"><button ${isReadOnly ? 'disabled' : ''}>Where did I overspend?</button><button ${isReadOnly ? 'disabled' : ''}>Update my Dining budget</button></div><label class="composer"><input placeholder="Message Advisor" ${isReadOnly ? 'disabled' : ''}><button ${isReadOnly ? 'disabled' : ''}>↑</button></label>${isReadOnly ? `<button class="retry">${icon('refresh')} Try connection again</button>` : ''}</div>`;
  const content = { home, activity, plan, detail, advisor };

  const tabs = () => `<nav class="tab-bar">${['home','activity','plan','advisor'].map(id => `<button data-screen="${id}" class="${screen === id ? 'active' : ''}">${icon(id)}<span>${id[0].toUpperCase()+id.slice(1)}</span></button>`).join('')}</nav>`;
  const dock = variant === 'C' && stateKey !== 'live' ? `<button class="mode-dock ${state.tone}" data-explain><i></i><b>${state.label}</b><span>${state.short}</span><em>›</em></button>` : '';
  const revoked = stateKey === 'revoked' ? `${appHeader('Money Monitor')}<div class="revoked"><span>⌁</span><h2>${state.title}</h2><p>${state.detail}</p><button>${state.action}</button><small>Saved data was removed from this iPhone.</small></div>` : content[screen]();
  const detailSheet = variant === 'C' && stateKey !== 'live' ? `<section class="mode-sheet"><i></i><b>${state.title}</b><p>${state.detail}</p><button>${state.action}</button><small>${state.short}</small></section>` : '';

  document.getElementById('prototype').innerHTML = `<div class="prototype-page offline-page">
    <aside class="prototype-notes"><span class="prototype-tag">THROWAWAY PROTOTYPE</span><p>Decision ticket SAA-12</p><h1>Global saved and read-only experience</h1><div class="variant-summary"><b>${variant} — ${variants[variant].name}</b><p>${variants[variant].thesis}</p></div><h2>Current case</h2><div class="state-readout ${state.tone}"><b>${state.label}</b><span>${state.title}</span><small>${state.detail}</small></div><h2>Invariant</h2><ul><li>Saved finance data remains browsable.</li><li>Writes and Advisor never queue.</li><li>Every value carries its calculation time.</li><li>Revocation removes saved data.</li></ul></aside>
    <div class="phone-frame"><div class="phone-screen ${variant === 'B' ? 'banner-layout' : ''}">${statusBar()}${revoked}${dock}${stateKey !== 'revoked' ? tabs() : ''}${detailSheet}</div></div>
    <aside class="case-picker"><b>Test the state model</b>${Object.entries(states).map(([key,value]) => `<button data-state="${key}" class="${key === stateKey ? 'active '+value.tone : ''}"><i></i><span><b>${value.label}</b><small>${value.short}</small></span></button>`).join('')}<b>Representative screen</b>${screens.map(id => `<button class="screen-choice ${id === screen ? 'active' : ''}" data-screen="${id}">${id[0].toUpperCase()+id.slice(1)}</button>`).join('')}</aside>
  </div><div class="variant-switcher"><button data-cycle="-1">←</button><span><b>${variant}</b> — ${variants[variant].name}</span><button data-cycle="1">→</button></div>`;

  const go = (changes) => { const next = new URLSearchParams(location.search); Object.entries(changes).forEach(([k,v]) => next.set(k,v)); location.search = next.toString(); };
  document.querySelectorAll('[data-state]').forEach(el => el.addEventListener('click', () => go({state:el.dataset.state})));
  document.querySelectorAll('[data-screen]').forEach(el => el.addEventListener('click', () => go({screen:el.dataset.screen})));
  document.querySelectorAll('[data-cycle]').forEach(el => el.addEventListener('click', () => { const keys=Object.keys(variants); go({variant:keys[(keys.indexOf(variant)+Number(el.dataset.cycle)+keys.length)%keys.length]}); }));
  window.addEventListener('keydown', event => { if(!['ArrowLeft','ArrowRight'].includes(event.key) || event.target.matches('input,textarea,[contenteditable]')) return; const keys=Object.keys(variants); go({variant:keys[(keys.indexOf(variant)+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length]}); });
})();
