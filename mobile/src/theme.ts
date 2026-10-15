import { useColorScheme } from 'react-native';

const light = {
  background: '#F3F3EE',
  surface: '#FDFDFB',
  surfaceSoft: '#E9EBE4',
  text: '#242B26',
  secondary: '#616B62',
  tertiary: '#626C63',
  separator: '#DDE2D9',
  accent: '#285F9B',
  onAccent: '#FDFDFB',
  accentSoft: '#E3ECF5',
  positive: '#137556',
  positiveSoft: '#DDEFE8',
  danger: '#AE4232',
  dangerSoft: '#F8E2DE',
  warning: '#8F5E19',
  warningSoft: '#F5E9D5',
  blue: '#285F9B',
  blueSoft: '#E3ECF5',
  chart: '#386C8C',
  chartComparison: '#7B857C',
  chartRaised: '#285F9B',
  glass: 'rgba(243, 243, 238, 0.78)',
  glassBorder: 'rgba(253, 253, 251, 0.96)',
  glassHighlight: 'rgba(255, 255, 255, 0.72)',
  glassShadow: 'rgba(36, 43, 38, 0.14)',
  tabBar: 'rgba(243, 243, 238, 0.86)',
} as const;

const dark = {
  background: '#191E1B',
  surface: '#202521',
  surfaceSoft: '#2C342E',
  text: '#F1F3EC',
  secondary: '#B4BDB1',
  tertiary: '#98A493',
  separator: '#394139',
  accent: '#A9C9EF',
  onAccent: '#191E1B',
  accentSoft: '#293C4D',
  positive: '#53D2A7',
  positiveSoft: '#1D493E',
  danger: '#FF8975',
  dangerSoft: '#54302D',
  warning: '#EFB456',
  warningSoft: '#4E402A',
  blue: '#A9C9EF',
  blueSoft: '#293C4D',
  chart: '#A3C2DC',
  chartComparison: '#8B9988',
  chartRaised: '#A9C9EF',
  glass: 'rgba(44, 52, 46, 0.78)',
  glassBorder: 'rgba(241, 243, 236, 0.24)',
  glassHighlight: 'rgba(241, 243, 236, 0.18)',
  glassShadow: 'rgba(10, 16, 12, 0.48)',
  tabBar: 'rgba(44, 52, 46, 0.88)',
} as const;

export type AppColors = {
  [Key in keyof typeof light]: string;
};

export function useAppColors(): AppColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function chartColors(isDark: boolean) {
  return isDark
    ? { primary: dark.chart, previous: dark.chartComparison, fill: '#293C4D', grid: dark.separator }
    : {
        primary: light.chart,
        previous: light.chartComparison,
        fill: '#E3ECF5',
        grid: light.separator,
      };
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
