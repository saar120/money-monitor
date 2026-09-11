import { useColorScheme } from 'react-native';

const light = {
  background: '#F8F7F3',
  surface: '#FFFFFF',
  surfaceSoft: '#EFEEE9',
  text: '#09111F',
  secondary: '#687081',
  tertiary: '#7A8290',
  separator: '#DFE1E4',
  accent: '#0B5DDD',
  accentSoft: '#E5EEFC',
  positive: '#137556',
  positiveSoft: '#DDEFE8',
  danger: '#D55B45',
  dangerSoft: '#F8E2DE',
  warning: '#9C671B',
  warningSoft: '#F5E9D5',
  blue: '#0B5DDD',
  blueSoft: '#D9E7FA',
  chart: '#0B5DDD',
  chartRaised: '#176FE5',
  glass: 'rgba(246, 249, 255, 0.78)',
  glassBorder: 'rgba(255, 255, 255, 0.96)',
  glassHighlight: 'rgba(255, 255, 255, 0.72)',
  glassShadow: 'rgba(30, 55, 95, 0.18)',
  tabBar: 'rgba(241, 246, 253, 0.86)',
} as const;

const dark = {
  background: '#17212E',
  surface: '#1E2B3A',
  surfaceSoft: '#27374A',
  text: '#F4F3EF',
  secondary: '#AEB8C5',
  tertiary: '#8794A5',
  separator: '#35465A',
  accent: '#68A4FF',
  accentSoft: '#253F63',
  positive: '#53D2A7',
  positiveSoft: '#1D493E',
  danger: '#FF8975',
  dangerSoft: '#54302D',
  warning: '#EFB456',
  warningSoft: '#4E402A',
  blue: '#68A4FF',
  blueSoft: '#2E4F78',
  chart: '#1C6FD8',
  chartRaised: '#237FE8',
  glass: 'rgba(55, 70, 90, 0.78)',
  glassBorder: 'rgba(210, 226, 247, 0.34)',
  glassHighlight: 'rgba(223, 235, 255, 0.24)',
  glassShadow: 'rgba(3, 8, 17, 0.48)',
  tabBar: 'rgba(44, 59, 79, 0.88)',
} as const;

export type AppColors = {
  [Key in keyof typeof light]: string;
};

export function useAppColors(): AppColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function chartColors(isDark: boolean) {
  return isDark
    ? { primary: dark.accent, previous: '#64758B', fill: '#284F7A', grid: '#35465A' }
    : { primary: light.accent, previous: '#A6B1C0', fill: '#D6E7FC', grid: '#DFE5EC' };
}

const categoryMarks = {
  light: {
    Dining: '#D8E9DE',
    Income: '#D4E7E0',
    Health: '#E9DED7',
    Subscriptions: '#E1DDEA',
    Groceries: '#EFE1D2',
    Transfer: '#D9E4EB',
    Transport: '#D7E4EE',
    Housing: '#E6DFD2',
    Travel: '#DCE5DC',
  },
  dark: {
    Dining: '#24473E',
    Income: '#21445A',
    Health: '#50352F',
    Subscriptions: '#403951',
    Groceries: '#4B3C2E',
    Transfer: '#263E50',
    Transport: '#264359',
    Housing: '#463F32',
    Travel: '#30483B',
  },
} as const;

export function categoryMarkColor(category: string, isDark: boolean, fallback: string): string {
  const colors: Partial<Record<string, string>> = isDark ? categoryMarks.dark : categoryMarks.light;
  return colors[category] ?? fallback;
}
