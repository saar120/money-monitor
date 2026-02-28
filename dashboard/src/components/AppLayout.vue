<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { LayoutDashboard, Receipt, Building2, Bot, Tag, Activity } from 'lucide-vue-next';
import { Separator } from '@/components/ui/separator';

const route = useRoute();
const router = useRouter();
const mainEl = ref<HTMLElement | null>(null);

router.afterEach(() => {
  mainEl.value?.scrollTo(0, 0);
});

const navItems = [
  { path: '/', label: 'Overview', icon: LayoutDashboard },
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
        </RouterLink>
      </nav>
    </aside>
    <main ref="mainEl" class="flex-1 overflow-y-auto p-6 min-w-0">
      <slot />
    </main>
  </div>
</template>
