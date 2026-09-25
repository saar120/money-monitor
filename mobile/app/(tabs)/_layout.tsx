import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useAppColors } from '@/theme';
import { t } from '@/localization';

export default function TabsLayout() {
  const colors = useAppColors();

  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      tintColor={colors.accent}
      labelStyle={{ fontSize: 11, fontWeight: '600' }}
    >
      <NativeTabs.Trigger name="home" accessibilityLabel={t('homeTab1Of3')} testID="tab-home">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>{t('home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="activity"
        accessibilityLabel={t('activityTab2Of3')}
        testID="tab-activity"
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }}
        />
        <NativeTabs.Trigger.Label>{t('activity')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="explore"
        accessibilityLabel={t('exploreTab3Of3')}
        testID="tab-explore"
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.xyaxis.line', selected: 'chart.xyaxis.line' }}
        />
        <NativeTabs.Trigger.Label>{t('explore')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
