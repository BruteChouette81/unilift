import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useLanguage } from "@/context/LanguageContext";
import { firestoreDocumentUrl } from "@/constants/runtime-config";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { geoSuggestion } from "@/services/rideServices";
import type { FavoriteRoute } from "@/types/models";
import { useLocalSearchParams, useRouter } from "expo-router";
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
import { P } from "@/constants/palette";

// ─── Design Tokens (matches profileSettings) ─────────────────────────────────
const C = {
  bg:          P.bg,
  surface:     P.surface,
  surfaceAlt:  P.surfaceRaised,
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      P.accent,
  purpleLight: P.accentLight,
  text:        P.text,
  muted:       P.textMuted,
  dim:         P.textDim,
  danger:      P.danger,
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
  // Primitives, so the effect re-fires only when the position actually moves.
  const originLat = userData?.localisation?.latitude ?? null;
  const originLon = userData?.localisation?.longitude ?? null;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (debouncedAddress.length < 2) { setShowSuggestions(false); return; }
      // Capped to MAX_SUGGESTION_DISTANCE_KM around the user's stored position.
      const results = await geoSuggestion(
        debouncedAddress.trim(),
        undefined,
        originLat != null && originLon != null
          ? { latitude: originLat, longitude: originLon }
          : null,
      );
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShowSuggestions((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedAddress, originLat, originLon]);

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
          <View style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#2d0015" />
          </View>
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
          <Ionicons name="location-outline" size={18} color={C.purpleLight} style={styles.inputIcon} />
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
              <Ionicons name="close-circle" size={18} color={C.muted} />
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
                <Ionicons name="location-outline" size={14} color={C.muted} style={{ marginRight: 8 }} />
                <Text style={styles.suggestionText} numberOfLines={1}>{item?.displayName}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Save ─────────────────────────────────────────────────────────── */}
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, { marginTop: 32 }, saving && { opacity: 0.7 }]}
        >
          {saving ? (
            <View style={styles.saveBtnContent}>
              <ActivityIndicator color="#2d0015" size="small" />
              <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>{t("favorites.saving")}</Text>
            </View>
          ) : (
            <Text style={styles.saveBtnText}>
              {isEditing ? t("favorites.saveChanges") : t("favorites.addFavorite")}
            </Text>
          )}
        </Pressable>

        {/* ── Delete (editing only) ─────────────────────────────────────────── */}
        {isEditing && (
          <TouchableOpacity
            onPress={handleDelete}
            disabled={saving}
            style={styles.deleteBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={15} color={C.danger} />
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
    backgroundColor: "#e09af7",
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
    backgroundColor: "#e09af7",
  },
  saveBtnContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  saveBtnText: {
    color: "#2d0015",
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
