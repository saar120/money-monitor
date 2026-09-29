import { nextTick } from 'vue';
import type { Router } from 'vue-router';
export function categoryMotionName(name: string) {
  return `category-${Array.from(name, (c) => c.codePointAt(0)!.toString(16)).join('-')}`;
}
export function installCardMotion(router: Router) {
  let finish: (() => void) | undefined;
  let targetName = '';
  router.beforeResolve(async (to, from) => {
    const category = to.params.name ?? from.params.name;
    if (
      !category ||
      (!to.path.includes('/explore/category/') && !from.path.includes('/explore/category/')) ||
      !document.startViewTransition ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    finish?.();
    targetName = categoryMotionName(String(category));
    await new Promise<void>((ready) => {
      const transition = document.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
            ready();
          }),
      );
      // Unsupported snapshots must never prevent navigation.
      void transition.ready.catch(() => ready());
    });
  });
  router.afterEach(async () => {
    const complete = finish;
    const name = targetName;
    finish = undefined;
    await nextTick();
    if (complete && !document.querySelector(`[style*="${name}"]`)) {
      await new Promise<void>((resolve) => {
        const done = () => {
          observer.disconnect();
          clearTimeout(timeout);
          resolve();
        };
        const observer = new MutationObserver(() => {
          if (document.querySelector(`[style*="${name}"]`)) done();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const timeout = setTimeout(done, 700);
      });
    }
    complete?.();
  });
  router.onError(() => {
    finish?.();
    finish = undefined;
  });
}
