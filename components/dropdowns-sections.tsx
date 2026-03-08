import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const C = {
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(124, 58, 237, 0.22)",
  purpleLight: "#a78bfa",
  text:        "#f3f4f6",
  dim:         "#4b5563",
};

interface Props {
  title: string;
  children: React.ReactNode;
}

export default function DropdownSection({ title, children }: Props) {
  const [open, setOpen] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const toValue = open ? 0 : 1;
    Animated.timing(animation, {
      toValue,
      duration: 200,
      useNativeDriver: true,
    }).start();

    setOpen(!open);
  };

  const rotate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });

  return (
    <View style={styles.section}>
      {/* Header */}
      <TouchableOpacity style={styles.header} onPress={toggle}>
        <Text style={styles.title}>{title}</Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="chevron-forward" size={18} color={C.purpleLight} />
        </Animated.View>
      </TouchableOpacity>

      {/* Dropdown Content */}
      {open && <View style={styles.content}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: C.surface,
    borderRadius: 14,
    marginBottom: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  header: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: C.surfaceAlt,
  },
  title: {
    color: C.text,
    fontSize: 15,
    fontWeight: "600",
  },
  content: {
    padding: 12,
    gap: 8,
  },
});