import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./components/OverviewDashboard.vue') },
    { path: '/transactions', component: () => import('./components/TransactionTable.vue') },
    { path: '/accounts', component: () => import('./components/AccountManager.vue') },
    { path: '/chat', component: () => import('./components/AiChat.vue') },
    { path: '/categories', component: () => import('./components/CategoryManager.vue') },
    { path: '/scraping', component: () => import('./components/ScrapingDashboard.vue') },
  ],
});

const app = createApp(App);
app.use(router);
app.mount('#app');
