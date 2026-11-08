import { onScopeDispose, ref } from 'vue';
import type { OAuthClient } from '../api/client';

export function useOAuth(client: OAuthClient, options: { onSuccess?: () => void } = {}) {
  const oauthStep = ref<'idle' | 'waiting_code' | 'submitting'>('idle');
  const oauthCode = ref('');
  const oauthError = ref('');
  let statusTimer: ReturnType<typeof setInterval> | undefined;
  let completionHandled = false;
  let generation = 0;
  let checking = false;

  function stopStatusPolling() {
    if (statusTimer) clearInterval(statusTimer);
    statusTimer = undefined;
  }

  function finishOAuth(attempt = generation) {
    if (attempt !== generation || completionHandled) return;
    completionHandled = true;
    stopStatusPolling();
    oauthStep.value = 'idle';
    oauthCode.value = '';
    options.onSuccess?.();
  }

  function startStatusPolling(attempt: number) {
    stopStatusPolling();
    statusTimer = setInterval(async () => {
      if (checking || attempt !== generation) return;
      checking = true;
      try {
        const { connected } = await client.status();
        if (connected) finishOAuth(attempt);
      } catch {
        // Manual code submission remains available if a status check fails.
      } finally {
        checking = false;
      }
    }, 1000);
  }

  async function startOAuth() {
    if (oauthStep.value !== 'idle') return;
    const attempt = ++generation;
    oauthError.value = '';
    oauthStep.value = 'waiting_code';
    completionHandled = false;
    try {
      const { url } = await client.start();
      if (attempt !== generation) return;
      if (url) window.open(url, '_blank');
      startStatusPolling(attempt);
    } catch (e) {
      if (attempt !== generation) return;
      oauthError.value = e instanceof Error ? e.message : 'Failed to start OAuth';
      oauthStep.value = 'idle';
    }
  }

  async function submitOAuthCode() {
    if (!oauthCode.value.trim() || oauthStep.value !== 'waiting_code') return;
    const attempt = generation;
    oauthError.value = '';
    oauthStep.value = 'submitting';
    try {
      await client.complete(oauthCode.value.trim());
      finishOAuth(attempt);
    } catch (e) {
      if (attempt !== generation) return;
      oauthError.value = e instanceof Error ? e.message : 'Authorization failed';
      oauthStep.value = 'waiting_code';
    }
  }

  function cancelOAuth() {
    generation++;
    stopStatusPolling();
    client.cancel().catch(() => {});
    oauthStep.value = 'idle';
    oauthCode.value = '';
    oauthError.value = '';
  }

  onScopeDispose(() => {
    generation++;
    stopStatusPolling();
    void client.cancel().catch(() => {});
  });

  return {
    oauthStep,
    oauthCode,
    oauthError,
    startOAuth,
    submitOAuthCode,
    cancelOAuth,
  };
}
