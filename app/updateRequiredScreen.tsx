import { isUpdateRequired } from "@/constants/force-update-config";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  minimumVersion: string;
  iosStoreUrl: string;
  androidStoreUrl: string;
};

export default function UpdateRequiredScreen({ minimumVersion, iosStoreUrl, androidStoreUrl }: Props) {
  const installedVersion = Constants.expoConfig?.version ?? "0.0.0";
  const storeUrl = Platform.OS === "ios" ? iosStoreUrl : androidStoreUrl;

  const handleUpdate = () => {
    Linking.openURL(storeUrl).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#3b0764", "#1e3a8a"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.card}>
        <LinearGradient
          colors={["#1e1b4b", "#0d1224"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.cardGradient}
        />
        <Text style={styles.icon}>🚀</Text>
        <Text style={styles.title}>Update Required</Text>
        <Text style={styles.body}>
          Version {minimumVersion} is now required to use UniLift.{"\n"}
          You are on version {installedVersion}.
        </Text>
        <TouchableOpacity style={styles.button} activeOpacity={0.8} onPress={handleUpdate}>
          <LinearGradient
            colors={["#7C3AED", "#2563eb"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.buttonGradient}
          >
            <Text style={styles.buttonText}>Update Now</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#080810",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 20,
    overflow: "hidden",
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(124, 58, 237, 0.3)",
  },
  cardGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  icon: {
    fontSize: 48,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#f3f4f6",
    marginBottom: 12,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: "#a78bfa",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  button: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
  },
  buttonGradient: {
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },
});
