<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, Receipt, Building2, Bot, Tag, Activity, Lightbulb, TrendingUp, Settings } from 'lucide-vue-next';
import { getSettings, toggleDemoMode } from '../api/client';
import { useReviewCount } from '../composables/useReviewCount';

const isElectron = !!(window as any).electronAPI;

const route = useRoute();
const router = useRouter();
const mainEl = ref<HTMLElement | null>(null);

const removeAfterEach = router.afterEach(() => {
  mainEl.value?.scrollTo(0, 0);
});

onUnmounted(() => {
  removeAfterEach();
});

const { reviewCount, refresh: refreshReviewCount } = useReviewCount();
const demoMode = ref(false);

onMounted(async () => {
  try {
    const [, settingsRes] = await Promise.all([
      refreshReviewCount(),
      getSettings(),
    ]);
    demoMode.value = settingsRes.demoMode;
  } catch { /* ignore */ }
});

async function exitDemo() {
  try {
    await toggleDemoMode(false);
    window.location.reload();
  } catch { /* ignore */ }
}

const navSections = [
  {
    items: [
      { path: '/', label: 'Overview', icon: LayoutDashboard },
      { path: '/net-worth', label: 'Net Worth', icon: TrendingUp },
      { path: '/insights', label: 'Insights', icon: Lightbulb },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/accounts', label: 'Accounts', icon: Building2 },
      { path: '/chat', label: 'AI Chat', icon: Bot },
      { path: '/categories', label: 'Categories', icon: Tag },
      { path: '/scraping', label: 'Scraping', icon: Activity },
    ],
  },
];

function isActive(path: string): boolean {
  if (path === '/') return route.path === '/';
  return route.path.startsWith(path);
}
</script>

<template>
  <div class="flex h-screen" :class="{ 'p-2 gap-2': isElectron }">
    <!-- Sidebar — transparent in Electron for vibrancy, has bg in browser -->
    <aside
      class="flex-shrink-0 flex flex-col overflow-hidden"
      :class="{ 'bg-bg-secondary border-r border-separator': !isElectron }"
      :style="{ width: isElectron ? '208px' : '220px' }"
    >
      <!-- macOS traffic light spacing + drag region -->
      <div
        v-if="isElectron"
        class="flex-shrink-0"
        style="height: 44px; -webkit-app-region: drag;"
      />

      <!-- Logo area -->
      <div class="flex items-center h-10 px-4 flex-shrink-0 gap-2" :class="{ 'mt-3': !isElectron }">
        <img src="/icon-192.png" alt="" class="h-5 w-5 rounded" />
        <span class="text-[13px] font-semibold text-text-primary tracking-tight">
          Money Monitor
        </span>
      </div>

      <!-- Nav -->
      <nav class="flex-1 px-3 py-2 space-y-0.5">
        <template v-for="section in navSections" :key="section.items[0]?.path">
          <RouterLink
            v-for="item in section.items"
            :key="item.path"
            :to="item.path"
            class="group relative flex items-center h-7 rounded-md px-3 gap-2 text-[13px] no-underline transition-colors duration-100"
            :class="isActive(item.path)
              ? 'bg-primary text-white font-medium'
              : 'text-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
          >
            <component
              :is="item.icon"
              class="h-4 w-4 flex-shrink-0"
              :class="isActive(item.path) ? 'text-white' : 'text-text-secondary'"
            />
            <span>{{ item.label }}</span>
            <span
              v-if="item.path === '/insights' && reviewCount > 0"
              class="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-bold h-4 min-w-4 px-1"
              :class="isActive(item.path)
                ? 'bg-white/25 text-white'
                : 'bg-destructive text-white'"
            >
              {{ reviewCount }}
            </span>
          </RouterLink>
        </template>
      </nav>

      <!-- Bottom: Settings -->
      <div class="px-3 pb-3 mt-auto">
        <div class="h-px bg-separator mx-1 mb-2" />
        <RouterLink
          to="/settings"
          class="flex items-center h-7 rounded-md px-3 gap-2 text-[13px] no-underline transition-colors duration-100"
          :class="isActive('/settings')
            ? 'bg-primary text-white font-medium'
            : 'text-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
        >
          <Settings
            class="h-4 w-4 flex-shrink-0"
            :class="isActive('/settings') ? 'text-white' : 'text-text-secondary'"
          />
          <span>Settings</span>
        </RouterLink>
      </div>
    </aside>

    <!-- Main content — card floating over vibrancy in Electron -->
    <div
      class="flex-1 flex flex-col min-w-0 bg-bg-primary overflow-hidden"
      :class="{ 'rounded-[10px] shadow-sm border border-separator/50': isElectron }"
    >
      <!-- Toolbar / header area — drag region -->
      <div
        v-if="isElectron"
        class="h-[44px] flex-shrink-0 flex items-center px-6 border-b border-separator"
        style="-webkit-app-region: drag;"
      >
        <h2 class="text-[17px] font-semibold text-text-primary">
          {{ route.meta?.title ?? '' }}
        </h2>
        <div class="ml-auto flex items-center gap-2" style="-webkit-app-region: no-drag;">
          <slot name="toolbar-actions" />
        </div>
      </div>

      <!-- Demo mode banner -->
      <div
        v-if="demoMode"
        class="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[12px] text-amber-600 dark:text-amber-400"
      >
        <span>Demo Mode — Viewing sample data</span>
        <button
          class="underline hover:no-underline font-medium ml-1"
          @click="exitDemo"
        >Exit</button>
      </div>

      <main ref="mainEl" class="flex-1 flex flex-col overflow-hidden p-6 min-w-0">
        <slot />
      </main>
    </div>
  </div>
</template>
