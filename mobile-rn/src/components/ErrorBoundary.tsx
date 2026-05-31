import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../context/ThemeContext";
import type { AppColors } from "../theme/palettes";

type Props = { children: ReactNode };
type State = { error: Error | null };

function ErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Ошибка приложения</Text>
      <Text style={styles.msg}>{error.message}</Text>
      <Pressable style={styles.btn} onPress={onRetry}>
        <Text style={styles.btnText}>Повторить</Text>
      </Pressable>
    </View>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      backgroundColor: colors.bg,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 12,
    },
    title: { color: colors.text, fontSize: 18, fontWeight: "700" },
    msg: { color: colors.danger, textAlign: "center" },
    btn: {
      marginTop: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.accent,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.neon,
    },
    btnText: { color: "#fff", fontWeight: "600" },
  });
