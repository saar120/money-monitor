(() => {
  const iconPaths = {
    home: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    activity:
      '<path d="M4 5h16M4 12h16M4 19h16"/><path d="M7 3v4M12 10v4M17 17v4"/>',
    plan: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    sparkle:
      '<path d="M12 3l1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3L12 3Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14ZM5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8-1.8-.7 1.8-.7L5 14Z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    sync: '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 0 0-14.5-2M4 17h5v5"/><path d="M4 17a8 8 0 0 0 14.5 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    shield: '<path d="M12 3 5 6v5c0 4.7 2.8 8 7 10 4.2-2 7-5.3 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    laptop: '<rect x="4" y="4" width="16" height="12" rx="2"/><path d="M2 20h20M9 20v-1h6v1"/>',
    face: '<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M8 10h.01M16 10h.01M9 16c1.7 1.3 4.3 1.3 6 0"/>',
    qr: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v6h-4v-2h-2"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8M10 20h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6a8 8 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.5.9l.3 2.6h4l.3-2.6a8 8 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/>',
    wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3h12"/><path d="M16 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>',
    bank: '<path d="m3 9 9-5 9 5M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="m7 16 4-5 3 2 5-7"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    offline: '<path d="M4.9 4.9 19 19M2 8.5A15 15 0 0 1 5.3 6M9.2 4.2A15 15 0 0 1 22 8.5M5 12.5a10 10 0 0 1 4-2.1M13.5 10.2a10 10 0 0 1 5.5 2.3M8.5 16.5a5 5 0 0 1 7 0M12 20h.01"/>',
    tag: '<path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8" cy="8" r="1"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    arrowup: '<path d="m6 15 6-6 6 6"/>',
    arrowdown: '<path d="m6 9 6 6 6-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    pencil: '<path d="m4 20 4.5-1L19 8.5 15.5 5 5 15.5 4 20ZM13.5 7l3.5 3.5"/>',
    house: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8Z"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  };

  function icon(name, className = '') {
    return `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.info}</svg>`;
  }

  function statusBar(time = '9:41') {
    return `<div class="statusbar">
      <span>${time}</span>
      <span class="dynamic-island"></span>
      <span class="status-icons"><span class="signal-bars"><i></i><i></i><i></i></span><span class="wifi-mark"></span><span class="battery"></span></span>
    </div>`;
  }

  function tabBar(active, searchActive = false) {
    const tabs = [
      ['home', 'Home', 'home'],
      ['activity', 'Activity', 'activity'],
      ['plan', 'Plan', 'plan'],
      ['advisor', 'Advisor', 'sparkle'],
    ];
    return `<div class="tabbar-wrap">
      <div class="tabbar">${tabs
        .map(
          ([id, label, glyph]) =>
            `<div class="tab-item ${active === id ? 'active' : ''}">${icon(glyph)}<span>${label}</span></div>`,
        )
        .join('')}</div>
      <div class="search-tab ${searchActive ? 'active' : ''}">${icon('search')}</div>
    </div>`;
  }

  function largeHeader(title, trailing = 'person') {
    return `<div class="nav-large"><h1>${title}</h1><button class="round-action" style="margin-left:auto">${icon(trailing)}</button></div>`;
  }

  function inlineHeader(title, backLabel = '', trailing = '') {
    return `<div class="nav-inline">
      <button class="back-action">${icon('back')}${backLabel ? `<span>${backLabel}</span>` : ''}</button>
      <h1>${title}</h1>
      <button class="nav-action">${trailing}</button>
    </div>`;
  }

  function appScreen({ title, active, body, dark = false, inline = false, back = '', trailing, white = false, searchActive = false }) {
    const header = inline
      ? inlineHeader(title, back, trailing || '')
      : largeHeader(title, trailing || 'person');
    return `${statusBar()}<div class="app-content with-tabs ${white ? 'white' : ''}">${header}${body}</div>${tabBar(active, searchActive)}`;
  }

  function shell(id) {
    const item = screens[id];
    return `<div class="phone-shell"><div class="screen ${item.dark ? 'dark' : ''}" data-screen="${id}">${item.render()}</div></div>`;
  }

  function merchantRow({ emoji, color, name, meta, amount, positive = false, review = false, subtitle }) {
    return `<div class="list-row ${review ? 'needs-review' : ''}">
      <div class="merchant-icon" style="background:${color}">${emoji}</div>
      <div class="row-copy"><div class="row-title">${name}</div><div class="row-subtitle">${subtitle || meta}</div></div>
      <div class="row-value"><strong class="${positive ? 'positive' : ''}">${amount}</strong>${subtitle ? `<span>${meta}</span>` : ''}</div>
    </div>`;
  }

  function settingsRow(glyph, tint, title, value = '', extra = '') {
    return `<div class="list-row full-separator">
      <div class="row-icon" style="background:${tint}18;color:${tint}">${icon(glyph)}</div>
      <div class="row-copy"><div class="row-title">${title}</div>${extra ? `<div class="row-subtitle">${extra}</div>` : ''}</div>
      ${value ? `<div class="row-value"><span style="font-size:13px;margin:0">${value}</span></div>` : ''}${icon('chevron', 'chevron')}
    </div>`;
  }

  function onboardingScreen(body) {
    return `<div class="onboarding">${statusBar()}<div class="onboard-body">${body}</div></div>`;
  }

  const homeBody = () => `<div class="page-scroll">
    <div class="sync-strip"><span style="display:flex;align-items:center;gap:7px"><span class="dot"></span>Mac connected</span><span class="muted">Updated 2m ago ›</span></div>
    <div class="surface month-hero">
      <div class="month-hero-top"><div><p class="eyeline">Spent in July</p><h2 class="money">₪4,781</h2><div class="trend-copy">${icon('arrowdown')} 12% less than June</div></div><span class="pill active">This month</span></div>
      <svg class="sparkline" viewBox="0 0 330 72" preserveAspectRatio="none"><path class="target" d="M0 54 C70 46 138 39 198 31 S285 19 330 12"/><path class="area" d="M0 62 C35 61 48 54 72 56 S111 42 139 46 176 31 205 34 239 24 270 27 306 16 330 19 L330 72H0Z"/><path class="line" d="M0 62 C35 61 48 54 72 56 S111 42 139 46 176 31 205 34 239 24 270 27 306 16 330 19"/></svg>
      <div class="metric-row"><div><span class="caption">Budget remaining</span><strong class="money">₪8,219</strong></div><div><span class="caption">Total cash</span><strong class="money">₪109,551</strong></div></div>
    </div>
    <div class="section"><div class="review-banner"><div class="glyph">${icon('sparkle')}</div><div><strong>3 transactions need a look</strong><p>Money Monitor has category suggestions</p></div>${icon('chevron', 'chevron')}</div></div>
    <div class="section"><div class="section-head compact"><h2>Recent activity</h2><button class="section-link">See all</button></div><div class="list-group">
      ${merchantRow({ emoji: '🍜', color: '#FFF0E6', name: 'Wolt', meta: 'Dining · Today', amount: '−₪86.40', review: true })}
      ${merchantRow({ emoji: '🛒', color: '#E9F7EF', name: 'רמי לוי', meta: 'Groceries · Yesterday', amount: '−₪342.18' })}
      ${merchantRow({ emoji: '♫', color: '#EAF3FF', name: 'Spotify', meta: 'Subscriptions · Jul 12', amount: '−₪21.90' })}
    </div></div>
  </div>`;

  const activityBody = () => `<div style="height:calc(100% - 73px);overflow:hidden">
    <div class="activity-tools"><div class="search-field">${icon('search')}<span>Search transactions</span></div><button class="filter-button">${icon('filter')}</button></div>
    <div class="chip-row" style="padding:0 16px 4px"><span class="pill active">All</span><span class="pill">Needs review · 3</span><span class="pill">Expenses</span></div>
    <div class="date-label">Today · July 14</div><div class="transaction-list">
      ${merchantRow({ emoji: '🍜', color: '#FFF0E6', name: 'Wolt', meta: 'Isracard Platinum', subtitle: 'Dining', amount: '−₪86.40', review: true })}
      ${merchantRow({ emoji: '☕️', color: '#F6EEE8', name: 'Café Xoho', meta: 'Max Visa', subtitle: 'Coffee', amount: '−₪28.00' })}
      ${merchantRow({ emoji: '🚆', color: '#EAF3FF', name: 'רכבת ישראל', meta: 'Max Visa', subtitle: 'Transport', amount: '−₪16.00' })}
    </div>
    <div class="date-label">Yesterday · July 13</div><div class="transaction-list">
      ${merchantRow({ emoji: '🛒', color: '#E9F7EF', name: 'רמי לוי', meta: 'Isracard Platinum', subtitle: 'Groceries', amount: '−₪342.18' })}
      ${merchantRow({ emoji: '💼', color: '#EAF3FF', name: 'Salary', meta: 'Hapoalim Checking', subtitle: 'Income', amount: '+₪18,400', positive: true })}
      ${merchantRow({ emoji: '📱', color: '#F0EDFF', name: 'Bezeq', meta: 'Hapoalim Checking', subtitle: 'Utilities', amount: '−₪129.90' })}
    </div>
  </div>`;

  function searchBody() {
    return `<div class="search-landing">
      <div class="search-topline"><div class="search-field focused">${icon('search')}<span>Rami Levi</span></div><button class="text-button">Cancel</button></div>
      <div class="chip-row" style="margin-top:10px"><span class="pill active">All time</span><span class="pill">This month</span><span class="pill">Groceries</span></div>
      <div class="section"><div class="section-head compact"><h2>Quick searches</h2></div><div class="suggestion-row">
        <div class="suggestion"><div class="row-icon">${icon('calendar')}</div><strong>Last 30 days</strong><span>173 transactions</span></div>
        <div class="suggestion"><div class="row-icon" style="color:var(--purple);background:var(--purple-soft)">${icon('sparkle')}</div><strong>Needs review</strong><span>3 suggestions</span></div>
      </div></div>
      <div class="section"><div class="section-head compact"><h2>Results</h2><span class="caption">4 matches</span></div><div class="list-group">
        ${merchantRow({ emoji: '🛒', color: '#E9F7EF', name: 'רמי לוי', meta: 'Jul 13 · Groceries', amount: '−₪342.18' })}
        ${merchantRow({ emoji: '🛒', color: '#E9F7EF', name: 'רמי לוי', meta: 'Jul 5 · Groceries', amount: '−₪218.60' })}
        ${merchantRow({ emoji: '🛒', color: '#E9F7EF', name: 'רמי לוי', meta: 'Jun 28 · Groceries', amount: '−₪287.10' })}
        ${merchantRow({ emoji: '🛒', color: '#E9F7EF', name: 'רמי לוי', meta: 'Jun 16 · Groceries', amount: '−₪194.35' })}
      </div></div>
    </div>`;
  }

  const screens = {
    welcome: {
      title: 'Welcome',
      subtitle: 'Private by design',
      render: () =>
        onboardingScreen(`<div class="welcome-art"><img class="app-icon-large" src="../../electron/icons/icon-master.png" alt="" /></div>
          <div class="onboard-copy"><h1>Your finances.<br />Still on your Mac.</h1><p>Money Monitor brings your private financial picture to iPhone without moving bank credentials or scraping to the cloud.</p></div>
          <div class="onboard-footer"><div class="privacy-note">${icon('shield')}<span>Your iPhone connects directly to your Mac. Bank credentials never leave it.</span></div><button class="primary-button wide-button">Get started</button></div>`),
    },
    connect: {
      title: 'Connect to Mac',
      subtitle: 'Tailscale pairing',
      render: () =>
        onboardingScreen(`<div class="setup-mark">${icon('laptop')}</div><div class="setup-heading"><h1>Connect to your Mac</h1><p>Make sure Money Monitor and Tailscale are running on the Mac you want to use.</p></div>
          <div class="step-list"><div class="step-row"><span class="step-number">1</span><div><strong>Open Money Monitor on Mac</strong><span>Settings → Mobile access</span></div></div><div class="step-row"><span class="step-number">2</span><div><strong>Scan the pairing code</strong><span>The connection stays inside your tailnet</span></div>${icon('qr', 'chevron')}</div></div>
          <div class="url-field">${icon('laptop')}<span>money-monitor.mac.tailnet.ts.net</span></div>
          <div class="onboard-footer"><button class="primary-button wide-button">Scan pairing code</button><button class="text-button wide-button">Enter address manually</button></div>`),
    },
    faceid: {
      title: 'Face ID',
      subtitle: 'Local app protection',
      render: () =>
        onboardingScreen(`<div class="face-art">${icon('face')}</div><div class="setup-heading"><h1>Protect your financial view</h1><p>Use Face ID each time Money Monitor opens or returns from the background.</p></div>
          <div class="surface success-card" style="margin-top:30px"><div class="list-row"><div class="row-icon" style="background:var(--positive-soft);color:var(--positive)">${icon('lock')}</div><div class="row-copy"><div class="row-title">Nothing sensitive in notifications</div><div class="row-subtitle">Amounts stay hidden until unlocked</div></div>${icon('check', 'positive')}</div><div class="list-row"><div class="row-icon" style="background:var(--tint-soft)">${icon('shield')}</div><div class="row-copy"><div class="row-title">Bank credentials stay on Mac</div><div class="row-subtitle">This protects the financial read model</div></div>${icon('check', 'positive')}</div></div>
          <div class="onboard-footer"><button class="primary-button wide-button">Use Face ID</button><button class="text-button wide-button">Not now</button></div>`),
    },
    ready: {
      title: 'Connected',
      subtitle: 'Ready to use',
      render: () =>
        onboardingScreen(`<div class="success-ring">${icon('check')}</div><div class="setup-heading"><h1>You're connected</h1><p>Your latest Money Monitor snapshot is ready. The Mac remains the source of truth.</p></div>
          <div class="surface success-card"><div class="list-row"><div class="row-icon" style="background:var(--positive-soft);color:var(--positive)">${icon('laptop')}</div><div class="row-copy"><div class="row-title">Saar's MacBook Pro</div><div class="row-subtitle">Private Tailscale connection</div></div><span class="status-pill"><span class="dot"></span>Live</span></div><div class="list-row"><div class="row-icon">${icon('sync')}</div><div class="row-copy"><div class="row-title">Latest data</div><div class="row-subtitle">312 transactions · 4 accounts</div></div><span class="caption">Now</span></div></div>
          <div class="onboard-footer"><button class="primary-button wide-button">Open Money Monitor</button></div>`),
    },
    home: {
      title: 'Home',
      subtitle: 'Daily financial overview',
      render: () => appScreen({ title: 'Home', active: 'home', body: homeBody() }),
    },
    activity: {
      title: 'Activity',
      subtitle: 'Transactions and review state',
      render: () => appScreen({ title: 'Activity', active: 'activity', body: activityBody() }),
    },
    search: {
      title: 'Search',
      subtitle: 'Fast transaction lookup',
      render: () => `${statusBar()}<div class="app-content with-tabs white">${searchBody()}</div>${tabBar('', true)}`,
    },
    transaction: {
      title: 'Transaction detail',
      subtitle: 'Review and edit',
      render: () =>
        appScreen({
          title: 'Transaction',
          active: 'activity',
          inline: true,
          back: 'Activity',
          trailing: icon('more'),
          body: `<div class="page-scroll inline edge"><div class="detail-amount"><div class="merchant-icon" style="background:#FFF0E6">🍜</div><h2>Wolt</h2><strong class="money negative">−₪86.40</strong><p>Today at 12:42 · Completed</p></div>
            <div class="form-group"><div class="form-row"><span class="label">Category</span><span class="value">🍽️ Dining ${icon('chevron')}</span></div><div class="form-row"><span class="label">Paid with</span><span class="value">Isracard • 4580 ${icon('chevron')}</span></div><div class="form-row"><span class="label">Owner</span><span class="value">Saar ${icon('chevron')}</span></div><div class="form-row"><span class="label">Date</span><span class="value">July 14, 2026</span></div></div>
            <div class="form-section-title">Options</div><div class="form-group"><div class="form-row"><span class="label">Exclude from reports</span><span class="toggle"></span></div><div class="form-row"><span class="label">Mark as recurring</span><span class="value">${icon('chevron')}</span></div></div>
            <div style="padding:18px 16px"><button class="secondary-button wide-button">${icon('pencil')} Add note</button></div></div>`,
        }),
    },
    filters: {
      title: 'Activity filters',
      subtitle: 'Native bottom sheet',
      render: () => `${appScreen({ title: 'Activity', active: 'activity', body: activityBody() })}<div class="modal-backdrop"></div><div class="sheet medium"><div class="grabber"></div><div class="sheet-nav"><button>Reset</button><h2>Filters</h2><button>Done</button></div><div class="sheet-body">
        <div class="form-section-title">Transaction type</div><div class="filter-grid"><span class="pill active">All</span><span class="pill">Expenses</span><span class="pill">Income</span><span class="pill">Transfers</span></div>
        <div class="form-section-title">Date</div><div class="form-group"><div class="form-row"><span class="label">Period</span><span class="value">This month ${icon('chevron')}</span></div><div class="form-row"><span class="label">Custom range</span><span class="value">${icon('calendar')}</span></div></div>
        <div class="form-section-title">Account</div><div class="filter-grid"><span class="pill active">All accounts</span><span class="pill">Hapoalim</span><span class="pill">Isracard</span><span class="pill">Max</span></div>
        <div class="form-section-title">Review</div><div class="form-group"><div class="form-row"><span class="label">Only needs review</span><span class="toggle on"></span></div><div class="form-row"><span class="label">Include excluded</span><span class="toggle"></span></div></div>
      </div></div>`,
    },
    review: {
      title: 'Review queue',
      subtitle: 'AI-assisted categorization',
      render: () =>
        appScreen({
          title: 'Review',
          active: 'activity',
          inline: true,
          back: 'Activity',
          trailing: '1 of 3',
          body: `<div class="page-scroll inline"><div class="surface review-card"><div class="review-top"><div class="merchant-icon" style="background:#FFF0E6">🍜</div><div><h2>Wolt</h2><p>−₪86.40 · Today at 12:42</p></div></div><div class="confidence"><span>Suggestion confidence</span><div class="progress-track"><div class="progress-fill" style="width:82%;background:var(--purple)"></div></div><strong style="color:var(--purple)">82%</strong></div></div>
            <div class="section"><div class="section-head compact"><h2>Choose a category</h2></div><div class="choice-stack"><div class="choice selected"><div class="category-icon" style="background:#FFF0E6">🍽️</div><div class="row-copy"><div class="row-title">Dining</div><div class="row-subtitle">Suggested from similar Wolt charges</div></div><span class="check">${icon('check')}</span></div><div class="choice"><div class="category-icon" style="background:#E9F7EF">🛒</div><div class="row-copy"><div class="row-title">Groceries</div><div class="row-subtitle">Food purchased for home</div></div><span class="check"></span></div><div class="choice"><div class="category-icon" style="background:#F0EDFF">🎉</div><div class="row-copy"><div class="row-title">Entertainment</div><div class="row-subtitle">Leisure and outings</div></div><span class="check"></span></div></div></div>
            <div class="section"><button class="primary-button wide-button">Confirm Dining</button><button class="text-button wide-button">Skip for now</button></div></div>`,
        }),
    },
    plan: {
      title: 'Plan',
      subtitle: 'Budgets and net worth',
      render: () =>
        appScreen({
          title: 'Plan',
          active: 'plan',
          body: `<div class="page-scroll"><div class="segmented"><span class="segment active">Spending</span><span class="segment">Net Worth</span></div>
            <div class="section"><div class="surface budget-summary"><div class="ring" style="--progress:68%;--ring-color:var(--tint)"><div class="ring-content"><strong>68%</strong><span>used</span></div></div><div class="budget-copy"><p class="eyeline">July budget</p><strong class="money">₪8,219 left</strong><p>₪4,781 of ₪13,000 · On track</p></div></div></div>
            <div class="section"><div class="section-head"><h2>Budgets</h2><button class="section-link">${icon('plus')} Add</button></div><div class="list-group">
              ${budgetRow('🍽️', '#FFF0E6', 'Dining', '₪1,146 of ₪1,500', 76, '₪354 left')}
              ${budgetRow('🛒', '#E9F7EF', 'Groceries', '₪1,228 of ₪2,400', 51, '₪1,172 left')}
              ${budgetRow('🚆', '#EAF3FF', 'Transport', '₪410 of ₪900', 46, '₪490 left')}
              ${budgetRow('🛍️', '#F0EDFF', 'Shopping', '₪1,184 of ₪1,000', 100, '₪184 over', true)}
            </div></div>
            <div class="section"><div class="review-banner"><div class="glyph">${icon('chart')}</div><div><strong>Net worth is up ₪7,240</strong><p>₪715,709 total · +1.0% this month</p></div>${icon('chevron', 'chevron')}</div></div></div>`,
        }),
    },
    'budget-detail': {
      title: 'Budget detail',
      subtitle: 'Category pace and transactions',
      render: () =>
        appScreen({
          title: 'Dining',
          active: 'plan',
          inline: true,
          back: 'Plan',
          trailing: 'Edit',
          body: `<div class="page-scroll inline"><div class="surface budget-summary"><div class="ring" style="--progress:76%;--ring-color:var(--warning)"><div class="ring-content"><strong>76%</strong><span>used</span></div></div><div class="budget-copy"><p class="eyeline">July</p><strong class="money">₪354 left</strong><p>₪1,146 of ₪1,500</p></div></div>
            <div class="section"><div class="surface summary-surface"><div style="display:flex;justify-content:space-between;align-items:flex-end"><div><p class="eyeline">At this pace</p><strong style="display:block;font-size:20px;margin-top:3px" class="money">₪1,620</strong></div><span class="status-pill warning-state">₪120 over plan</span></div><div class="progress-track" style="margin-top:14px;height:9px"><div class="progress-fill" style="width:81%;background:var(--warning)"></div></div><p class="caption" style="margin:8px 0 0">14 days left · about ₪25 per day available</p></div></div>
            <div class="section"><div class="section-head compact"><h2>Recent dining</h2><button class="section-link">See all</button></div><div class="list-group">
              ${merchantRow({ emoji: '🍜', color: '#FFF0E6', name: 'Wolt', meta: 'Today', amount: '−₪86.40' })}
              ${merchantRow({ emoji: '☕️', color: '#F6EEE8', name: 'Café Xoho', meta: 'Today', amount: '−₪28.00' })}
              ${merchantRow({ emoji: '🍕', color: '#FFF0E6', name: 'Brooklyn Pizza', meta: 'Jul 12', amount: '−₪94.00' })}
              ${merchantRow({ emoji: '🥡', color: '#FFF0E6', name: 'Japanika', meta: 'Jul 10', amount: '−₪142.60' })}
            </div></div></div>`,
        }),
    },
    'budget-edit': {
      title: 'Edit budget',
      subtitle: 'Focused native sheet',
      render: () => `${appScreen({ title: 'Dining', active: 'plan', inline: true, back: 'Plan', trailing: 'Edit', body: '<div class="page-scroll inline"><div class="surface budget-summary"><div class="ring" style="--progress:76%;--ring-color:var(--warning)"><div class="ring-content"><strong>76%</strong><span>used</span></div></div><div class="budget-copy"><p class="eyeline">July</p><strong class="money">₪354 left</strong><p>₪1,146 of ₪1,500</p></div></div></div>' })}<div class="modal-backdrop"></div><div class="sheet large"><div class="grabber"></div><div class="sheet-nav"><button>Cancel</button><h2>Edit budget</h2><button>Done</button></div><div class="sheet-body">
        <div class="form-section-title">Budget</div><div class="form-group"><div class="form-row"><span class="label">Name</span><span class="value" style="color:var(--ink)">Dining</span></div><div class="form-row"><span class="label">Amount</span><span class="value money" style="color:var(--ink)">₪1,500</span></div><div class="form-row"><span class="label">Period</span><span class="value">Monthly ${icon('chevron')}</span></div></div>
        <div class="form-section-title">Categories</div><div class="form-group"><div class="form-row"><span class="category-icon" style="width:32px;height:32px;background:#FFF0E6">🍽️</span><span class="label">Dining</span>${icon('check', 'positive')}</div><div class="form-row"><span class="category-icon" style="width:32px;height:32px;background:#F6EEE8">☕️</span><span class="label">Coffee</span>${icon('check', 'positive')}</div><div class="form-row"><span class="category-icon" style="width:32px;height:32px;background:#E9F7EF">🛒</span><span class="label">Groceries</span></div></div>
        <div class="form-section-title">Alert</div><div class="form-group"><div class="form-row"><span class="label">Notify near limit</span><span class="toggle on"></span></div><div class="form-row"><span class="label">Threshold</span><span class="value">80% ${icon('chevron')}</span></div></div>
        <div style="padding:18px 16px"><button class="danger-button wide-button">Delete budget</button></div>
      </div></div>`,
    },
    'net-worth': {
      title: 'Net Worth',
      subtitle: 'Wealth overview and allocation',
      render: () =>
        appScreen({
          title: 'Net Worth',
          active: 'plan',
          inline: true,
          back: 'Plan',
          trailing: icon('more'),
          body: `<div class="page-scroll inline"><div class="surface wealth-hero"><p class="eyeline">Total net worth</p><h2 class="money">₪715,709</h2><div class="trend-copy">${icon('arrowup')} ₪7,240 this month</div><div class="wealth-meta"><div><span class="caption">Assets</span><strong class="money">₪836,209</strong></div><div><span class="caption">Liabilities</span><strong class="money negative">₪120,500</strong></div></div></div>
            <div class="section"><div class="surface chart-card"><h3>12-month trend</h3><p>Up 15.4% since July 2025</p>${wealthChart()}</div></div>
            <div class="section"><div class="section-head compact"><h2>Allocation</h2><button class="section-link">Details</button></div><div class="surface allocation"><div class="donut"><div class="donut-center"><strong>₪836K</strong><span>assets</span></div></div><div class="legend"><div class="legend-row"><i style="background:var(--chart-indigo)"></i><span>Real estate</span><strong>58%</strong></div><div class="legend-row"><i style="background:#2CBF91"></i><span>Investments</span><strong>21%</strong></div><div class="legend-row"><i style="background:var(--tint)"></i><span>Cash</span><strong>13%</strong></div><div class="legend-row"><i style="background:var(--warning)"></i><span>Other</span><strong>8%</strong></div></div></div></div>
            <div class="section"><div class="section-head compact"><h2>Assets</h2></div><div class="list-group">${assetRow('🏠', '#F0EDFF', 'Tel Aviv apartment', 'Real estate', '₪490,000', '+0.8%')}${assetRow('📈', '#E9F7EF', 'IBKR Portfolio', 'Brokerage', '₪176,420', '+2.1%')}</div></div></div>`,
        }),
    },
    'asset-detail': {
      title: 'Asset detail',
      subtitle: 'Value, history, and movements',
      render: () =>
        appScreen({
          title: 'Apartment',
          active: 'plan',
          inline: true,
          back: 'Net Worth',
          trailing: 'Edit',
          body: `<div class="page-scroll inline"><div class="surface account-hero"><div class="account-hero-top"><div class="account-icon" style="background:var(--purple-soft);color:var(--purple)">${icon('house')}</div><div><h2>Tel Aviv apartment</h2><p>Real estate · ILS</p></div></div><div class="account-balance"><div><span class="caption">Current value</span><strong class="money">₪490,000</strong></div><span class="status-pill">+₪4,000</span></div></div>
            <div class="section"><div class="surface chart-card"><h3>Value history</h3><p>Updated manually on July 1</p>${assetChart()}</div></div>
            <div class="section"><div class="section-head compact"><h2>Details</h2></div><div class="list-group full-separators"><div class="list-row"><div class="row-copy"><div class="row-title">Liquidity</div></div><span class="row-subtitle">Locked</span></div><div class="list-row"><div class="row-copy"><div class="row-title">Linked mortgage</div></div><span class="row-subtitle">−₪120,500</span>${icon('chevron', 'chevron')}</div><div class="list-row"><div class="row-copy"><div class="row-title">Net equity</div></div><strong class="money">₪369,500</strong></div></div></div>
            </div>`,
        }),
    },
    advisor: {
      title: 'Advisor',
      subtitle: 'Suggested questions and history',
      render: () =>
        appScreen({
          title: 'Advisor',
          active: 'advisor',
          body: `<div class="page-scroll"><div class="advisor-intro"><div class="advisor-mark">${icon('sparkle')}</div><h2>Ask your finances</h2><p>Answers use the latest data from your Mac and show exactly what they include.</p></div><div class="prompt-grid"><div class="prompt-card"><div class="row-icon" style="background:var(--tint-soft)">${icon('chart')}</div><strong>Where am I overspending?</strong><span>Compare July with your usual pace</span></div><div class="prompt-card"><div class="row-icon" style="background:var(--positive-soft);color:var(--positive)">${icon('wallet')}</div><strong>Can I stay on budget?</strong><span>Project the rest of this month</span></div><div class="prompt-card"><div class="row-icon" style="background:var(--purple-soft);color:var(--purple)">${icon('receipt')}</div><strong>Find my subscriptions</strong><span>Review recurring charges</span></div><div class="prompt-card"><div class="row-icon" style="background:var(--warning-soft);color:var(--warning)">${icon('calendar')}</div><strong>Summarize last month</strong><span>Income, spend, and changes</span></div></div>
            <div class="section"><div class="section-head compact"><h2>Recent conversations</h2></div><div class="list-group"><div class="list-row"><div class="row-icon" style="background:var(--purple-soft);color:var(--purple)">${icon('sparkle')}</div><div class="row-copy"><div class="row-title">July spending check</div><div class="row-subtitle">Today · 4 messages</div></div>${icon('chevron', 'chevron')}</div><div class="list-row"><div class="row-icon">${icon('sparkle')}</div><div class="row-copy"><div class="row-title">Thailand flights</div><div class="row-subtitle">Yesterday · 6 messages</div></div>${icon('chevron', 'chevron')}</div></div></div></div><div class="chat-composer"><span>Ask about your finances…</span><div class="send-button">${icon('arrowup')}</div></div>`,
        }),
    },
    'advisor-chat': {
      title: 'Advisor conversation',
      subtitle: 'Explainable financial answer',
      render: () => advisorChat(false),
    },
    accounts: {
      title: 'Accounts',
      subtitle: 'Connection health and balances',
      render: () =>
        appScreen({
          title: 'Accounts',
          active: 'home',
          inline: true,
          back: 'Home',
          trailing: icon('plus'),
          body: `<div class="page-scroll inline"><div class="sync-strip"><span style="display:flex;align-items:center;gap:7px"><span class="dot"></span>All accounts current</span><span class="muted">Sync now ›</span></div>
            <div class="section"><div class="section-head compact"><h2>Bank accounts</h2><span class="caption">₪109,551</span></div><div class="list-group">${accountRow('bank', '#EAF3FF', 'Hapoalim Checking', 'Updated 2m ago', '₪24,350.80', 'Live')}${accountRow('bank', '#E9F7EF', 'Leumi Savings', 'Updated 2m ago', '₪85,200.00', 'Live')}</div></div>
            <div class="section"><div class="section-head compact"><h2>Credit cards</h2><span class="caption">₪5,443 due</span></div><div class="list-group">${accountRow('card', '#F0EDFF', 'Isracard Platinum', 'Closes Jul 24', '₪4,081.50', 'Current')}${accountRow('card', '#FFF6E8', 'Max Visa', 'Closes Jul 26', '₪1,361.90', 'Current')}</div></div>
            <div class="section"><div class="review-banner" style="background:var(--surface)"><div class="glyph" style="background:var(--tint-soft);color:var(--tint)">${icon('sync')}</div><div><strong>Sync history</strong><p>Last full scrape finished in 1m 42s</p></div>${icon('chevron', 'chevron')}</div></div></div>`,
        }),
    },
    'account-detail': {
      title: 'Account detail',
      subtitle: 'Balance, activity, and sync',
      render: () =>
        appScreen({
          title: 'Account',
          active: 'home',
          inline: true,
          back: 'Accounts',
          trailing: icon('more'),
          body: `<div class="page-scroll inline"><div class="surface account-hero"><div class="account-hero-top"><div class="account-icon" style="background:var(--tint-soft)">${icon('bank')}</div><div><h2>Hapoalim Checking</h2><p>Bank Hapoalim · •••• 3456</p></div><span class="status-pill" style="margin-left:auto"><span class="dot"></span>Live</span></div><div class="account-balance"><div><span class="caption">Available balance</span><strong class="money">₪24,350.80</strong></div><span class="caption">Updated 2m ago</span></div><div class="account-actions"><div class="account-action">${icon('sync')}<span>Sync</span></div><div class="account-action">${icon('activity')}<span>Activity</span></div><div class="account-action">${icon('gear')}<span>Settings</span></div></div></div>
            <div class="section"><div class="section-head compact"><h2>Latest activity</h2><button class="section-link">See all</button></div><div class="list-group">${merchantRow({ emoji: '💼', color: '#EAF3FF', name: 'Salary', meta: 'Yesterday · Income', amount: '+₪18,400', positive: true })}${merchantRow({ emoji: '📱', color: '#F0EDFF', name: 'Bezeq', meta: 'Jul 12 · Utilities', amount: '−₪129.90' })}${merchantRow({ emoji: '🏠', color: '#FFF6E8', name: 'Rent', meta: 'Jul 1 · Housing', amount: '−₪5,200' })}</div></div>
            <div class="section"><div class="form-group"><div class="form-row"><span class="label">Default owner</span><span class="value">Saar ${icon('chevron')}</span></div><div class="form-row"><span class="label">Manual sync only</span><span class="toggle"></span></div></div></div></div>`,
        }),
    },
    'sync-history': {
      title: 'Sync history',
      subtitle: 'Mac scrape status translated for mobile',
      render: () =>
        appScreen({
          title: 'Sync History',
          active: 'home',
          inline: true,
          back: 'Accounts',
          trailing: icon('sync'),
          body: `<div class="page-scroll inline"><div class="surface summary-surface"><div style="display:flex;align-items:center;justify-content:space-between"><div><p class="eyeline">Latest sync</p><strong style="display:block;margin-top:3px;font-size:21px">All 4 accounts updated</strong></div><span class="status-pill"><span class="dot"></span>Complete</span></div><p class="caption" style="margin:8px 0 0">Today at 09:32 · 14 new transactions · 1m 42s</p></div>
            <div class="section"><div class="section-head compact"><h2>Recent</h2></div><div class="surface" style="overflow:hidden"><div class="timeline-row"><div class="timeline-mark">${icon('check')}</div><div class="timeline-copy"><strong>Full sync completed</strong><p>Today, 09:32 · 4 accounts · 14 new</p></div><span class="caption">1m 42s</span></div><div class="timeline-row"><div class="timeline-mark">${icon('check')}</div><div class="timeline-copy"><strong>Isracard updated</strong><p>Yesterday, 18:08 · 2 new transactions</p></div><span class="caption">24s</span></div><div class="timeline-row"><div class="timeline-mark" style="color:var(--warning)">${icon('info')}</div><div class="timeline-copy"><strong>Max needed attention</strong><p>Yesterday, 06:01 · Session expired, resolved</p></div><span class="caption">1m</span></div><div class="timeline-row"><div class="timeline-mark">${icon('check')}</div><div class="timeline-copy"><strong>Scheduled sync completed</strong><p>Jul 12, 06:00 · 4 accounts · 8 new</p></div><span class="caption">1m 31s</span></div></div></div>
            <div class="section"><button class="primary-button wide-button">Sync all accounts</button><p class="caption" style="text-align:center;margin:8px 14px">The Mac performs the sync. You can leave this screen.</p></div></div>`,
        }),
    },
    categories: {
      title: 'Categories',
      subtitle: 'Native grouped management',
      render: () =>
        appScreen({
          title: 'Categories',
          active: 'home',
          inline: true,
          back: 'Settings',
          trailing: icon('plus'),
          body: `<div class="page-scroll inline"><div class="search-field" style="margin:2px 0 14px">${icon('search')}<span>Search categories</span></div><div class="section-head compact"><h2>Expenses</h2><button class="section-link">Edit</button></div><div class="list-group">
            ${categoryRow('🍽️', '#FFF0E6', 'Dining', '27 transactions', '#F48B4A')}${categoryRow('🛒', '#E9F7EF', 'Groceries', '18 transactions', '#2CBF91')}${categoryRow('🚆', '#EAF3FF', 'Transport', '14 transactions', '#1672F3')}${categoryRow('🛍️', '#F0EDFF', 'Shopping', '9 transactions', '#7C5CE7')}${categoryRow('📱', '#FFF6E8', 'Utilities', '7 transactions', '#D97706')}
            </div><div class="section"><div class="section-head compact"><h2>Income</h2></div><div class="list-group">${categoryRow('💼', '#E9F7EF', 'Salary', '1 transaction', '#198754')}${categoryRow('💸', '#EAF3FF', 'Refunds', '3 transactions', '#1672F3')}</div></div></div>`,
        }),
    },
    alerts: {
      title: 'Alerts',
      subtitle: 'Mobile notification preferences',
      render: () =>
        appScreen({
          title: 'Alerts',
          active: 'home',
          inline: true,
          back: 'Settings',
          body: `<div class="page-scroll inline edge"><div class="form-section-title">MONEY MONITOR</div><div class="form-group"><div class="form-row"><span class="label">Financial alerts</span><span class="toggle on"></span></div></div><p class="caption" style="margin:7px 22px 0">The Mac analyzes new data after each sync. Notifications hide amounts until Face ID unlocks the app.</p>
            <div class="form-section-title">TRANSACTIONS</div><div class="form-group"><div class="form-row"><span class="label">Large charges</span><span class="toggle on"></span></div><div class="form-row"><span class="label">Threshold</span><span class="value money">₪1,000 ${icon('chevron')}</span></div><div class="form-row"><span class="label">Unusual spending</span><span class="toggle on"></span></div><div class="form-row"><span class="label">Needs review</span><span class="toggle on"></span></div></div>
            <div class="form-section-title">SUMMARIES</div><div class="form-group"><div class="form-row"><span class="label">Monthly summary</span><span class="toggle on"></span></div><div class="form-row"><span class="label">Send on</span><span class="value">1st of month ${icon('chevron')}</span></div><div class="form-row"><span class="label">Budget warnings</span><span class="toggle on"></span></div></div>
            <div class="form-section-title">SYSTEM</div><div class="form-group"><div class="form-row"><span class="label">Sync failures</span><span class="toggle on"></span></div><div class="form-row"><span class="label">Mac unavailable</span><span class="toggle"></span></div></div>
            <div style="padding:18px 16px"><button class="secondary-button wide-button">Send test notification</button></div></div>`,
        }),
    },
    settings: {
      title: 'Settings',
      subtitle: 'Privacy, household, and app controls',
      render: () =>
        appScreen({
          title: 'Settings',
          active: 'home',
          inline: true,
          back: 'Home',
          body: `<div class="page-scroll inline edge"><div class="settings-avatar"><div class="avatar">S</div><div><h2>Saar</h2><p>Saar's MacBook Pro · Connected</p></div>${icon('chevron', 'chevron')}</div>
            <div class="form-section-title">MONEY MONITOR</div><div class="list-group" style="margin:0 16px">${settingsRow('bank', '#1672F3', 'Accounts', '4')}${settingsRow('sync', '#198754', 'Sync history', '')}${settingsRow('tag', '#7C5CE7', 'Categories', '12')}${settingsRow('bell', '#D97706', 'Alerts', 'On')}</div>
            <div class="form-section-title">APP</div><div class="list-group" style="margin:0 16px">${settingsRow('face', '#1672F3', 'Face ID', 'On')}${settingsRow('person', '#7C5CE7', 'Household', '2 members')}${settingsRow('eye', '#198754', 'Appearance', 'System')}</div>
            <div class="form-section-title">PRIVACY & CONNECTION</div><div class="list-group" style="margin:0 16px">${settingsRow('shield', '#198754', 'Local-first privacy', '', 'Credentials and scraping stay on Mac')}${settingsRow('laptop', '#1672F3', 'Connected Mac', 'Live')}${settingsRow('key', '#D97706', 'Connection key', '')}</div>
            <div class="form-section-title">ABOUT</div><div class="list-group" style="margin:0 16px">${settingsRow('info', '#8E8E93', 'About Money Monitor', '0.4.0')}${settingsRow('external', '#8E8E93', 'Help & documentation', '')}</div></div>`,
        }),
    },
    offline: {
      title: 'Mac unavailable',
      subtitle: 'Useful cached-data state',
      render: () => `${statusBar()}<div class="app-content with-tabs"><div class="offline-hero"><div class="offline-mark">${icon('offline')}</div><h1>Your Mac is unavailable</h1><p>You can keep browsing the latest saved snapshot. Editing and Advisor will return when the private connection is back.</p><div class="cache-card"><strong>Saved today at 08:42</strong><p>312 transactions · 4 accounts · 12 budgets<br />No bank credentials are stored on this iPhone.</p></div><button class="primary-button wide-button">Try again</button><button class="text-button wide-button">Open saved data</button></div></div>${tabBar('home')}`,
    },
    'home-dark': {
      title: 'Home — Dark Mode',
      subtitle: 'System appearance coverage',
      dark: true,
      render: () => appScreen({ title: 'Home', active: 'home', body: homeBody(), dark: true }),
    },
    'advisor-dark': {
      title: 'Advisor — Dark Mode',
      subtitle: 'Conversation appearance coverage',
      dark: true,
      render: () => advisorChat(true),
    },
  };

  function budgetRow(emoji, color, name, amount, progress, remaining, over = false) {
    return `<div class="list-row budget-row"><div class="category-icon" style="background:${color}">${emoji}</div><div class="row-copy"><div style="display:flex;justify-content:space-between;gap:8px"><div class="row-title">${name}</div><strong class="money ${over ? 'negative' : ''}" style="font-size:12px">${remaining}</strong></div><div class="budget-progress"><div class="progress-track"><div class="progress-fill" style="width:${progress}%;background:${over ? 'var(--negative)' : progress > 70 ? 'var(--warning)' : 'var(--tint)'}"></div></div><span>${amount}</span></div></div>${icon('chevron', 'chevron')}</div>`;
  }

  function assetRow(emoji, color, name, type, amount, trend) {
    return `<div class="list-row"><div class="account-icon" style="background:${color}">${emoji}</div><div class="row-copy"><div class="row-title">${name}</div><div class="row-subtitle">${type}</div></div><div class="row-value"><strong class="money">${amount}</strong><span class="positive">${trend}</span></div>${icon('chevron', 'chevron')}</div>`;
  }

  function accountRow(glyph, color, name, meta, amount, state) {
    return `<div class="list-row"><div class="account-icon" style="background:${color};color:var(--tint)">${icon(glyph)}</div><div class="row-copy"><div class="row-title">${name}</div><div class="row-subtitle">${meta}</div></div><div class="row-value"><strong class="money">${amount}</strong><span class="positive">${state}</span></div>${icon('chevron', 'chevron')}</div>`;
  }

  function categoryRow(emoji, color, name, count, swatch) {
    return `<div class="list-row"><div class="category-icon" style="background:${color}">${emoji}</div><div class="row-copy"><div class="row-title">${name}</div><div class="row-subtitle">${count}</div></div><span class="category-swatch" style="background:${swatch}"></span><span class="reorder">≡</span></div>`;
  }

  function wealthChart() {
    return `<svg class="line-chart" viewBox="0 0 330 128" preserveAspectRatio="none" aria-label="Net worth increased from 620 thousand shekels to 716 thousand shekels over 12 months"><line class="grid-line" x1="0" y1="98" x2="330" y2="98"/><line class="grid-line" x1="0" y1="58" x2="330" y2="58"/><line class="grid-line" x1="0" y1="18" x2="330" y2="18"/><path class="area" d="M0 101 C34 99 55 96 82 97 S117 92 145 86 174 56 198 52 232 47 252 41 285 35 330 30 L330 110H0Z"/><path class="line" d="M0 101 C34 99 55 96 82 97 S117 92 145 86 174 56 198 52 232 47 252 41 285 35 330 30"/><text x="0" y="124">Jul</text><text x="98" y="124">Nov</text><text x="205" y="124">Mar</text><text x="310" y="124">Jul</text></svg>`;
  }

  function assetChart() {
    return `<svg class="line-chart" viewBox="0 0 330 128" preserveAspectRatio="none" aria-label="Apartment value increased from 456 thousand shekels to 490 thousand shekels"><line class="grid-line" x1="0" y1="98" x2="330" y2="98"/><line class="grid-line" x1="0" y1="58" x2="330" y2="58"/><line class="grid-line" x1="0" y1="18" x2="330" y2="18"/><path class="area" style="fill:color-mix(in srgb,var(--purple) 12%,transparent)" d="M0 99 C45 96 58 91 92 90 S142 78 172 79 214 58 246 56 288 43 330 37 L330 110H0Z"/><path class="line" style="stroke:var(--purple)" d="M0 99 C45 96 58 91 92 90 S142 78 172 79 214 58 246 56 288 43 330 37"/><text x="0" y="124">2022</text><text x="98" y="124">2023</text><text x="205" y="124">2024</text><text x="302" y="124">Now</text></svg>`;
  }

  function advisorChat(dark) {
    return appScreen({
      title: 'Advisor',
      active: 'advisor',
      inline: true,
      back: 'Chats',
      trailing: icon('more'),
      dark,
      body: `<div class="chat-scroll"><div class="bubble-row user"><div class="bubble"><p>Where am I overspending this month?</p></div></div><div class="bubble-row assistant"><div class="bubble"><p><strong>Dining is the main category to watch.</strong> You're ₪246 above your usual pace for this point in July.</p><div class="answer-insight"><div class="answer-line"><span>Dining</span><strong class="negative">+₪246</strong></div><div class="answer-line"><span>Shopping</span><strong class="negative">+₪184</strong></div><div class="answer-line"><span>Transport</span><strong class="positive">−₪92</strong></div></div><p>If spending continues at this pace, Dining will finish about <strong>₪120 over budget</strong>.</p></div></div><div class="bubble-row user"><div class="bubble"><p>What changed in dining?</p></div></div><div class="bubble-row assistant"><div class="bubble"><p>You ordered from Wolt 6 times this month versus 3 times by this date in June. Those extra orders account for ₪214 of the increase.</p><p class="caption" style="margin-top:9px">Based on 14 dining transactions · Updated 2m ago</p></div></div></div><div class="chat-composer"><span>Ask a follow-up…</span><div class="send-button">${icon('arrowup')}</div></div>`,
    });
  }

  const boards = [
    {
      id: 'setup',
      title: 'Setup & trust',
      subtitle: 'A short pairing flow that makes the local-first boundary clear without exposing infrastructure.',
      screens: ['welcome', 'connect', 'faceid', 'ready'],
    },
    {
      id: 'everyday',
      title: 'Everyday money',
      subtitle: 'The daily glance, transaction activity, search, editing, filters, and AI review loop.',
      screens: ['home', 'activity', 'search', 'transaction', 'filters', 'review'],
    },
    {
      id: 'planning',
      title: 'Planning & wealth',
      subtitle: 'Budgets and net worth share one top-level Plan area, with native drill-downs for depth.',
      screens: ['plan', 'budget-detail', 'budget-edit', 'net-worth', 'asset-detail'],
    },
    {
      id: 'control',
      title: 'Advisor & connected data',
      subtitle: 'Conversational insight, account health, scrape history, and category management.',
      screens: ['advisor', 'advisor-chat', 'accounts', 'account-detail', 'sync-history', 'categories'],
    },
    {
      id: 'system',
      title: 'Settings, resilience & appearance',
      subtitle: 'Notification controls, privacy settings, cached-data behavior, and first-class Dark Mode.',
      screens: ['alerts', 'settings', 'offline', 'home-dark', 'advisor-dark'],
    },
  ];

  function boardMarkup(board) {
    return `<section class="board-section" data-board="${board.id}"><div class="board-heading"><h2>${board.title}</h2><p>${board.subtitle}</p></div><div class="board-grid">${board.screens
      .map((id) => {
        const item = screens[id];
        return `<article class="board-item"><div class="scaled-phone">${shell(id)}</div><p class="screen-label">${item.title}<span>${item.subtitle}</span></p></article>`;
      })
      .join('')}</div></section>`;
  }

  function deckMarkup(selectedBoard) {
    const chosen = selectedBoard ? boards.filter((board) => board.id === selectedBoard) : boards;
    const title = selectedBoard
      ? chosen[0]?.title || 'Money Monitor iOS'
      : 'A private financial companion that feels at home on iPhone.';
    const subtitle = selectedBoard
      ? chosen[0]?.subtitle || ''
      : '26 high-fidelity screens translate the complete desktop product into a focused native iOS experience—without moving bank credentials, scraping, or source-of-truth data off the Mac.';
    return `<div class="deck"><header class="deck-header"><div><p class="deck-kicker">Money Monitor · Native iOS</p><h1 class="deck-title">${title}</h1><p class="deck-subtitle">${subtitle}</p></div><div class="deck-meta">393 × 852 pt<br />Light + Dark Mode<br />Local-first over Tailscale</div></header>${chosen.map(boardMarkup).join('')}</div>`;
  }

  const params = new URLSearchParams(window.location.search);
  const screenId = params.get('screen');
  const boardId = params.get('board');
  const renderScale = params.get('scale');
  const app = document.querySelector('#app');

  if (screenId && screens[screenId]) {
    document.body.classList.add('render-single');
    if (renderScale === '2') document.body.classList.add('scale-2');
    app.innerHTML = `<div class="single-stage">${shell(screenId)}</div>`;
  } else {
    if (boardId) document.body.classList.add('render-board');
    app.innerHTML = deckMarkup(boardId);
  }
})();
