export const LAST_ROOT_TAB_KEY = 'money-monitor-last-root-tab';

export type RootTab = 'home' | 'activity' | 'explore' | 'advisor';

export function rootTabFromPath(pathname: string): RootTab | null {
  const tab = pathname.replace(/^\/(?:\(tabs\)\/)?/, '').split('/')[0];
  return tab === 'home' || tab === 'activity' || tab === 'explore' || tab === 'advisor'
    ? tab
    : null;
}

export function rootTabHref(
  tab: string | null,
): '/(tabs)/home' | '/(tabs)/activity' | '/(tabs)/explore' | '/(tabs)/advisor' {
  if (tab === 'activity') return '/(tabs)/activity';
  if (tab === 'explore') return '/(tabs)/explore';
  if (tab === 'advisor') return '/(tabs)/advisor';
  return '/(tabs)/home';
}
