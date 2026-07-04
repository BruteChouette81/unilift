import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useLanguage } from "@/context/LanguageContext";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { geoSuggestion } from "@/services/rideServices";
import type { FavoriteRoute } from "@/types/models";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
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
  TouchableOpacity,
  View,
} from "react-native";

// ─── Design Tokens (matches profileSettings) ─────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  inputBg:     "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(137, 56, 213, 0.2)",
  inputFocus:  "rgba(137, 56, 213, 0.7)",
};

export default function FavoriteScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { userData, updateUserData } = useUserProfile();
  const { t } = useLanguage();

  const params = useLocalSearchParams<{
    id: string;
    endAddress: string;
    endLat: string;
    endLon: string;
  }>();

  const isEditing = params.id !== undefined && params.id !== "";
  const editIndex = isEditing ? parseInt(params.id) : -1;

  const [endAddress, setEndAddress]         = useState(params.endAddress ?? "");
  const [endGeolocation, setEndGeolocation] = useState<{ lat: number; lon: number } | undefined>(
    params.endLat && params.endLon
      ? { lat: parseFloat(params.endLat), lon: parseFloat(params.endLon) }
      : undefined,
  );
  const [suggestions, setSuggestions]       = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputFocused, setInputFocused]     = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [error, setError]                   = useState("");

  const debouncedAddress = useDebouncedValue(endAddress, 450);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (debouncedAddress.length < 2) { setShowSuggestions(false); return; }
      const results = await geoSuggestion(debouncedAddress.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShowSuggestions((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedAddress]);

  const onSelectSuggestion = (item: any) => {
    setEndAddress(item.displayName);
    setEndGeolocation({ lat: parseFloat(item.lat), lon: parseFloat(item.lon) });
    setShowSuggestions(false);
  };

  // Build the Firestore arrayValue payload from a FavoriteRoute array
  const buildPayload = (items: FavoriteRoute[]) => ({
    favorite: {
      arrayValue: {
        values: items.map((r) => ({
          mapValue: {
            fields: {
              destination: { stringValue: r.destination },
              destinationGeolocation: {
                geoPointValue: {
                  latitude:  r.destinationGeo.lat,
                  longitude: r.destinationGeo.lon,
                },
              },
            },
          },
        })),
      },
    },
  });

  const patchFavorites = async (token: string, uid: string, items: FavoriteRoute[]) => {
    const res = await fetch(
      firestoreDocumentUrl("users", uid) + "?updateMask.fieldPaths=favorite",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields: buildPayload(items) }),
      },
    );
    if (!res.ok) throw new Error(await res.text());
  };

  const handleSave = async () => {
    if (!endAddress.trim()) { setError(t("favorites.destinationRequired")); return; }
    if (!user) return;
    setError("");
    setSaving(true);
    try {
      const token   = await user.getIdToken();
      const current = userData?.favorite ?? [];
      const newRoute: FavoriteRoute = {
        destination:    endAddress.trim(),
        destinationGeo: { lat: endGeolocation?.lat ?? 0, lon: endGeolocation?.lon ?? 0 },
      };

      const updated = isEditing
        ? current.map((r, i) => (i === editIndex ? newRoute : r))
        : [...current, newRoute];

      await patchFavorites(token, user.uid, updated);
      updateUserData({ favorite: updated });
      router.back();
    } catch {
      Alert.alert(t("favorites.saveFailed"), t("favorites.saveFailedMsg"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !isEditing) return;
    Alert.alert(t("favorites.deleteConfirm"), t("favorites.deleteConfirmMsg"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive",
        onPress: async () => {
          setSaving(true);
          try {
            const token   = await user.getIdToken();
            const current = userData?.favorite ?? [];
            const updated = current.filter((_, i) => i !== editIndex);
            await patchFavorites(token, user.uid, updated);
            updateUserData({ favorite: updated });
            router.back();
          } catch {
            Alert.alert(t("favorites.deleteFailed"), t("favorites.deleteFailedMsg"));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <LinearGradient colors={["#FD165A", "#8938D5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </LinearGradient>
        </Pressable>
        <Text style={styles.headerTitle}>
          {isEditing ? t("favorites.editTitle") : t("favorites.newTitle")}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Destination ──────────────────────────────────────────────────── */}
        <Text style={styles.label}>{t("favorites.destination")}</Text>
        <View style={[styles.inputRow, inputFocused && styles.inputRowFocused, !!error && styles.inputRowError]}>
          <Text style={[{ fontSize: 16 }, styles.inputIcon]}>📍</Text>
          <TextInput
            style={styles.textInput}
            value={endAddress}
            onChangeText={(text) => { setEndAddress(text); setError(""); }}
            placeholder={t("favorites.searchPlaceholder")}
            placeholderTextColor={C.muted}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
          />
          {endAddress.length > 0 && (
            <TouchableOpacity onPress={() => { setEndAddress(""); setShowSuggestions(false); setEndGeolocation(undefined); }}>
              <Text style={{ fontSize: 14, color: C.muted }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        {!!error && <Text style={styles.errorText}>{error}</Text>}

        {/* ── Suggestions ──────────────────────────────────────────────────── */}
        {showSuggestions && suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            {suggestions.map((item, index) => (
              <TouchableOpacity
                key={index}
                onPress={() => onSelectSuggestion(item)}
                style={[styles.suggestionItem, index === suggestions.length - 1 && { borderBottomWidth: 0 }]}
              >
                <Text style={{ fontSize: 12, marginRight: 8 }}>📍</Text>
                <Text style={styles.suggestionText} numberOfLines={1}>{item?.displayName}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Save ─────────────────────────────────────────────────────────── */}
        <Pressable onPress={handleSave} disabled={saving} style={{ marginTop: 32 }}>
          <LinearGradient
            colors={["#7C3AED", "#2563eb"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          >
            {saving ? (
              <View style={styles.saveBtnContent}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>{t("favorites.saving")}</Text>
              </View>
            ) : (
              <Text style={styles.saveBtnText}>
                {isEditing ? t("favorites.saveChanges") : t("favorites.addFavorite")}
              </Text>
            )}
          </LinearGradient>
        </Pressable>

        {/* ── Delete (editing only) ─────────────────────────────────────────── */}
        {isEditing && (
          <TouchableOpacity
            onPress={handleDelete}
            disabled={saving}
            style={styles.deleteBtn}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 13 }}>🗑️</Text>
            <Text style={styles.deleteText}>{t("favorites.deleteFavorite")}</Text>
          </TouchableOpacity>
        )}

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
    borderRadius: 10,
    overflow: "hidden",
  },
  backBtnGrad: {
    width: 38,
    height: 38,
    borderRadius: 10,
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
    marginBottom: 4,
  },
  inputRowFocused: {
    borderColor: C.inputFocus,
  },
  inputRowError: {
    borderColor: "rgba(248,113,113,0.5)",
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    color: C.text,
    fontSize: 15,
  },
  errorText: {
    color: C.danger,
    fontSize: 12,
    marginBottom: 4,
    marginLeft: 2,
  },
  suggestionsContainer: {
    marginTop: 8,
    backgroundColor: C.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.borderFaint,
    overflow: "hidden",
    marginBottom: 4,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.borderFaint,
  },
  suggestionText: {
    color: C.text,
    fontSize: 14,
    flex: 1,
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
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(248,113,113,0.25)",
    backgroundColor: "rgba(248,113,113,0.06)",
  },
  deleteText: {
    color: C.danger,
    fontSize: 15,
    fontWeight: "600",
  },
});
