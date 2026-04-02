import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { useAuth } from "@/context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  inputBg:     "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(137, 56, 213, 0.2)",
  inputFocus:  "rgba(137, 56, 213, 0.7)",
};

const PREFERENCE_OPTIONS: { key: string; label: string }[] = [
  { key: "no_smoking",  label: "No Smoking"  },
  { key: "music_ok",   label: "Music OK"    },
  { key: "quiet_ride", label: "Quiet Ride"  },
  { key: "pets_ok",    label: "Pets OK"     },
  { key: "chatty",     label: "Chatty"      },
  { key: "fast_driver",label: "Fast Driver" },
];

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{
    name: string;
    age: string;
    school: string;
    prefs: string;
  }>();

  const [name, setName]       = useState(params.name ?? "");
  const [age, setAge]         = useState(params.age ?? "");
  const [school, setSchool]   = useState(params.school ?? "");
  const [preferences, setPreferences] = useState<string[]>(
    params.prefs ? params.prefs.split(",").filter(Boolean) : [],
  );

  const [nameFocused,   setNameFocused]   = useState(false);
  const [ageFocused,    setAgeFocused]    = useState(false);
  const [schoolFocused, setSchoolFocused] = useState(false);
  const [saving, setSaving] = useState(false);

  const togglePreference = (key: string) => {
    setPreferences((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  };

  const handleSave = async () => {
    if (!user || saving) return;
    try {
      setSaving(true);
      const token = await user.getIdToken();
      const res = await fetch(
        firestoreDocumentUrl("users", user.uid) +
          "?updateMask.fieldPaths=name&updateMask.fieldPaths=age&updateMask.fieldPaths=school&updateMask.fieldPaths=preferences",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            fields: {
              name:        { stringValue: name.trim() },
              age:         { integerValue: parseInt(age) || 0 },
              school:      { stringValue: school.trim() },
              preferences: {
                arrayValue: {
                  values: preferences.map((p) => ({ stringValue: p })),
                },
              },
            },
          }),
        },
      );

      if (!res.ok) throw new Error(await res.text());
      router.back();
    } catch {
      Alert.alert("Save failed", "Could not save your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Text style={{fontSize: 20}}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>My Profile</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Name */}
        <Text style={styles.label}>Name</Text>
        <View style={[styles.inputRow, nameFocused && styles.inputRowFocused]}>
          <Text style={[{fontSize: 16}, styles.inputIcon]}>👤</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={C.muted}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
          />
        </View>

        {/* Age */}
        <Text style={styles.label}>Age</Text>
        <View style={[styles.inputRow, ageFocused && styles.inputRowFocused]}>
          <Text style={[{fontSize: 16}, styles.inputIcon]}>📅</Text>
          <TextInput
            style={styles.textInput}
            value={age}
            onChangeText={(v) => setAge(v.replace(/[^0-9]/g, "").slice(0, 2))}
            placeholder="Your age"
            placeholderTextColor={C.muted}
            keyboardType="number-pad"
            maxLength={2}
            onFocus={() => setAgeFocused(true)}
            onBlur={() => setAgeFocused(false)}
          />
        </View>

        {/* School */}
        <Text style={styles.label}>School</Text>
        <View style={[styles.inputRow, schoolFocused && styles.inputRowFocused]}>
          <Text style={[{fontSize: 16}, styles.inputIcon]}>🎓</Text>
          <TextInput
            style={styles.textInput}
            value={school}
            onChangeText={setSchool}
            placeholder="University or college"
            placeholderTextColor={C.muted}
            onFocus={() => setSchoolFocused(true)}
            onBlur={() => setSchoolFocused(false)}
          />
        </View>

        {/* Preferences */}
        <Text style={styles.label}>Ride Preferences</Text>
        <View style={styles.chipsRow}>
          {PREFERENCE_OPTIONS.map((opt) => {
            const selected = preferences.includes(opt.key);
            return (
              <Pressable
                key={opt.key}
                onPress={() => togglePreference(opt.key)}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Save */}
        <Pressable onPress={handleSave} disabled={saving} style={{ marginTop: 32 }}>
          <LinearGradient
            colors={["#FD165A", "#8938D5"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          >
            {saving ? (
              <View style={styles.saveBtnContent}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>Saving…</Text>
              </View>
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </LinearGradient>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 20,
    paddingBottom: 14,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(224,154,247,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: "700",
  },
  scroll: {
    padding: 20,
    paddingTop: 24,
  },
  label: {
    color: C.muted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.inputBorder,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  inputRowFocused: {
    borderColor: C.inputFocus,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.3)",
    backgroundColor: "rgba(137, 56, 213, 0.05)",
  },
  chipSelected: {
    backgroundColor: "#8938D5",
    borderColor: "#8938D5",
  },
  chipText: {
    color: C.muted,
    fontSize: 13,
    fontWeight: "500",
  },
  chipTextSelected: {
    color: "#fff",
  },
  saveBtn: {
    height: 52,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  saveBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
});
