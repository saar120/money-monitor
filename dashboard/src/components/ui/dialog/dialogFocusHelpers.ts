/**
 * Focus helpers for Reka UI Dialog components.
 *
 * Addresses a bug where inputs inside modal dialogs cannot be focused on
 * Windows / Electron. Reka UI's DismissableLayer sets `pointer-events: none`
 * on <body> and relies on inline `pointer-events: auto` on the dialog layer.
 * When cleanup fails (stale element refs during unmount), the new dialog
 * inherits `pointer-events: none` and all clicks inside it are swallowed.
 * A companion CSS rule in style.css (`[data-dismissable-layer]`) handles the
 * pointer-events side; the two helpers below handle focus-trap races.
 *
 * See: https://github.com/radix-ui/primitives/issues/3648
 *      https://github.com/radix-ui/primitives/issues/1891
 *      https://github.com/unovue/reka-ui/issues/1170
 */

/**
 * Auto-focus the first input/textarea when a dialog opens.
 * Uses setTimeout(0) instead of Vue's nextTick so the callback runs after
 * Reka UI's FocusScope synchronous mount logic and MutationObserver flush.
 */
export function handleDialogAutoFocus(event: Event) {
  const container = event.target as HTMLElement | null;
  const input = container?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea');
  if (input) {
    event.preventDefault();
    setTimeout(() => {
      if (input.isConnected) input.focus();
    }, 0);
  }
}

/**
 * Ensure clicking an input/textarea actually focuses it.
 * Reka UI's FocusScope `focusin` handler can redirect focus back to a stale
 * `lastFocusedElementRef`. Scheduling focus in a requestAnimationFrame fires
 * after all synchronous focusin handlers, letting the input win.
 */
export function handleDialogPointerDown(event: PointerEvent) {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    requestAnimationFrame(() => {
      if (target.isConnected && document.activeElement !== target) {
        target.focus();
      }
    });
  }
}
