export type AppColors = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  neon: string;
  neonDim: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
  tabBar: string;
  tabBarBorder: string;
  glow: string;
};

/** Тёмная — cyberpunk, синий неон. */
export const darkCyber: AppColors = {
  bg: "#040810",
  surface: "#081422",
  surfaceAlt: "#0c1e36",
  text: "#e8f8ff",
  textMuted: "#5a8fad",
  accent: "#00d4ff",
  accentSoft: "rgba(0, 212, 255, 0.14)",
  neon: "#00e5ff",
  neonDim: "#0088cc",
  success: "#00ffc8",
  warning: "#ffb020",
  danger: "#ff3d6e",
  border: "rgba(0, 229, 255, 0.22)",
  tabBar: "#060e1a",
  tabBarBorder: "rgba(0, 229, 255, 0.45)",
  glow: "rgba(0, 229, 255, 0.55)",
};

/** Светлая — холодный голубой, без неона. */
export const lightCyber: AppColors = {
  bg: "#e8f4fc",
  surface: "#ffffff",
  surfaceAlt: "#d4e8f8",
  text: "#0a2840",
  textMuted: "#4a7090",
  accent: "#0077cc",
  accentSoft: "rgba(0, 119, 204, 0.12)",
  neon: "#0088dd",
  neonDim: "#0066aa",
  success: "#00a878",
  warning: "#d97706",
  danger: "#dc2626",
  border: "rgba(0, 100, 160, 0.18)",
  tabBar: "#f0f8ff",
  tabBarBorder: "rgba(0, 120, 200, 0.25)",
  glow: "rgba(0, 136, 204, 0.35)",
};
