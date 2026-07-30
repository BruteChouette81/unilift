import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const C = {
  bg:          "#080810",
  border:      "rgba(137, 56, 213, 0.30)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
};

interface RequestLiftSheetProps {
  visible: boolean;
  onClose: () => void;
  placeName: string;
  address?: string;
  /** Driver count, or `undefined`/`null` when it isn't known yet — `undefined`
   *  while the first poll is in flight, `null` when the lookup failed. Both
   *  render the pulsing placeholder; only a real number is ever shown, so a
   *  failed request can't masquerade as "0 drivers available". */
  availableDrivers?: number | null;
  onRequestLift: () => void;
}

export function RequestLiftSheet({
  visible,
  onClose,
  placeName,
  address,
  availableDrivers,
  onRequestLift,
}: RequestLiftSheetProps) {
  const insets = useSafeAreaInsets();

  const driverCountKnown = typeof availableDrivers === "number";

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (driverCountKnown) { pulse.setValue(1); return; }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [driverCountKnown, pulse]);

  const swipePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 40 || gs.vy > 0.3) onClose();
      },
    }),
  ).current;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />

        <View style={styles.sheet}>
          <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={styles.blur}>

            {/* Drag handle */}
            <View style={styles.dragZone} {...swipePan.panHandlers}>
              <View style={styles.handle} />
            </View>

            {/* Destination */}
            <Text style={styles.eyebrow}>Destination</Text>
            <Text style={styles.title} numberOfLines={2}>{placeName}</Text>
            {address ? (
              <View style={styles.addressRow}>
                <Ionicons name="location-outline" size={13} color={C.muted} />
                <Text style={styles.address} numberOfLines={1}>{address}</Text>
              </View>
            ) : <View style={styles.titleSpacing} />}

            {/* Available drivers — focal stat */}
            <View style={styles.driversCard}>
              <LinearGradient
                colors={["rgba(137,56,213,0.18)", "rgba(99,102,241,0.10)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.driversGradient}
              >
                <View style={styles.driversIcon}>
                  <Ionicons name="car-sport" size={28} color={C.purpleLight} />
                </View>
                <View>
                  {driverCountKnown ? (
                    <Text style={styles.driversCount}>{availableDrivers}</Text>
                  ) : (
                    <Animated.Text style={[styles.driversCount, { opacity: pulse }]}>—</Animated.Text>
                  )}
                  <Text style={styles.driversLabel}>conducteurs disponibles</Text>
                </View>
              </LinearGradient>
            </View>

            {/* CTA */}
            <TouchableOpacity style={styles.ctaWrap} onPress={onRequestLift} activeOpacity={0.85}>
              <LinearGradient
                colors={["#8938D5", "#FD165A"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.ctaGradient}
              >
                <Ionicons name="car" size={18} color="#fff" />
                <Text style={styles.ctaText}>Demander un lift</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Helper */}
            <Text style={styles.helper}>
              Une notification sera envoyée aux conducteurs disponibles près de cet événement.
            </Text>

            <View style={{ height: Math.max(insets.bottom, 16) + 16 }} />
          </BlurView>
        </View>
        {/* Fill the gap below the floating tab bar so no overlay bleeds through */}
        <View style={{ height: Math.max(insets.bottom, 8) + 10, backgroundColor: "rgba(8,8,16,0.97)" }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "rgba(137,56,213,0.30)",
    shadowColor: "#8938D5",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
  blur: {
    paddingHorizontal: 22,
  },
  dragZone: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 14,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(137,56,213,0.45)",
  },
  eyebrow: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
  titleSpacing: {
    height: 20,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 5,
    marginBottom: 20,
  },
  address: {
    color: C.muted,
    fontSize: 13,
    flex: 1,
  },
  driversCard: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.30)",
    marginBottom: 20,
  },
  driversGradient: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 20,
    paddingHorizontal: 20,
    gap: 18,
  },
  driversIcon: {
    width: 58,
    height: 58,
    borderRadius: 17,
    backgroundColor: "rgba(137,56,213,0.18)",
    borderWidth: 1,
    borderColor: "rgba(137,56,213,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  driversCount: {
    color: C.text,
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 44,
  },
  driversLabel: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  ctaWrap: {
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 14,
  },
  ctaGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 8,
  },
  ctaText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  helper: {
    color: C.dim,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    paddingBottom: 4,
  },
});
