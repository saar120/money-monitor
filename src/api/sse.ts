import type { ServerResponse } from 'node:http';

export type SseEventType =
  | 'connected'
  | 'otp-required'
  | 'scrape-started'
  | 'scrape-done'
  | 'scrape-error';

export interface SseEvent {
  type: SseEventType;
  accountId?: number;
  message?: string;
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
    client.write(`data: ${data}\n\n`);
  }
}
