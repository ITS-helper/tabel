import { Tabs } from "expo-router";
import { CyberTabBar } from "../../src/components/CyberTabBar";
import { TabMapIcon, TabPatrolIcon, TabSearchIcon } from "../../src/components/TabIcons";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CyberTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: "Карта",
          tabBarIcon: ({ focused }) => <TabMapIcon active={focused} />,
        }}
      />
      <Tabs.Screen
        name="field"
        options={{
          title: "Обход",
          tabBarIcon: ({ focused }) => <TabPatrolIcon active={focused} />,
        }}
      />
      <Tabs.Screen
        name="finder"
        options={{
          title: "Поиск",
          tabBarIcon: ({ focused }) => <TabSearchIcon active={focused} />,
        }}
      />
    </Tabs>
  );
}
