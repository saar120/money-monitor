import { computed, inject, useAttrs, type InjectionKey, type Ref } from 'vue';

export const settingsFieldKey: InjectionKey<{
  labelId: Ref<string | undefined>;
  descriptionId: Ref<string | undefined>;
}> = Symbol('settings-field');

export function useSettingsField() {
  const field = inject(settingsFieldKey, undefined);
  const attrs = useAttrs();
  return computed(() => ({
    'aria-labelledby':
      attrs['aria-label'] || attrs['aria-labelledby'] ? undefined : field?.labelId.value,
    'aria-describedby': attrs['aria-describedby'] ? undefined : field?.descriptionId.value,
  }));
}
