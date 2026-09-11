import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useAppColors } from '@/theme';

export default function TabsLayout() {
  const colors = useAppColors();

  return (
    <NativeTabs
      minimizeBehavior="onScrollDown"
      tintColor={colors.accent}
      labelStyle={{ fontSize: 11, fontWeight: '600' }}
    >
      <NativeTabs.Trigger name="home" accessibilityLabel="Home, tab, 1 of 3" testID="tab-home">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="activity"
        accessibilityLabel="Activity, tab, 2 of 3"
        testID="tab-activity"
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' }}
        />
        <NativeTabs.Trigger.Label>Activity</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger
        name="explore"
        accessibilityLabel="Explore, tab, 3 of 3"
        testID="tab-explore"
      >
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.xyaxis.line', selected: 'chart.xyaxis.line' }}
        />
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
