import type { InjectionKey, Ref } from 'vue';

export interface DialogContext {
  open: Ref<boolean | undefined>;
  close: () => void;
}

export const DIALOG_INJECTION_KEY: InjectionKey<DialogContext> = Symbol('DialogContext');
