import { computed, nextTick, onScopeDispose, useTemplateRef, watch, type Ref } from 'vue';
import { useEventListener, useMediaQuery } from '@vueuse/core';

// Below this width the workspace inspector becomes a drawer over the list (see style.css).
const DRAWER_QUERY = '(max-width: 1120px)';

/**
 * Gives the narrow-window inspector drawer modal focus: the list behind it is inert, Tab
 * cycles inside the drawer, Escape closes it, focus moves in on open and back to the
 * opening row on close.
 * The caller marks its inspector element with ref="inspector".
 */
export function useDrawerFocus(selectedId: Ref<unknown>) {
  const narrow = useMediaQuery(DRAWER_QUERY);
  const inspector = useTemplateRef<HTMLElement>('inspector');
  const drawerOpen = computed(() => narrow.value && selectedId.value != null);
  let opener: HTMLElement | null = null;

  // Everything outside the drawer (navigation, toolbar, list) leaves the tab order and the
  // accessibility tree; the backdrop stays clickable and is aria-hidden in the template.
  let inerted: HTMLElement[] = [];
  function setBackgroundInert(panel: HTMLElement | null) {
    for (const el of inerted) el.inert = false;
    inerted = [];
    for (let node = panel; node && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement?.children ?? []) {
        if (
          sibling !== node &&
          sibling instanceof HTMLElement &&
          !sibling.inert &&
          !sibling.classList.contains('category-inspector-backdrop')
        ) {
          sibling.inert = true;
          inerted.push(sibling);
        }
      }
    }
  }
  onScopeDispose(() => setBackgroundInert(null));

  watch(drawerOpen, async (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      const panel = inspector.value;
      setBackgroundInert(panel);
      // Prefer the first editable field over the close button in the drawer header.
      (
        panel?.querySelector<HTMLElement>('input:not([readonly]), textarea, [role="combobox"]') ??
        panel?.querySelector<HTMLElement>('button')
      )?.focus();
    } else {
      setBackgroundInert(null);
    }
    if (!open && opener) {
      const row = opener;
      opener = null;
      // The list stops being inert only after the DOM update.
      await nextTick();
      if (row.isConnected) row.focus();
    }
  });

  // Keep Tab inside the drawer and let Escape dismiss it; popovers portaled out of the drawer
  // (select menus) handle their own keys first.
  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    const panel = inspector.value;
    if (!drawerOpen.value || !panel || event.defaultPrevented) return;
    // A confirmation or other dialog opened from the drawer owns focus until it closes.
    const dialogs = document.querySelectorAll('[role="alertdialog"], [role="dialog"]');
    if ([...dialogs].some((dialog) => dialog !== panel)) return;
    const target = event.target instanceof Node ? event.target : null;
    if (event.key === 'Escape' && (!target || panel.contains(target) || target === document.body)) {
      event.preventDefault();
      selectedId.value = null;
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.getClientRects().length > 0,
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const inside = target ? panel.contains(target) : false;
    if (event.shiftKey && (!inside || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  });

  return drawerOpen;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
