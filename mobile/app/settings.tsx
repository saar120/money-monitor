import { SymbolView } from 'expo-symbols';
import { I18nManager, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/LocalizedText';
import { t, type LanguageChoice, useLanguage } from '@/localization';
import { useAppColors } from '@/theme';

const choices: { value: LanguageChoice; label: 'systemDefault' | 'english' | 'hebrew' }[] = [
  { value: 'system', label: 'systemDefault' },
  { value: 'en', label: 'english' },
  { value: 'he', label: 'hebrew' },
];

export default function SettingsScreen() {
  const colors = useAppColors();
  const { choice, language, setChoice } = useLanguage();
  const needsRestart = I18nManager.isRTL !== (language === 'he');

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.heading, { color: colors.text }]}>{t('appLanguage')}</Text>
      <View style={[styles.group, { backgroundColor: colors.surface }]}>
        {choices.map(({ value, label }, index) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: choice === value }}
            key={value}
            onPress={() => setChoice(value)}
            style={({ pressed }) => [
              styles.row,
              {
                borderBottomColor: colors.separator,
                borderBottomWidth: index === choices.length - 1 ? 0 : StyleSheet.hairlineWidth,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
            testID={`language-${value}`}
          >
            <Text style={[styles.label, { color: colors.text }]}>{t(label)}</Text>
            {choice === value ? (
              <SymbolView name="checkmark" size={16} tintColor={colors.accent} />
            ) : null}
          </Pressable>
        ))}
      </View>
      {needsRestart ? (
        <Text style={[styles.note, { color: colors.secondary }]}>
          {t('restartTheAppToApplyTheNavigationDirectionEverywhere')}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20 },
  heading: { fontSize: 14, fontWeight: '600', marginBottom: 10 },
  group: { borderRadius: 16, paddingHorizontal: 16 },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: { fontSize: 16 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 14 },
});
