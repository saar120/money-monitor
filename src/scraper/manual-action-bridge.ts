import { createPendingBridge } from './pending-bridge.js';

const bridge = createPendingBridge<void>(5 * 60 * 1000, 'Manual action');

export const waitForManualAction = bridge.waitFor;
export const confirmManualAction = bridge.confirm;
export const cancelManualAction = bridge.cancel;
