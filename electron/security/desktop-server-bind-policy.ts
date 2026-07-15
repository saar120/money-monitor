export const DESKTOP_SERVER_HOST = '127.0.0.1' as const;

export interface DesktopServerStartOptions {
  port: number;
  host: typeof DESKTOP_SERVER_HOST;
}

export type DesktopServerStarter = (options: DesktopServerStartOptions) => Promise<number>;

/** Keep the Electron-owned backend private to the local machine. */
export function startDesktopServer(startServer: DesktopServerStarter): Promise<number> {
  return startServer({ port: 0, host: DESKTOP_SERVER_HOST });
}
