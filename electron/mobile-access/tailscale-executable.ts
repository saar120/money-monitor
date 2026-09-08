import { constants, accessSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

export interface TailscaleExecutableResolutionOptions {
  platform?: NodeJS.Platform;
  pathValue?: string;
  isExecutable?: (path: string) => boolean;
}

const DARWIN_APP_EXECUTABLE = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const DARWIN_LAUNCHER_LOCATIONS = [
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
] as const;

function systemExecutableCheck(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finder-launched applications receive a minimal PATH that commonly omits
 * Homebrew and Tailscale CLI locations. Resolve only absolute, executable
 * candidates and retain the bare-name fallback for development environments.
 */
export function resolveTailscaleExecutable(
  options: TailscaleExecutableResolutionOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const pathValue = options.pathValue ?? process.env.PATH ?? '';
  const isExecutable = options.isExecutable ?? systemExecutableCheck;
  const executableName = platform === 'win32' ? 'tailscale.exe' : 'tailscale';

  const pathCandidates = pathValue
    .split(delimiter)
    .filter((entry) => entry.length > 0 && isAbsolute(entry))
    .map((entry) => join(entry, executableName));
  const candidates =
    platform === 'darwin'
      ? [
          // Prefer the real app executable over PATH launcher scripts. Killing
          // a timed-out launcher does not necessarily kill its CLI child.
          DARWIN_APP_EXECUTABLE,
          ...pathCandidates,
          ...DARWIN_LAUNCHER_LOCATIONS,
        ]
      : pathCandidates;

  for (const candidate of new Set(candidates)) {
    if (isExecutable(candidate)) return candidate;
  }

  return executableName;
}
