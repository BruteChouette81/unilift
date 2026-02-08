import { Ionicons } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";

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
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </Animated.View>
      </TouchableOpacity>

      {/* Dropdown Content */}
      {open && <View style={styles.content}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    marginBottom: 12,
    overflow: "hidden",
  },
  header: {
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#222",
  },
  title: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  content: {
    padding: 16,
    gap: 8,
  },
});