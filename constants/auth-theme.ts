import { StyleSheet } from "react-native";

export const authColors = {
  screenBackground: "#101010",
  cardBackground: "#161A1D",
  cardBorder: "#252A2F",
  inputBorder: "#2F3542",
  inputBackground: "#1E2328",
  inputText: "#FFFFFF",
  placeholder: "#7F8C8D",
  title: "#FFFFFF",
  subtitle: "#A4B0BE",
  buttonBackground: "#007AFF",
  buttonText: "#FFFFFF",
  link: "#79B8FF",
} as const;

export const authStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
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
    fontSize: 30,
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
    padding: 12,
    marginBottom: 15,
    borderRadius: 10,
  },
  button: {
    backgroundColor: authColors.buttonBackground,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 4,
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
