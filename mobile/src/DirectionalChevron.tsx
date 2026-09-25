import { SymbolView } from 'expo-symbols';
import { useLanguage } from './localization';

export function DirectionalChevron({
  direction,
  size,
  tintColor,
}: {
  direction: 'forward' | 'back';
  size: number;
  tintColor: string;
}) {
  const { language } = useLanguage();
  const pointsRight = (direction === 'forward') !== (language === 'he');
  return (
    <SymbolView
      name={pointsRight ? 'chevron.right' : 'chevron.left'}
      size={size}
      tintColor={tintColor}
    />
  );
}
