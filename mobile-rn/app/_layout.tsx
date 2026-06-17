import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { AppDataProvider } from "../src/context/AppDataContext";
import { FinderProvider } from "../src/context/FinderContext";
import { PassProvider } from "../src/context/PassContext";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";

function RootStack() {
  const { colors, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <AppDataProvider>
            <FinderProvider>
              <PassProvider>
                <RootStack />
              </PassProvider>
            </FinderProvider>
          </AppDataProvider>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
