import { Tabs } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useAppColors } from '@/theme';

const icons: Record<string, { regular: SFSymbol; selected: SFSymbol }> = {
  home: { regular: 'house', selected: 'house.fill' },
  activity: { regular: 'list.bullet.rectangle', selected: 'list.bullet.rectangle.fill' },
  explore: { regular: 'chart.xyaxis.line', selected: 'chart.xyaxis.line' },
};

export default function TabsLayout() {
  const colors = useAppColors();
  return (
    <Tabs
      initialRouteName="home"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.tertiary,
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.separator },
        sceneStyle: { backgroundColor: colors.background },
        tabBarIcon: ({ color, focused }) => {
          const icon = icons[route.name] ?? icons.home!;
          return (
            <SymbolView name={focused ? icon.selected : icon.regular} size={21} tintColor={color} />
          );
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
    </Tabs>
  );
}
