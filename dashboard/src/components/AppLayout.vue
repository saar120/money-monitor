<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, Receipt, Building2, Bot, Tag, Activity, Lightbulb, Wallet } from 'lucide-vue-next';
import { getNeedsReviewCount } from '../api/client';

const route = useRoute();
const router = useRouter();
const mainEl = ref<HTMLElement | null>(null);
const sidebarExpanded = ref(false);
const sidebarEl = ref<HTMLElement | null>(null);

function toggleSidebar() {
  sidebarExpanded.value = !sidebarExpanded.value;
}

function handleClickOutside(event: MouseEvent) {
  if (sidebarExpanded.value && sidebarEl.value && !sidebarEl.value.contains(event.target as Node)) {
    sidebarExpanded.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});

router.afterEach(() => {
  mainEl.value?.scrollTo(0, 0);
  sidebarExpanded.value = false;
});

const reviewCount = ref(0);

onMounted(async () => {
  try {
    const { count } = await getNeedsReviewCount();
    reviewCount.value = count;
  } catch { /* ignore */ }
});

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
  { path: '/insights', label: 'Insights', icon: Lightbulb },
  { path: '/transactions', label: 'Transactions', icon: Receipt },
  { path: '/accounts', label: 'Accounts', icon: Building2 },
  { path: '/chat', label: 'AI Chat', icon: Bot },
  { path: '/categories', label: 'Categories', icon: Tag },
  { path: '/scraping', label: 'Scraping', icon: Activity },
];
</script>

<template>
  <div class="flex h-screen bg-background text-foreground">
    <!-- Sidebar -->
    <aside
      ref="sidebarEl"
      class="flex-shrink-0 flex flex-col border-r border-border backdrop-blur-xl bg-surface-2/80 transition-[width] duration-300 ease-out overflow-hidden z-20"
      :style="{ width: sidebarExpanded ? '240px' : '64px' }"
    >
      <!-- Logo (click to toggle) -->
      <div class="flex items-center h-16 px-4 flex-shrink-0 cursor-pointer" @click="toggleSidebar">
        <div class="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Wallet class="h-4 w-4 text-primary" />
        </div>
        <Transition
          enter-active-class="transition-all duration-200 delay-100"
          enter-from-class="opacity-0 -translate-x-2"
          enter-to-class="opacity-100 translate-x-0"
          leave-active-class="transition-all duration-100"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <span v-if="sidebarExpanded" class="ml-3 text-sm font-semibold heading-font tracking-tight whitespace-nowrap text-foreground">
            Money Monitor
          </span>
        </Transition>
      </div>

      <!-- Nav -->
      <nav class="flex-1 px-2 py-2 space-y-1">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="group relative flex items-center h-10 rounded-lg text-sm font-medium transition-all duration-150 no-underline overflow-hidden"
          :class="route.path === item.path
            ? 'bg-primary/15 text-primary'
            : 'text-muted-foreground hover:bg-surface-3 hover:text-foreground'"
          :title="!sidebarExpanded ? item.label : undefined"
        >
          <!-- Active indicator bar -->
          <div
            v-if="route.path === item.path"
            class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r"
          />

          <div class="flex items-center justify-center w-[64px] flex-shrink-0">
            <component
              :is="item.icon"
              class="h-[18px] w-[18px] transition-transform duration-150 group-hover:scale-105"
            />
          </div>

          <Transition
            enter-active-class="transition-all duration-200 delay-100"
            enter-from-class="opacity-0"
            enter-to-class="opacity-100"
            leave-active-class="transition-all duration-100"
            leave-from-class="opacity-100"
            leave-to-class="opacity-0"
          >
            <div v-if="sidebarExpanded" class="flex items-center gap-2 whitespace-nowrap pr-3">
              <span>{{ item.label }}</span>
              <span
                v-if="item.path === '/insights' && reviewCount > 0"
                class="ml-auto inline-flex items-center justify-center rounded-full bg-destructive text-white text-[10px] font-bold h-5 min-w-5 px-1.5"
              >
                {{ reviewCount }}
              </span>
            </div>
          </Transition>

          <!-- Badge dot when collapsed -->
          <span
            v-if="!sidebarExpanded && item.path === '/insights' && reviewCount > 0"
            class="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-destructive"
          />
        </RouterLink>
      </nav>
    </aside>

    <!-- Main content -->
    <main ref="mainEl" class="flex-1 overflow-y-auto p-8 min-w-0 scroll-smooth">
      <div class="animate-fade-in-up">
        <slot />
      </div>
    </main>
  </div>
</template>
