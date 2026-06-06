import { Tabs } from "expo-router";
import { View } from "react-native";
import { CyberTabBar } from "../../src/components/CyberTabBar";
import { NetworkStatusProvider } from "../../src/context/NetworkStatusContext";
import { NetworkTopLine } from "../../src/components/NetworkStatusBar";
import { TabMapIcon, TabPatrolIcon, TabSearchIcon } from "../../src/components/TabIcons";

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <NetworkStatusProvider>
        <NetworkTopLine />
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
      </NetworkStatusProvider>
    </View>
  );
}
