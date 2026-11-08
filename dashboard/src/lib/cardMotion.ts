import { nextTick } from 'vue';
import type { Router } from 'vue-router';
export function categoryMotionName(name: string) {
  return `category-${Array.from(name, (c) => c.codePointAt(0)!.toString(16)).join('-')}`;
}
export function installCardMotion(router: Router) {
  type Attempt = {
    path: string;
    name: string;
    finish?: () => void;
    stopWaiting?: () => void;
    observer?: MutationObserver;
    timer?: ReturnType<typeof setTimeout>;
    transition?: ViewTransition;
  };
  let current: Attempt | null = null;
  function release(attempt: Attempt | null) {
    if (!attempt) return;
    if (current === attempt) current = null;
    attempt.stopWaiting?.();
    attempt.observer?.disconnect();
    clearTimeout(attempt.timer);
    attempt.finish?.();
    attempt.transition?.skipTransition();
  }
  router.beforeResolve(async (to, from) => {
    release(current);
    const category = to.params.name ?? from.params.name;
    if (
      !category ||
      (!to.path.includes('/explore/category/') && !from.path.includes('/explore/category/')) ||
      !document.startViewTransition ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const attempt: Attempt = { path: to.fullPath, name: categoryMotionName(String(category)) };
    current = attempt;
    await new Promise<void>((ready) => {
      try {
        attempt.transition = document.startViewTransition(
          () =>
            new Promise<void>((finish) => {
              if (current !== attempt) {
                finish();
                ready();
                return;
              }
              attempt.finish = finish;
              ready();
            }),
        );
        void attempt.transition.ready.catch(() => {
          ready();
          release(attempt);
        });
      } catch {
        ready();
        release(attempt);
      }
    });
  });
  router.afterEach(async (to, _from, failure) => {
    const attempt = current;
    if (!attempt || attempt.path !== to.fullPath) return;
    if (failure) {
      release(attempt);
      return;
    }
    await nextTick();
    if (current !== attempt) return;
    if (!document.querySelector(`[style*="${attempt.name}"]`))
      await new Promise<void>((resolve) => {
        const done = () => {
          attempt.observer?.disconnect();
          clearTimeout(attempt.timer);
          resolve();
        };
        attempt.stopWaiting = done;
        attempt.observer = new MutationObserver(() => {
          if (current !== attempt || document.querySelector(`[style*="${attempt.name}"]`)) done();
        });
        attempt.observer.observe(document.body, { childList: true, subtree: true });
        attempt.timer = setTimeout(done, 700);
      });
    if (current === attempt) {
      current = null;
      attempt.observer?.disconnect();
      clearTimeout(attempt.timer);
      attempt.finish?.();
    }
  });
  router.onError((_error, to) => {
    if (current?.path === to.fullPath) release(current);
  });
}
