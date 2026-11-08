import { computed, ref, onScopeDispose } from 'vue';
import { submitOtp, confirmManualLogin, getScrapeSessions } from '../api/client';
export interface OtpFlowOptions {
  onError?: (message: string) => void;
  onOtpComplete?: () => void;
  onManualLoginComplete?: () => void;
}
type Challenge = {
  kind: 'input' | 'submitting';
  accountId: number;
  label: string;
  challengeId: string;
  sessionId?: number;
};
export function useOtpFlow(options: OtpFlowOptions = {}) {
  const otp = ref<Challenge | null>(null);
  const manual = ref<Challenge | null>(null);
  const otpCode = ref('');
  let generation = 0;
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    generation++;
  });
  function dismissOtpDialog() {
    generation++;
    otp.value = null;
    otpCode.value = '';
  }
  function dismissManualLoginDialog() {
    generation++;
    manual.value = null;
  }
  function showOtpDialog(
    accountId: number,
    label: string,
    challengeId?: string,
    sessionId?: number,
  ) {
    if (!challengeId || otp.value?.challengeId === challengeId) return;
    generation++;
    otp.value = { kind: 'input', accountId, label, challengeId, sessionId };
    otpCode.value = '';
  }
  function showManualLoginDialog(
    accountId: number,
    label: string,
    challengeId?: string,
    sessionId?: number,
  ) {
    if (!challengeId || manual.value?.challengeId === challengeId) return;
    generation++;
    manual.value = { kind: 'input', accountId, label, challengeId, sessionId };
  }
  async function handleOtpSubmit() {
    const challenge = otp.value;
    if (!challenge || challenge.kind === 'submitting' || !otpCode.value.trim()) return;
    challenge.kind = 'submitting';
    try {
      await submitOtp(challenge.accountId, otpCode.value.trim(), challenge.challengeId);
      if (otp.value?.challengeId !== challenge.challengeId) return;
      dismissOtpDialog();
      options.onOtpComplete?.();
    } catch (cause) {
      if (otp.value?.challengeId === challenge.challengeId) {
        challenge.kind = 'input';
        options.onError?.(cause instanceof Error ? cause.message : 'OTP failed');
      }
    }
  }
  async function handleManualLoginConfirm() {
    const challenge = manual.value;
    if (!challenge || challenge.kind === 'submitting') return;
    challenge.kind = 'submitting';
    try {
      await confirmManualLogin(challenge.accountId, challenge.challengeId);
      if (manual.value?.challengeId !== challenge.challengeId) return;
      dismissManualLoginDialog();
      options.onManualLoginComplete?.();
    } catch (cause) {
      if (manual.value?.challengeId === challenge.challengeId) {
        challenge.kind = 'input';
        options.onError?.(cause instanceof Error ? cause.message : 'Confirmation failed');
      }
    }
  }
  const dismissByAccountId = (id: number) => {
    if (otp.value?.accountId === id) dismissOtpDialog();
    if (manual.value?.accountId === id) dismissManualLoginDialog();
  };
  async function rehydrate(label: (id: number) => string = String) {
    const version = generation;
    try {
      const { challenges } = await getScrapeSessions({ limit: 1 });
      if (disposed || version !== generation || !challenges) return;
      if (
        otp.value &&
        !challenges.otp.some((value) => value.challengeId === otp.value?.challengeId)
      )
        dismissOtpDialog();
      if (
        manual.value &&
        !challenges.manual.some((value) => value.challengeId === manual.value?.challengeId)
      )
        dismissManualLoginDialog();
      for (const value of challenges.otp)
        showOtpDialog(value.accountId, label(value.accountId), value.challengeId, value.sessionId);
      for (const value of challenges.manual)
        showManualLoginDialog(
          value.accountId,
          label(value.accountId),
          value.challengeId,
          value.sessionId,
        );
    } catch {
      /* Keep the current draft until an authoritative challenge snapshot arrives. */
    }
  }
  return {
    rehydrate,
    otpCode,
    otpAccountId: computed(() => otp.value?.accountId ?? null),
    otpLabel: computed(() => otp.value?.label ?? ''),
    otpSubmitting: computed(() => otp.value?.kind === 'submitting'),
    otpDialogOpen: computed({
      get: () => otp.value !== null,
      set: (value) => {
        if (!value) dismissOtpDialog();
      },
    }),
    manualLoginAccountId: computed(() => manual.value?.accountId ?? null),
    manualLoginLabel: computed(() => manual.value?.label ?? ''),
    manualLoginSubmitting: computed(() => manual.value?.kind === 'submitting'),
    manualLoginDialogOpen: computed({
      get: () => manual.value !== null,
      set: (value) => {
        if (!value) dismissManualLoginDialog();
      },
    }),
    showOtpDialog,
    showManualLoginDialog,
    dismissOtpDialog,
    dismissManualLoginDialog,
    handleOtpSubmit,
    handleManualLoginConfirm,
    dismissByAccountId,
    dismissAll: () => {
      dismissOtpDialog();
      dismissManualLoginDialog();
    },
  };
}
