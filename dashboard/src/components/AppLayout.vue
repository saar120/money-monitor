<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  LayoutDashboard,
  Receipt,
  Building2,
  Bot,
  Tag,
  Activity,
  Lightbulb,
  TrendingUp,
  Settings,
  Bell,
} from 'lucide-vue-next';
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
    const [, settingsRes] = await Promise.all([refreshReviewCount(), getSettings()]);
    demoMode.value = settingsRes.demoMode;
  } catch {
    /* ignore */
  }
});

async function exitDemo() {
  try {
    await toggleDemoMode(false);
    window.location.reload();
  } catch {
    /* ignore */
  }
}

const navSections = [
  {
    label: null,
    items: [
      { path: '/', label: 'Overview', icon: LayoutDashboard },
      { path: '/net-worth', label: 'Net Worth', icon: TrendingUp },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { path: '/insights', label: 'Insights', icon: Lightbulb },
      { path: '/chat', label: 'AI Chat', icon: Bot },
    ],
  },
  {
    label: 'Management',
    items: [
      { path: '/accounts', label: 'Accounts', icon: Building2 },
      { path: '/categories', label: 'Categories', icon: Tag },
      { path: '/alerts', label: 'Alerts', icon: Bell },
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
    <!-- Sidebar — Liquid Glass in Electron, solid bg in browser -->
    <aside
      class="flex-shrink-0 flex flex-col overflow-hidden"
      :class="isElectron ? 'glass rounded-xl' : 'bg-bg-secondary/80 border-r border-separator/40'"
      :style="{ width: isElectron ? '208px' : '220px' }"
    >
      <!-- macOS traffic light spacing + drag region -->
      <div v-if="isElectron" class="flex-shrink-0" style="height: 44px; -webkit-app-region: drag" />

      <!-- Logo area -->
      <div class="flex items-center h-10 px-4 flex-shrink-0 gap-2.5" :class="{ 'mt-3': !isElectron }">
        <img src="/icon-192.png" alt="" class="h-5 w-5 rounded" />
        <span class="text-[13px] font-semibold text-text-primary tracking-tight">
          Money Monitor
        </span>
      </div>

      <!-- Nav with section grouping -->
      <nav class="flex-1 px-3 py-2 overflow-y-auto">
        <template v-for="section in navSections" :key="section.label ?? 'primary'">
          <p
            v-if="section.label"
            class="text-[11px] font-medium text-text-tertiary px-3 pt-4 pb-1.5 select-none"
          >
            {{ section.label }}
          </p>
          <div class="space-y-0.5">
            <RouterLink
              v-for="item in section.items"
              :key="item.path"
              :to="item.path"
              class="group relative flex items-center h-[30px] rounded-lg px-3 gap-2.5 text-[13px] no-underline transition-all duration-150"
              :class="
                isActive(item.path)
                  ? 'bg-primary/12 text-primary font-medium'
                  : 'text-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              "
            >
              <component
                :is="item.icon"
                class="h-4 w-4 flex-shrink-0 transition-colors duration-150"
                :class="isActive(item.path) ? 'text-primary' : 'text-text-secondary'"
              />
              <span>{{ item.label }}</span>
              <span
                v-if="item.path === '/insights' && reviewCount > 0"
                class="ml-auto inline-flex items-center justify-center rounded-full text-[10px] font-bold h-4 min-w-4 px-1 bg-destructive text-white"
              >
                {{ reviewCount }}
              </span>
            </RouterLink>
          </div>
        </template>
      </nav>

      <!-- Bottom: Settings -->
      <div class="px-3 pb-3 mt-auto">
        <div class="h-px bg-separator/50 mx-1 mb-2" />
        <RouterLink
          to="/settings"
          class="flex items-center h-[30px] rounded-lg px-3 gap-2.5 text-[13px] no-underline transition-all duration-150"
          :class="
            isActive('/settings')
              ? 'bg-primary/12 text-primary font-medium'
              : 'text-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
          "
        >
          <Settings
            class="h-4 w-4 flex-shrink-0 transition-colors duration-150"
            :class="isActive('/settings') ? 'text-primary' : 'text-text-secondary'"
          />
          <span>Settings</span>
        </RouterLink>
      </div>
    </aside>

    <!-- Main content — card floating over vibrancy in Electron -->
    <div
      class="flex-1 flex flex-col min-w-0 bg-bg-primary overflow-hidden relative"
      :class="{ 'rounded-xl shadow-[var(--shadow-md)] border border-separator/40': isElectron }"
    >
      <!-- Toolbar — glass overlay, content scrolls underneath -->
      <div
        v-if="isElectron"
        class="absolute top-0 left-0 right-0 z-10 pointer-events-none"
      >
        <div
          class="h-[44px] flex items-center px-6 glass-toolbar pointer-events-auto"
          style="-webkit-app-region: drag"
        >
          <div class="ml-auto flex items-center gap-2" style="-webkit-app-region: no-drag">
            <slot name="toolbar-actions" />
          </div>
        </div>
        <!-- Fade gradient below toolbar -->
        <div class="h-5 bg-gradient-to-b from-[var(--bg-primary)] to-transparent" />
      </div>

      <!-- Demo mode banner -->
      <div
        v-if="demoMode"
        class="flex-shrink-0 flex items-center justify-center gap-2 px-4 py-1.5 bg-bg-secondary border-b border-separator/50 text-[12px] text-text-secondary"
        :class="{ 'mt-[44px]': isElectron }"
      >
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-[var(--warning)] mr-1" />
        <span>Demo Mode — Viewing sample data</span>
        <button class="underline hover:no-underline font-medium ml-1 text-primary" @click="exitDemo">
          Exit
        </button>
      </div>

      <main
        ref="mainEl"
        class="flex-1 flex flex-col overflow-y-auto p-6 min-w-0"
        :class="{ 'pt-[56px]': isElectron }"
      >
        <slot />
      </main>
    </div>
  </div>
</template>
