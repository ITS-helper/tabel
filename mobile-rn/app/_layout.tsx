import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppDataProvider } from "../src/context/AppDataContext";
import { colors } from "../src/theme/colors";

export default function RootLayout() {
  return (
    <AppDataProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </AppDataProvider>
  );
}
