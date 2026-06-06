import { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTheme } from "../context/ThemeContext";
import type { AppColors } from "../theme/palettes";

type Props = TextInputProps & {
  value: string;
  onChangeText: (text: string) => void;
  onClear?: () => void;
};

export function SearchField({
  value,
  onChangeText,
  onClear,
  style,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const clear = () => {
    onChangeText("");
    onClear?.();
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        {...rest}
        style={[styles.input, style]}
        value={value}
        onChangeText={onChangeText}
      />
      {value.length > 0 ? (
        <Pressable
          style={styles.clearBtn}
          onPress={clear}
          hitSlop={8}
          accessibilityLabel="Очистить"
        >
          <Text style={styles.clearText}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (colors: AppColors) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      position: "relative",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingRight: 36,
      paddingVertical: 8,
      fontSize: 15,
      borderWidth: 1,
      borderColor: colors.border,
    },
    clearBtn: {
      position: "absolute",
      right: 4,
      top: 0,
      bottom: 0,
      width: 32,
      alignItems: "center",
      justifyContent: "center",
    },
    clearText: {
      color: colors.textMuted,
      fontSize: 22,
      lineHeight: 24,
      fontWeight: "300",
    },
  });
