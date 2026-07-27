import { describe, expect, it, vi } from 'vitest';
import type { MobileAccessRuntimeState } from './mobile-access-runtime.js';
import {
  MobileAccessControl,
  type MobileAccessDeviceRegistry,
  type MobileAccessPairingCreationInput,
  type MobileAccessPairingManager,
  type MobileAccessPairingSession,
  type MobileAccessRegistryDevice,
  type MobileAccessRuntimeControl,
} from './mobile-access-control.js';

const PUBLIC_URL = 'https://money-mac.example.ts.net/money-monitor';
const RUNNING: MobileAccessRuntimeState = {
  status: 'running',
  diagnostic: 'routeVerified',
  publicUrl: PUBLIC_URL,
};
const DISABLED: MobileAccessRuntimeState = {
  status: 'disabled',
  diagnostic: 'routeDisabled',
};

class FakeRuntime implements MobileAccessRuntimeControl {
  startStates: MobileAccessRuntimeState[] = [RUNNING];
  resumeStates: MobileAccessRuntimeState[] = [RUNNING];
  disableState = DISABLED;
  calls: string[] = [];

  async start(enabled: boolean): Promise<MobileAccessRuntimeState> {
    this.calls.push(`start:${enabled}`);
    return this.startStates.shift() ?? DISABLED;
  }

  async resume(): Promise<MobileAccessRuntimeState> {
    this.calls.push('resume');
    return this.resumeStates.shift() ?? DISABLED;
  }

  async shutdown(): Promise<MobileAccessRuntimeState> {
    this.calls.push('shutdown');
    return { status: 'stopped', diagnostic: 'runtimeStopped' };
  }

  async disable(): Promise<MobileAccessRuntimeState> {
    this.calls.push('disable');
    return this.disableState;
  }
}

class FakePairings implements MobileAccessPairingManager {
  sessions: MobileAccessPairingSession[] = [];
  createCalls = 0;
  createInputs: Array<MobileAccessPairingCreationInput | undefined> = [];

  create(input?: MobileAccessPairingCreationInput) {
    this.createCalls += 1;
    this.createInputs.push(input);
    return {
      status: 'created' as const,
      qrPayload: {
        kind: 'money-monitor-pairing' as const,
        version: 1 as const,
        pairingId: 'pairing-1',
        nonce: 'n'.repeat(43),
        serverId: 'server-1',
        baseURL: PUBLIC_URL,
        protocolVersion: 1,
        expiresAt: '2026-07-15T12:05:00.000Z',
        // Simulate an integration accidentally returning trusted-only state.
        // The control must allowlist QR fields before renderer exposure.
        replacementDeviceId: input?.replacementDeviceId,
      },
    };
  }

  inspectAll(): MobileAccessPairingSession[] {
    return this.sessions;
  }

  approve(pairingId: string) {
    return { status: pairingId === 'pairing-1' ? 'approved' : 'pairing_not_found' };
  }

  reject(pairingId: string) {
    return { status: pairingId === 'pairing-1' ? 'rejected' : 'pairing_not_found' };
  }
}

class FakeRegistry implements MobileAccessDeviceRegistry {
  devices: MobileAccessRegistryDevice[] = [];

  list(): MobileAccessRegistryDevice[] {
    return this.devices.map((device) => ({ ...device }));
  }

  revoke(deviceId: string): boolean {
    const device = this.devices.find((candidate) => candidate.id === deviceId);
    if (!device) return false;
    device.revokedAt = '2026-07-15T13:00:00.000Z';
    return true;
  }

  setReviewAccess(deviceId: string, enabled: boolean): MobileAccessRegistryDevice | null {
    const device = this.devices.find((candidate) => candidate.id === deviceId);
    if (!device || device.revokedAt) return null;
    device.capabilities = enabled
      ? ['mobile.read', 'mobile.review.write']
      : ['mobile.read'];
    return { ...device };
  }
}

function harness() {
  const runtime = new FakeRuntime();
  const pairings: FakePairings[] = [];
  const registry = new FakeRegistry();
  const persistEnabled = vi.fn<(enabled: boolean) => void>();
  const pairingChanges = vi.fn<(manager: MobileAccessPairingManager | null) => void>();
  const control = new MobileAccessControl({
    runtime,
    persistEnabled,
    createPairingManager: () => {
      const manager = new FakePairings();
      pairings.push(manager);
      return manager;
    },
    deviceRegistry: registry,
    onPairingManagerChanged: pairingChanges,
  });
  return { control, runtime, pairings, registry, persistEnabled, pairingChanges };
}

