<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, Receipt, Building2, Bot, Tag, Activity, Lightbulb } from 'lucide-vue-next';
import { Separator } from '@/components/ui/separator';
import { getNeedsReviewCount } from '../api/client';

const route = useRoute();
const router = useRouter();
const mainEl = ref<HTMLElement | null>(null);

router.afterEach(() => {
  mainEl.value?.scrollTo(0, 0);
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
    <aside class="w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
      <div class="px-4 py-5">
        <span class="text-base font-bold tracking-tight">Money Monitor</span>
      </div>
      <Separator />
      <nav class="flex-1 p-3 space-y-0.5">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors no-underline"
          :class="route.path === item.path
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'"
        >
          <component :is="item.icon" class="h-4 w-4 flex-shrink-0" />
          {{ item.label }}
          <span
            v-if="item.path === '/insights' && reviewCount > 0"
            class="ml-auto inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-xs font-medium h-5 min-w-5 px-1"
          >
            {{ reviewCount }}
          </span>
        </RouterLink>
      </nav>
    </aside>
    <main ref="mainEl" class="flex-1 overflow-y-auto p-6 min-w-0">
      <slot />
    </main>
  </div>
</template>
