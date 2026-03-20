/**
 * Workarounds for Reka UI focus-trap bugs on Windows/Electron.
 *
 * Reka UI's FocusScope can race with Vue's nextTick; setTimeout(0) defers past
 * the FocusScope's synchronous mount logic and MutationObserver callbacks.
 *
 * The DismissableLayer / FocusScope can also leave stale state that intercepts
 * click-to-focus. Re-applying focus in a requestAnimationFrame fires after all
 * synchronous focusin handlers, ensuring the input wins the focus race.
 */

export function handleOpenAutoFocus(event: Event) {
  const container = event.target as HTMLElement | null;
  const input = container?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea');
  if (input) {
    event.preventDefault();
    setTimeout(() => {
      if (input.isConnected) input.focus();
    }, 0);
  }
}

export function handlePointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      if (target.isConnected && document.activeElement !== target) {
        target.focus();
      }
    });
  }
}
