import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "../../src/theme/colors";

function TabLabel({ label }: { label: string }) {
  return <Text style={{ color: colors.text, fontSize: 12 }}>{label}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          title: "Карта",
          tabBarLabel: ({ color }) => <TabLabel label="Карта" />,
        }}
      />
      <Tabs.Screen
        name="field"
        options={{
          title: "Обход",
          tabBarLabel: ({ color }) => <TabLabel label="Обход" />,
        }}
      />
      <Tabs.Screen
        name="finder"
        options={{
          title: "Поиск",
          tabBarLabel: ({ color }) => <TabLabel label="Поиск" />,
        }}
      />
    </Tabs>
  );
}
