import { createPendingBridge } from './pending-bridge.js';

const bridge = createPendingBridge<string>(2 * 60 * 1000, 'OTP');

export const waitForOtp = bridge.waitFor;
export const submitOtp = bridge.confirm;
export const cancelOtp = bridge.cancel;
