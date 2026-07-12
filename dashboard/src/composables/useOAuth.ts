import { onScopeDispose, ref } from 'vue';
import type { OAuthClient } from '../api/client';

export function useOAuth(client: OAuthClient, options: { onSuccess?: () => void } = {}) {
  const oauthStep = ref<'idle' | 'waiting_code' | 'submitting'>('idle');
  const oauthCode = ref('');
  const oauthError = ref('');
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let completionHandled = false;

  function stopStatusPolling() {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = undefined;
  }

  function finishOAuth() {
    if (completionHandled) return;
    completionHandled = true;
    stopStatusPolling();
    oauthStep.value = 'idle';
    oauthCode.value = '';
    options.onSuccess?.();
  }

  function startStatusPolling() {
    stopStatusPolling();
    statusTimer = setInterval(async () => {
      try {
        const { connected } = await client.status();
        if (connected) finishOAuth();
      } catch {
        // Manual code submission remains available if a status check fails.
      }
    }, 1000);
  }

  async function startOAuth() {
    oauthError.value = '';
    oauthStep.value = 'waiting_code';
    completionHandled = false;
    try {
      const { url } = await client.start();
      window.open(url, '_blank');
      startStatusPolling();
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
      await client.complete(oauthCode.value.trim());
      finishOAuth();
    } catch (e) {
      oauthError.value = e instanceof Error ? e.message : 'Authorization failed';
      oauthStep.value = 'waiting_code';
    }
  }

  function cancelOAuth() {
    stopStatusPolling();
    client.cancel().catch(() => {});
    oauthStep.value = 'idle';
    oauthCode.value = '';
    oauthError.value = '';
  }

  onScopeDispose(stopStatusPolling);

  return {
    oauthStep,
    oauthCode,
    oauthError,
    startOAuth,
    submitOAuthCode,
    cancelOAuth,
  };
}
