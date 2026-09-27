import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { getSettings } from './api/client';
import App from './App.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./components/OverviewDashboard.vue') },
    { path: '/insights', component: () => import('./components/ReviewWorkspace.vue') },
    { path: '/insights/advanced', component: () => import('./components/InsightsPage.vue') },
    { path: '/explore', component: () => import('./components/ExploreDashboard.vue') },
    {
      path: '/explore/category/:name',
      component: () => import('./components/CategoryExploreDetail.vue'),
    },
    {
      path: '/explore/merchant/:name',
      component: () => import('./components/MerchantExploreDetail.vue'),
    },
    {
      path: '/explore/monthly-comparison',
      component: () => import('./components/MonthlyComparison.vue'),
    },
    { path: '/cash-flow', component: () => import('./components/CashFlowPage.vue') },
    {
      path: '/recurring-payments',
      component: () => import('./components/RecurringPaymentsPage.vue'),
    },
    { path: '/transactions', component: () => import('./components/ActivitySplitPrototype.vue') },
    {
      path: '/transactions/advanced',
      component: () => import('./components/TransactionTable.vue'),
    },
    { path: '/accounts', component: () => import('./components/AccountsWorkspace.vue') },
    { path: '/accounts/advanced', component: () => import('./components/AccountManager.vue') },
    { path: '/chat', component: () => import('./components/AiChat.vue') },
    { path: '/categories', component: () => import('./components/CategoriesWorkspace.vue') },
    { path: '/categories/advanced', component: () => import('./components/CategoryManager.vue') },
    { path: '/scraping', component: () => import('./components/ScrapingDashboard.vue') },
    { path: '/net-worth', component: () => import('./components/NetWorthPage.vue') },
    { path: '/net-worth/assets/:id', component: () => import('./components/AssetDetailPage.vue') },
    { path: '/budgets', component: () => import('./components/BudgetsPage.vue') },
    { path: '/alerts', component: () => import('./components/AlertsPage.vue') },
    { path: '/setup', name: 'setup', component: () => import('./components/SetupWizard.vue') },
    { path: '/settings', component: () => import('./components/SettingsPage.vue') },
  ],
});

if (import.meta.env.DEV) {
  router.addRoute({
    path: '/prototype/split-view',
    name: 'split-prototype',
    component: () => import('./components/ActivitySplitPrototype.vue'),
  });
}

// Redirect to setup wizard on first Electron launch (config.json missing)
let setupChecked = false;
router.beforeEach(async (to) => {
  if (setupChecked || to.name === 'setup') return;
  setupChecked = true;
  try {
    const { needsSetup } = await getSettings();
    if (needsSetup) return '/setup';
  } catch (err) {
    console.warn('[Router] Settings check failed, continuing without setup redirect:', err);
  }
});

const app = createApp(App);
app.use(router);
app.mount('#app');
