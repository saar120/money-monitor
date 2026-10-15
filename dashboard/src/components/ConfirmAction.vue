<script setup lang="ts">
import { language, t } from '@/lib/language';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
const open = defineModel<boolean>('open', { required: true });
defineProps<{
  title: string;
  description: string;
  label?: string;
  pending?: boolean;
  error?: string;
}>();
defineEmits<{ confirm: [] }>();
</script>
<template>
  <AlertDialog
    :open="open"
    @update:open="
      (value) => {
        if (!pending) open = value;
      }
    "
  >
    <AlertDialogContent>
      <AlertDialogHeader
        ><AlertDialogTitle>{{ title }}</AlertDialogTitle
        ><AlertDialogDescription>{{ description }}</AlertDialogDescription></AlertDialogHeader
      >
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="pending">{{ t('cancel') }}</AlertDialogCancel>
        <Button variant="destructive-filled" :disabled="pending" @click="$emit('confirm')">{{
          label || (language === 'he' ? 'מחיקה' : 'Delete')
        }}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
