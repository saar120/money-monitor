import { ref } from 'vue';
import { startAnthropicOAuth, completeAnthropicOAuth, cancelAnthropicOAuth } from '../api/client';

export interface AnthropicOAuthOptions {
  onSuccess?: () => void;
}

export function useAnthropicOAuth(options: AnthropicOAuthOptions = {}) {
  const oauthStep = ref<'idle' | 'waiting_code' | 'submitting'>('idle');
  const oauthCode = ref('');
  const oauthError = ref('');

  async function startOAuth() {
    oauthError.value = '';
    oauthStep.value = 'waiting_code';
    try {
      const { url } = await startAnthropicOAuth();
      window.open(url, '_blank');
    } catch (e) {
      oauthError.value = e instanceof Error ? e.message : 'Failed to start OAuth';
      oauthStep.value = 'idle';
    }
  }

  async function submitOAuthCode() {
    if (!oauthCode.value.trim()) return;
    oauthError.value = '';
    oauthStep.value = 'submitting';
    try {
      await completeAnthropicOAuth(oauthCode.value.trim());
      oauthStep.value = 'idle';
      oauthCode.value = '';
      options.onSuccess?.();
    } catch (e) {
      oauthError.value = e instanceof Error ? e.message : 'Authorization failed';
      oauthStep.value = 'waiting_code';
    }
  }

  function cancelOAuth() {
    cancelAnthropicOAuth().catch(() => {});
    oauthStep.value = 'idle';
    oauthCode.value = '';
    oauthError.value = '';
  }

  return {
    oauthStep,
    oauthCode,
    oauthError,
    startOAuth,
    submitOAuthCode,
    cancelOAuth,
  };
}
