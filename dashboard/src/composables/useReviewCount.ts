import { ref } from 'vue';
import { getNeedsReviewCount } from '../api/client';

const reviewCount = ref(0);

export function useReviewCount() {
  async function refresh() {
    try {
      const res = await getNeedsReviewCount();
      reviewCount.value = res.count;
    } catch { /* ignore */ }
  }

  return { reviewCount, refresh };
}
