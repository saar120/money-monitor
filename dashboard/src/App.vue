<script setup lang="ts">
import { useRoute } from 'vue-router';
import AppLayout from './components/AppLayout.vue';

const route = useRoute();
</script>

<template>
  <AppLayout v-if="route.path !== '/setup'">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>
