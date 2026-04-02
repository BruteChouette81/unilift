import { StyleSheet } from "react-native";

export const authColors = {
  screenBackground: "#080810",
  cardBackground: "#0f0f1e",
  cardBorder: "rgba(137, 56, 213, 0.22)",
  inputBorder: "rgba(137, 56, 213, 0.2)",
  inputBackground: "rgba(255, 255, 255, 0.05)",
  inputText: "#f3f4f6",
  placeholder: "#9ca3af",
  title: "#f3f4f6",
  subtitle: "#9ca3af",
  buttonBackground: "#8938D5",
  buttonText: "#FFFFFF",
  link: "#e09af7",
  purple: "#8938D5",
  purpleLight: "#e09af7",
  muted: "#9ca3af",
  dim: "#4b5563",
  gradient: ["#2d0015", "#1c0038"] as [string, string],
} as const;

export const authStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: authColors.screenBackground,
  },
  card: {
    backgroundColor: authColors.cardBackground,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: authColors.cardBorder,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: authColors.title,
    marginBottom: 6,
    textAlign: "left",
  },
  subtitle: {
    color: authColors.subtitle,
    fontSize: 14,
    marginBottom: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: authColors.inputBorder,
    backgroundColor: authColors.inputBackground,
    color: authColors.inputText,
    padding: 14,
    marginBottom: 14,
    borderRadius: 12,
  },
  button: {
    backgroundColor: authColors.buttonBackground,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: "center",
    marginTop: 4,
    height: 52,
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  buttonText: {
    color: authColors.buttonText,
    fontWeight: "700",
    fontSize: 16,
  },
  loadingText: {
    marginLeft: 8,
  },
  link: {
    textAlign: "center",
    color: authColors.link,
    marginTop: 14,
    fontWeight: "600",
  },
});
