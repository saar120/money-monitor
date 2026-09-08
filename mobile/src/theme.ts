import { useColorScheme } from 'react-native';

const light = {
  background: '#F5F3EE',
  surface: '#FCFBF8',
  text: '#171914',
  secondary: '#656A61',
  tertiary: '#6B7167',
  separator: '#D8D7CF',
  accent: '#216849',
  accentSoft: '#DCEAE2',
  danger: '#A63D35',
  dangerSoft: '#F3DEDA',
  warning: '#83500D',
  warningSoft: '#F3E7D1',
  blue: '#315F8B',
  blueSoft: '#DEE8F2',
  tabBar: '#F8F6F2',
} as const;

const dark = {
  background: '#11130F',
  surface: '#191C17',
  text: '#F3F3EC',
  secondary: '#ADB1A8',
  tertiary: '#9BA198',
  separator: '#32362F',
  accent: '#68C697',
  accentSoft: '#1C382A',
  danger: '#F08A7D',
  dangerSoft: '#452622',
  warning: '#E2B16A',
  warningSoft: '#44351F',
  blue: '#82AED7',
  blueSoft: '#24384B',
  tabBar: '#181A16',
} as const;

export type AppColors = {
  [Key in keyof typeof light]: string;
};

export function useAppColors(): AppColors {
  return useColorScheme() === 'dark' ? dark : light;
}

export function chartColors(isDark: boolean) {
  return isDark
    ? { primary: dark.accent, previous: '#5D665C', fill: '#244332', grid: '#2D322C' }
    : { primary: light.accent, previous: '#A7ADA5', fill: '#DDEBE3', grid: '#DFDDD6' };
}
