import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';
import { useLanguage } from './localization';

export function Text({ children, style, ...props }: TextProps) {
  const { language } = useLanguage();
  const alignment = language === 'he' ? StyleSheet.flatten(style)?.textAlign : undefined;
  const mirroredAlignment =
    alignment === 'left' ? 'right' : alignment === 'right' ? 'left' : undefined;
  return (
    <NativeText
      {...props}
      style={[
        { writingDirection: language === 'he' ? 'rtl' : 'ltr' },
        style,
        mirroredAlignment && { textAlign: mirroredAlignment },
      ]}
    >
      {children}
    </NativeText>
  );
}
