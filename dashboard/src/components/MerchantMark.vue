<script setup lang="ts">
import { computed } from 'vue';
import {
  ArrowLeftRight,
  BookOpen,
  Box,
  CarFront,
  Coffee,
  House,
  ReceiptText,
  Send,
  ShoppingCart,
  TramFront,
  Wallet,
} from 'lucide-vue-next';
import { normalizeMerchant } from '@/lib/merchant';

const props = defineProps<{ description: string }>();
// Identity is derived only from the merchant, so category edits never change its mark.
const identity = computed(() => {
  const name = normalizeMerchant(props.description).toLocaleLowerCase();
  const known = [
    [/market|grocery|supermarket|סופר|מרקט|מכולת/, ShoppingCart, 'peach'],
    [/metro|tram|rail|רכבת/, TramFront, 'sky'],
    [/cloud|studio|software|תוכנה/, Box, 'lavender'],
    [/cafe|coffee|קפה/, Coffee, 'peach'],
    [/parking|חניה|חניון/, CarFront, 'sky'],
    [/rent|שכירות/, House, 'peach'],
    [/salary|משכורת/, Wallet, 'sage'],
    [/\bbit\b|transfer|העברה/, ArrowLeftRight, 'sage'],
    [/paperplane/, Send, 'sky'],
    [/book|ספר|page turner/, BookOpen, 'lavender'],
  ] as const;
  const match = known.find(([pattern]) => pattern.test(name));
  const hash = [...name].reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0, 0);
  return {
    icon: match?.[1] ?? ReceiptText,
    tone: match?.[2] ?? ['peach', 'sky', 'lavender', 'sage'][hash % 4],
  };
});
</script>

<template>
  <span class="merchant-mark" :class="`merchant-mark--${identity.tone}`" aria-hidden="true">
    <component :is="identity.icon" :size="17" :stroke-width="1.6" />
  </span>
</template>