describe('MobileAccessControl', () => {
  it('keeps the disabled startup path free of pairing state', async () => {
    const context = harness();

    const snapshot = await context.control.startFromConfiguration(false);

    expect(context.runtime.calls).toEqual(['start:false']);
    expect(context.pairings).toHaveLength(0);
    expect(snapshot).toMatchObject({ enabled: false, pairingAvailable: false });
    expect(context.control.createPairing()).toEqual({
      status: 'unavailable',
      reason: 'pairing_unavailable',
    });
  });

  it('persists opt-in, starts transport, and emits a one-time QR payload', async () => {
    const context = harness();

    const snapshot = await context.control.setEnabled(true);
    const pairing = context.control.createPairing();

    expect(context.persistEnabled).toHaveBeenCalledWith(true);
    expect(context.runtime.calls).toEqual(['start:true']);
    expect(snapshot).toMatchObject({
      enabled: true,
      pairingAvailable: true,
      transport: { status: 'running', publicUrl: PUBLIC_URL },
    });
    expect(context.pairingChanges).toHaveBeenCalledWith(context.pairings[0]);
    expect(pairing).toMatchObject({
      status: 'created',
      expiresAt: '2026-07-15T12:05:00.000Z',
    });
    expect(pairing.status === 'created' ? JSON.parse(pairing.encodedPayload) : null).toMatchObject({
      pairingId: 'pairing-1',
      nonce: 'n'.repeat(43),
      baseURL: PUBLIC_URL,
    });
  });

  it('does not create pairing state when transport is unavailable', async () => {
    const context = harness();
    context.runtime.startStates = [{ status: 'loggedOut', diagnostic: 'tailscaleLoggedOut' }];

    const snapshot = await context.control.setEnabled(true);

    expect(snapshot).toMatchObject({ enabled: true, pairingAvailable: false });
    expect(context.pairings).toHaveLength(0);
  });

  it('keeps intent unchanged when settings persistence fails', async () => {
    const context = harness();
    context.persistEnabled.mockImplementation(() => {
      throw new Error('sensitive local path');
    });

    const snapshot = await context.control.setEnabled(true);

    expect(context.runtime.calls).toEqual([]);
    expect(snapshot).toMatchObject({
      enabled: false,
      lastActionError: 'settings_write_failed',
    });
    expect(JSON.stringify(snapshot)).not.toContain('sensitive local path');
  });

  it('replaces memory-only pairing sessions if the public route changes after wake', async () => {
    const context = harness();
    await context.control.setEnabled(true);
    const original = context.pairings[0];
    original.sessions = [
      {
        pairingId: 'pairing-1',
        status: 'pending_approval',
        deviceName: 'Saar iPhone',
        createdAt: '2026-07-15T12:00:00.000Z',
        qrExpiresAt: '2026-07-15T12:05:00.000Z',
      },
    ];
    context.runtime.resumeStates = [
      {
        ...RUNNING,
        publicUrl: 'https://money-mac-2.example.ts.net/money-monitor',
      },
    ];

    const snapshot = await context.control.resume();

    expect(context.pairings).toHaveLength(2);
    expect(snapshot.pendingRequests).toEqual([]);
    expect(context.pairingChanges).toHaveBeenLastCalledWith(context.pairings[1]);
  });

  it('returns only safe pending approval metadata and delegates explicit actions', async () => {
    const context = harness();
    await context.control.setEnabled(true);
    context.pairings[0].sessions = [
      {
        pairingId: 'pairing-1',
        status: 'pending_approval',
        deviceName: '  Saar   iPhone  ',
        createdAt: '2026-07-15T12:00:00.000Z',
        qrExpiresAt: '2026-07-15T12:05:00.000Z',
        approvalExpiresAt: '2026-07-15T12:06:00.000Z',
      },
      {
        pairingId: 'finished',
        status: 'claimed',
        createdAt: '2026-07-15T11:00:00.000Z',
        qrExpiresAt: '2026-07-15T11:05:00.000Z',
      },
    ];

    expect(context.control.getSnapshot().pendingRequests).toEqual([
      {
        pairingId: 'pairing-1',
        status: 'pending_approval',
        deviceName: 'Saar iPhone',
        createdAt: '2026-07-15T12:00:00.000Z',
        expiresAt: '2026-07-15T12:06:00.000Z',
      },
    ]);
    expect(context.control.approve('pairing-1')).toEqual({ status: 'approved' });
    expect(context.control.reject('pairing-1')).toEqual({ status: 'rejected' });
    expect(context.control.approve('../unsafe')).toEqual({
      status: 'operation_failed',
      reason: 'pairing_unavailable',
    });
  });

  it('lists safe device metadata and keeps revoked devices visible', async () => {
    const context = harness();
    context.registry.devices = [
      {
        id: 'device-1',
        name: 'Saar iPhone',
        capabilities: ['mobile.read'],
        protocolVersion: 1,
        tokenVersion: 1,
        createdAt: '2026-07-15T12:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ];
    await context.control.setEnabled(true);

    const snapshot = context.control.revoke('device-1');

    expect(snapshot.devices).toEqual([
      expect.objectContaining({
        id: 'device-1',
        revokedAt: '2026-07-15T13:00:00.000Z',
      }),
    ]);
  });

  it('changes review access through the trusted Mac control surface only', async () => {
    const context = harness();
    context.registry.devices = [{
      id: 'device-1', name: 'Saar iPhone', capabilities: ['mobile.read'], protocolVersion: 1,
      tokenVersion: 1, createdAt: '2026-07-15T12:00:00.000Z', lastUsedAt: null,
      expiresAt: null, revokedAt: null,
    }];

    expect(context.control.setReviewAccess('device-1', true).devices[0]?.capabilities).toEqual([
      'mobile.read',
      'mobile.review.write',
    ]);
    expect(context.control.setReviewAccess('../unsafe', true).lastActionError).toBe(
      'device_operation_failed',
    );
  });

  it('creates a trusted active-device re-pair without exposing the replacement binding', async () => {
    const context = harness();
    context.registry.devices = [
      {
        id: 'device-1',
        name: 'Saar iPhone',
        capabilities: ['mobile.read'],
        protocolVersion: 1,
        tokenVersion: 1,
        createdAt: '2026-07-15T12:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ];
    await context.control.setEnabled(true);

    const result = context.control.createPairing('device-1');

    expect(context.pairings[0].createInputs).toEqual([{ replacementDeviceId: 'device-1' }]);
    expect(result.status).toBe('created');
    if (result.status !== 'created') throw new Error('unreachable');
    expect(JSON.parse(result.encodedPayload)).not.toHaveProperty('replacementDeviceId');
    expect(result.encodedPayload).not.toContain('device-1');
  });

  it('refuses invalid, missing, revoked, and expired re-pair targets before creating a QR', async () => {
    const context = harness();
    context.registry.devices = [
      {
        id: 'device-1',
        name: 'Saar iPhone',
        capabilities: ['mobile.read'],
        protocolVersion: 1,
        tokenVersion: 1,
        createdAt: '2026-07-15T12:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ];
    await context.control.setEnabled(true);

    expect(context.control.createPairing('../unsafe')).toEqual({
      status: 'unavailable',
      reason: 'invalid_request',
    });
    expect(context.control.createPairing('missing-device')).toEqual({
      status: 'unavailable',
      reason: 'device_operation_failed',
    });

    context.registry.devices[0]!.revokedAt = '2026-07-15T13:00:00.000Z';
    expect(context.control.createPairing('device-1')).toEqual({
      status: 'unavailable',
      reason: 'device_operation_failed',
    });

    context.registry.devices[0]!.revokedAt = null;
    context.registry.devices[0]!.expiresAt = '2020-01-01T00:00:00.000Z';
    expect(context.control.createPairing('device-1')).toEqual({
      status: 'unavailable',
      reason: 'device_operation_failed',
    });
    expect(context.pairings[0].createInputs).toEqual([]);
  });

  it('persists disable before removing the route and clears pairing state', async () => {
    const context = harness();
    await context.control.setEnabled(true);

    const snapshot = await context.control.setEnabled(false);

    expect(context.persistEnabled).toHaveBeenLastCalledWith(false);
    expect(context.runtime.calls).toEqual(['start:true', 'disable']);
    expect(snapshot).toMatchObject({ enabled: false, pairingAvailable: false });
    expect(context.pairingChanges).toHaveBeenLastCalledWith(null);
  });
});
