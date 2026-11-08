export type UpdateSnapshot = { operationId: number; revision: number } & (
  | { status: 'idle' | 'checking' | 'up-to-date' | 'unavailable' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string; warning?: string }
  | { status: 'error'; error: string }
);
