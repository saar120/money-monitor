<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();

const navItems = [
  { path: '/', label: 'Overview', icon: '📊' },
  { path: '/transactions', label: 'Transactions', icon: '📋' },
  { path: '/accounts', label: 'Accounts', icon: '🏦' },
  { path: '/chat', label: 'AI Chat', icon: '🤖' },
];
</script>

<template>
  <div class="app-layout">
    <nav class="sidebar">
      <div class="logo">Money Monitor</div>
      <ul>
        <li v-for="item in navItems" :key="item.path">
          <router-link
            :to="item.path"
            :class="{ active: route.path === item.path }"
          >
            <span class="icon">{{ item.icon }}</span>
            {{ item.label }}
          </router-link>
        </li>
      </ul>
    </nav>
    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 220px;
  background: #1a1a2e;
  color: #fff;
  padding: 1rem;
  flex-shrink: 0;
}
.logo {
  font-size: 1.25rem;
  font-weight: bold;
  margin-bottom: 2rem;
  padding: 0.5rem;
}
.sidebar ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.sidebar li a {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  color: #ccc;
  text-decoration: none;
  border-radius: 6px;
  margin-bottom: 0.25rem;
}
.sidebar li a:hover,
.sidebar li a.active {
  background: #16213e;
  color: #fff;
}
.icon { font-size: 1.1rem; }
.content {
  flex: 1;
  padding: 2rem;
  background: #f5f5f5;
  overflow-y: auto;
}
</style>
