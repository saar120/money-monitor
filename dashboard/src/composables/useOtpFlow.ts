import { ref } from 'vue';
import { submitOtp, confirmManualLogin } from '../api/client';

export interface OtpFlowOptions {
  onError?: (message: string) => void;
  onOtpComplete?: () => void;
  onManualLoginComplete?: () => void;
}

export function useOtpFlow(options: OtpFlowOptions = {}) {
  const { onError = (msg) => alert(msg), onOtpComplete, onManualLoginComplete } = options;

  // OTP state
  const otpAccountId = ref<number | null>(null);
  const otpLabel = ref('');
  const otpCode = ref('');
  const otpSubmitting = ref(false);
  const otpDialogOpen = ref(false);

  // Manual login state
  const manualLoginAccountId = ref<number | null>(null);
  const manualLoginLabel = ref('');
  const manualLoginSubmitting = ref(false);
  const manualLoginDialogOpen = ref(false);

  // --- OTP handlers ---

  function showOtpDialog(accountId: number, label: string) {
    otpAccountId.value = accountId;
    otpLabel.value = label;
    otpCode.value = '';
    otpDialogOpen.value = true;
  }

  function dismissOtpDialog() {
    otpDialogOpen.value = false;
    otpAccountId.value = null;
    otpCode.value = '';
  }

  async function handleOtpSubmit() {
    if (!otpAccountId.value || !otpCode.value.trim()) return;
    otpSubmitting.value = true;
    try {
      await submitOtp(otpAccountId.value, otpCode.value.trim());
      dismissOtpDialog();
      onOtpComplete?.();
    } catch (err) {
      onError(`OTP submit failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      otpSubmitting.value = false;
    }
  }

  // --- Manual login handlers ---

  function showManualLoginDialog(accountId: number, label: string) {
    manualLoginAccountId.value = accountId;
    manualLoginLabel.value = label;
    manualLoginDialogOpen.value = true;
  }

  function dismissManualLoginDialog() {
    manualLoginDialogOpen.value = false;
    manualLoginAccountId.value = null;
  }

  async function handleManualLoginConfirm() {
    if (!manualLoginAccountId.value) return;
    manualLoginSubmitting.value = true;
    try {
      await confirmManualLogin(manualLoginAccountId.value);
      dismissManualLoginDialog();
      onManualLoginComplete?.();
    } catch (err) {
      onError(`Confirm failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      manualLoginSubmitting.value = false;
    }
  }

  /**
   * Dismiss any dialog associated with a given accountId.
   * Useful when an SSE event signals scrape-done/error for that account.
   */
  function dismissByAccountId(accountId: number) {
    if (otpAccountId.value === accountId) dismissOtpDialog();
    if (manualLoginAccountId.value === accountId) dismissManualLoginDialog();
  }

  return {
    // OTP
    otpAccountId,
    otpLabel,
    otpCode,
    otpSubmitting,
    otpDialogOpen,
    showOtpDialog,
    dismissOtpDialog,
    handleOtpSubmit,

    // Manual login
    manualLoginAccountId,
    manualLoginLabel,
    manualLoginSubmitting,
    manualLoginDialogOpen,
    showManualLoginDialog,
    dismissManualLoginDialog,
    handleManualLoginConfirm,

    // Utility
    dismissByAccountId,
  };
}
