import type { ServerResponse } from 'node:http';

export type SseEventType =
  | 'connected'
  | 'otp-required'
  | 'manual-action-required'
  | 'session-updated'
  | 'session-started'
  | 'session-completed'
  | 'account-scrape-started'
  | 'account-scrape-done'
  | 'account-scrape-error';

export interface SseEvent {
  type: SseEventType;
  sessionId?: number;
  challengeId?: string;
  revision?: number;
  accountId?: number;
  accountIds?: number[];
  trigger?: string;
  message?: string;
  transactionsFound?: number;
  transactionsNew?: number;
  durationMs?: number;
  error?: string;
  errorType?: string;
  status?: string;
}

const clients = new Set<ServerResponse>();

export function addSseClient(res: ServerResponse): void {
  clients.add(res);
}

export function removeSseClient(res: ServerResponse): void {
  clients.delete(res);
}

export function broadcastSseEvent(event: SseEvent): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    try {
      if (client.destroyed) clients.delete(client);
      else client.write(`data: ${data}\n\n`);
    } catch {
      clients.delete(client);
    }
  }
}

export function closeSseClients() {
  for (const client of clients) client.end();
  clients.clear();
}
