/*
 * PROTOTYPE — throwaway UI for SAA-8.
 * Three information-architecture variants, switchable with ?variant=A|B|C.
 * Tabs change ?screen=home|activity|plan|advisor so each concept can be judged in context.
 */
(() => {
  const variants = {
    A: {
      name: 'Command center',
      thesis: 'Maximum at-a-glance value: compact metrics and charts lead; every module drills down.',
      accent: '#0877d1',
    },
    B: {
      name: 'Daily briefing',
      thesis: 'Explain what changed first, then reveal supporting charts and financial domains.',
      accent: '#6e4bd8',
    },
    C: {
      name: 'Focused explorer',
      thesis: 'One dominant visualization at a time, with direct domain navigation and less scrolling.',
      accent: '#087f5b',
    },
  };

  const screens = ['home', 'activity', 'plan', 'advisor'];
  const params = new URLSearchParams(window.location.search);
  const variant = variants[params.get('variant')] ? params.get('variant') : 'A';
  const screen = screens.includes(params.get('screen')) ? params.get('screen') : 'home';

  const money = (value, tone = '') => `<strong class="money ${tone}">${value}</strong>`;
  const icon = (name) => {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5v8H15v-6H9v6H3z"/>',
      activity: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6M15 9v6M11 15v6"/>',
      plan: '<path d="M4 20V11M10 20V5M16 20v-7M22 20H2"/>',
      advisor: '<path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3zM19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
      person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>',
      filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
      arrow: '<path d="m5 14 4-4 3 3 7-7"/><path d="M14 6h5v5"/>',
      spark: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>',
      edit: '<path d="m4 20 4.5-1L19 8.5 15.5 5 5 15.5z"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
  };

  const lineChart = (color = 'var(--accent)', area = true) => `<svg class="line-chart" viewBox="0 0 320 100" preserveAspectRatio="none" role="img" aria-label="Monthly spending trend, down twelve percent">
    <path class="grid" d="M0 24h320M0 55h320M0 86h320"/>
    ${area ? '<path class="chart-area" d="M0 76 C28 72 41 60 67 64 S105 45 133 52 171 34 201 39 239 23 267 29 298 14 320 20 L320 100H0Z"/>' : ''}
    <path class="chart-line" style="stroke:${color}" d="M0 76 C28 72 41 60 67 64 S105 45 133 52 171 34 201 39 239 23 267 29 298 14 320 20"/>
  </svg>`;

  const donut = () => `<div class="donut" aria-label="Spending by category"><span>₪4,781<small>spent</small></span></div>`;

  const categoryBars = () => `<div class="category-bars">
    <div><span>Dining</span><i style="--w:82%;--c:#f59f00"></i><b>₪1,146</b></div>
    <div><span>Groceries</span><i style="--w:68%;--c:#2f9e44"></i><b>₪948</b></div>
    <div><span>Housing</span><i style="--w:55%;--c:#0877d1"></i><b>₪768</b></div>
    <div><span>Transport</span><i style="--w:31%;--c:#7950f2"></i><b>₪432</b></div>
  </div>`;

  const cashFlow = () => `<div class="cash-flow" aria-label="Cash flow from income to spending and savings">
    <div class="flow-source"><b>₪18,400</b><span>Income</span></div>
    <svg viewBox="0 0 180 126" preserveAspectRatio="none"><path class="flow-a" d="M0 20 C75 20 95 22 180 22"/><path class="flow-b" d="M0 45 C82 45 92 72 180 72"/><path class="flow-c" d="M0 68 C75 68 95 108 180 108"/></svg>
    <div class="flow-targets"><div><b>₪4,781</b><span>Spent</span></div><div><b>₪6,100</b><span>Bills</span></div><div><b>₪7,519</b><span>Saved</span></div></div>
  </div>`;

  const reviewCallout = (compact = false) => `<button class="review-callout ${compact ? 'compact' : ''}"><span class="callout-icon">${icon('spark')}</span><span><b>3 transactions need a look</b><small>Review category suggestions</small></span>${icon('chevron')}</button>`;

  const statusBar = () => `<div class="status-bar"><b>9:41</b><span class="island"></span><span>▮▮▮ ᯤ ▰</span></div>`;
  const header = (title, subtitle = '') => `<header class="app-header"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="profile">${icon('person')}</button></header>`;
  const freshness = () => `<button class="freshness"><span class="live-dot"></span><b>Live</b><span>Updated 2m ago</span><span>›</span></button>`;

  const tabs = () => `<nav class="tab-bar" aria-label="Primary navigation">${screens.map((id) => `<button data-screen="${id}" class="${screen === id ? 'active' : ''}">${icon(id)}<span>${id[0].toUpperCase() + id.slice(1)}</span></button>`).join('')}</nav>`;

  const transactions = () => `<div class="transactions">
    <button><span class="merchant orange">🍜</span><span><b>Wolt</b><small>Dining · Today</small></span>${money('−₪86.40')}</button>
    <button><span class="merchant green">🛒</span><span><b>רמי לוי</b><small>Groceries · Yesterday</small></span>${money('−₪342.18')}</button>
    <button><span class="merchant blue">💼</span><span><b>Salary</b><small>Income · Jul 13</small></span>${money('+₪18,400', 'positive')}</button>
    <button><span class="merchant violet">♫</span><span><b>Spotify</b><small>Subscriptions · Jul 12</small></span>${money('−₪21.90')}</button>
  </div>`;

  function homeA() {
    return `${header('Home')}${freshness()}<div class="scroll dashboard-a">
      <section class="hero-card"><div class="eyebrow"><span>This month</span><button>July⌄</button></div><div class="hero-row"><div><small>Spent</small>${money('₪4,781')}<em>↓ 12% vs June</em></div><div><small>Available money</small>${money('₪109,551')}</div></div>${lineChart()}</section>
      <div class="mini-metrics"><button><small>Budget left</small>${money('₪8,219')}<span>On track ›</span></button><button><small>Net worth</small>${money('₪715,709')}<span class="positive">+1.0% ›</span></button></div>
      ${reviewCallout(true)}
      <section class="module"><div class="module-head"><h2>Where money went</h2><button>Details</button></div><div class="chart-split">${donut()}${categoryBars()}</div></section>
      <section class="module"><div class="module-head"><h2>Cash flow</h2><button>Details</button></div>${cashFlow()}</section>
      <section class="accounts-strip"><div><small>Accounts</small><b>4 fresh · 1 needs attention</b></div><button>View ›</button></section>
    </div>`;
  }

  function homeB() {
    return `${header('Today', 'Tuesday, July 14')}${freshness()}<div class="scroll briefing-b">
      <section class="briefing-card"><span class="briefing-mark">${icon('spark')}</span><p>Your spending is <b>₪652 below last month’s pace</b>. Dining improved, while groceries are trending higher.</p><button>Ask Advisor about this</button></section>
      <section class="story-hero"><div class="story-title"><div><small>Money in motion</small><h2>₪7,519 kept this month</h2></div><span class="positive">41% of income</span></div>${cashFlow()}</section>
      <div class="attention"><h2>Worth your attention</h2>${reviewCallout()}<button class="insight-row"><span class="warn">!</span><span><b>Groceries are 18% above pace</b><small>₪948 spent · 17 days left</small></span><span>›</span></button></div>
      <section class="story-section"><div class="module-head"><h2>Your month</h2><button>Explore</button></div>${lineChart('var(--accent)', false)}<div class="story-stats"><span><small>Spent</small><b>₪4,781</b></span><span><small>Budget left</small><b>₪8,219</b></span><span><small>Net worth</small><b>₪715.7K</b></span></div></section>
    </div>`;
  }

  function homeC() {
    return `${header('Overview')}${freshness()}<div class="focus-c">
      <div class="focus-summary"><div><small>Available money</small>${money('₪109,551')}</div><span class="positive">+₪7,519 this month</span></div>
      <div class="focus-tabs"><button class="active">Spending</button><button>Cash flow</button><button>Wealth</button></div>
      <section class="focus-chart"><div class="module-head"><div><small>July spending</small><h2>₪4,781</h2></div><button>1M⌄</button></div>${lineChart()}<div class="focus-legend"><span>Actual</span><span>Last month pace</span></div></section>
      <div class="focus-actions"><button><span>◎</span><b>Categories</b><small>See breakdown</small></button><button><span>◴</span><b>Budgets</b><small>₪8,219 left</small></button><button><span>↗</span><b>Net worth</b><small>+1.0% this month</small></button></div>
      ${reviewCallout(true)}
      <button class="focus-deep">Open spending workspace ${icon('chevron')}</button>
    </div>`;
  }

  function activity() {
    return `${header('Activity')}<div class="activity-tools"><label>${icon('search')}<input aria-label="Search transactions" placeholder="Search transactions" /></label><button>${icon('filter')}</button></div><div class="filter-chips"><button class="active">All</button><button>Needs review · 3</button><button>Expenses</button></div><div class="scroll activity-screen"><div class="list-heading"><span>Today · July 14</span><button>Newest first⌄</button></div>${transactions()}<div class="edit-hint">Tap a transaction to edit category, owner, or report inclusion.</div></div>`;
  }

  function plan() {
    return `${header('Plan')}<div class="plan-switch"><button class="active">Budgets</button><button>Net worth</button><button>Assets</button></div><div class="scroll plan-screen"><section class="plan-hero"><div class="ring"><span>68%<small>used</small></span></div><div><small>July budgets</small><h2>₪8,219 left</h2><span>On track · 17 days left</span></div></section><div class="module-head"><h2>Budgets</h2><button>${icon('plus')} Add</button></div>${categoryBars()}<section class="wealth-preview"><div><small>Net worth</small><h2>₪715,709</h2><span class="positive">+₪7,240 this month</span></div>${lineChart('var(--accent)', false)}</section></div>`;
  }

  function advisor() {
    return `${header('Advisor')}<div class="scroll advisor-screen"><section class="advisor-hero"><span>${icon('advisor')}</span><h2>What do you want to understand?</h2><p>Advisor uses the same tools and financial context as the Mac.</p></section><div class="prompt-grid"><button>Where did I overspend this month?</button><button>Update my Dining budget to ₪1,800</button><button>Show my net-worth trend</button><button>Categorize my review queue</button></div><div class="conversation-head"><h2>Recent conversations</h2><button>New chat</button></div><div class="conversation-list"><button><span><b>July spending review</b><small>Today · Used 4 tools</small></span>›</button><button><span><b>Portfolio performance</b><small>Sunday · Used 3 tools</small></span>›</button></div></div>`;
  }

  const screenRenderer = {
    home: { A: homeA, B: homeB, C: homeC },
    activity: { A: activity, B: activity, C: activity },
    plan: { A: plan, B: plan, C: plan },
    advisor: { A: advisor, B: advisor, C: advisor },
  };

  const variantInfo = variants[variant];
  document.documentElement.style.setProperty('--accent', variantInfo.accent);
  document.getElementById('prototype').innerHTML = `<div class="prototype-page">
    <aside class="prototype-notes"><span class="prototype-tag">THROWAWAY PROTOTYPE</span><p>Decision ticket</p><h1>High-value native iOS information architecture</h1><div class="variant-summary"><b>${variant} — ${variantInfo.name}</b><p>${variantInfo.thesis}</p></div><h2>Stable decisions</h2><ul><li>Four root tabs: Home, Activity, Plan, Advisor.</li><li>Search and review live inside Activity.</li><li>Home contains insight, not another transaction list.</li><li>Charts drill into shared Mac-calculated data.</li></ul><h2>Compare</h2><p>Use the bottom switcher or ←/→. Tab changes stay within the selected concept.</p></aside>
    <div class="phone-frame"><div class="phone-screen">${statusBar()}${screenRenderer[screen][variant]()}${tabs()}</div></div>
    <div class="screen-map"><span class="map-title">Responsibilities</span><div><b>Home</b><small>Understand now</small></div><div><b>Activity</b><small>Find, review, edit</small></div><div><b>Plan</b><small>Budget and wealth</small></div><div><b>Advisor</b><small>Ask and act</small></div></div>
  </div><div class="variant-switcher"><button data-cycle="-1" aria-label="Previous variant">←</button><span><b>${variant}</b> — ${variantInfo.name}</span><button data-cycle="1" aria-label="Next variant">→</button></div>`;

  function navigate(nextVariant = variant, nextScreen = screen) {
    const next = new URLSearchParams(window.location.search);
    next.set('variant', nextVariant);
    next.set('screen', nextScreen);
    window.location.search = next.toString();
  }

  document.querySelectorAll('[data-screen]').forEach((button) => button.addEventListener('click', () => navigate(variant, button.dataset.screen)));
  document.querySelectorAll('[data-cycle]').forEach((button) => button.addEventListener('click', () => {
    const keys = Object.keys(variants);
    const index = keys.indexOf(variant);
    navigate(keys[(index + Number(button.dataset.cycle) + keys.length) % keys.length], screen);
  }));
  window.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.target.matches('input, textarea, [contenteditable]')) return;
    const keys = Object.keys(variants);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    navigate(keys[(keys.indexOf(variant) + delta + keys.length) % keys.length], screen);
  });
})();
