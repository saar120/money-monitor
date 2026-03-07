import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { getSettings } from './api/client';
import App from './App.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./components/OverviewDashboard.vue') },
    { path: '/insights', component: () => import('./components/InsightsPage.vue') },
    { path: '/transactions', component: () => import('./components/TransactionTable.vue') },
    { path: '/accounts', component: () => import('./components/AccountManager.vue') },
    { path: '/chat', component: () => import('./components/AiChat.vue') },
    { path: '/categories', component: () => import('./components/CategoryManager.vue') },
    { path: '/scraping', component: () => import('./components/ScrapingDashboard.vue') },
    { path: '/net-worth', component: () => import('./components/NetWorthPage.vue') },
    { path: '/net-worth/assets/:id', component: () => import('./components/AssetDetailPage.vue') },
    { path: '/setup', name: 'setup', component: () => import('./components/SetupWizard.vue') },
    { path: '/settings', component: () => import('./components/SettingsPage.vue') },
  ],
});

// Redirect to setup wizard on first Electron launch (config.json missing)
let setupChecked = false;
router.beforeEach(async (to) => {
  if (setupChecked || to.name === 'setup') return;
  setupChecked = true;
  try {
    const { needsSetup } = await getSettings();
    if (needsSetup) return '/setup';
  } catch {
    // Settings endpoint unavailable — continue normally
  }
});

const app = createApp(App);
app.use(router);
app.mount('#app');
