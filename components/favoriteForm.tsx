import { geoSuggestion } from "@/services/rideServices";
import { useUserProfile } from "@/context/UserProfileContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLanguage } from "@/context/LanguageContext";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { P } from "@/constants/palette";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  bg:          P.bg,
  surface:     P.surface,
  surfaceAlt:  P.surfaceRaised,
  border:      "rgba(124, 58, 237, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      P.accentDeep,
  purpleLight: P.accentSoft,
  text:        P.text,
  muted:       P.textMuted,
  dim:         P.textDim,
  danger:      P.danger,
  gold:        P.warning,
};

const HEADER_GRADIENT = ["#3b0764", "#1e3a8a"] as const;
const CARD_GRADIENT   = ["#1e1b4b", "#0d1224"] as const;
const BTN_GRADIENT    = ["#7C3AED", "#2563eb"] as const;

// ─── Types ───────────────────────────────────────────────────────────────────
export type FavoriteRoute = {
  id?: number;
  endGeolocation?: { lat: number; lon: number };
  endAddress: string;
};

type Props = {
  initialData?: FavoriteRoute;
  onSubmit: (route: FavoriteRoute) => void;
  onCancel?: () => void;
  onDelete: (id: number) => void;
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function FavoriteRouteForm({
  initialData,
  onSubmit,
  onCancel,
  onDelete,
}: Props) {
  const { t } = useLanguage();
  const { userData } = useUserProfile();
  // Primitives, so the effect re-fires only when the position actually moves.
  const originLat = userData?.localisation?.latitude ?? null;
  const originLon = userData?.localisation?.longitude ?? null;
  const [endAddress, setEndAddress]         = useState(initialData?.endAddress ?? "");
  const [endGeolocation, setEndGeolocation] = useState<{ lat: number; lon: number } | undefined>(initialData?.endGeolocation);
  const [endSuggestions, setEndSuggestions] = useState<any[]>([]);
  const [showEndSuggestions, setShowEndSuggestions] = useState(false);
  const [errors, setErrors]                 = useState<Record<string, string>>({});
  const debouncedEndAddress = useDebouncedValue(endAddress, 450);

  const isEditing = !!initialData;

  const onEndAddressChange = (text: string) => {
    setEndAddress(text);
  };

  const onSelectSuggestion = (item: any) => {
    setEndAddress(item.displayName);
    setEndGeolocation({ lat: parseFloat(item.lat), lon: parseFloat(item.lon) });
    setShowEndSuggestions(false);
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!endAddress.trim()) e.endAddress = t("favorites.destinationRequired");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (debouncedEndAddress.length < 2) { setShowEndSuggestions(false); return; }
      // Capped to MAX_SUGGESTION_DISTANCE_KM around the user's stored position.
      const results = await geoSuggestion(
        debouncedEndAddress.trim(),
        undefined,
        originLat != null && originLon != null
          ? { latitude: originLat, longitude: originLon }
          : null,
      );
      if (cancelled) return;
      setEndSuggestions(results ?? []);
      setShowEndSuggestions((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedEndAddress, originLat, originLon]);

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit({ id: initialData?.id, endGeolocation, endAddress });
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <LinearGradient colors={HEADER_GRADIENT} style={styles.header}>
        <View style={styles.headerContent}>
          <LinearGradient colors={CARD_GRADIENT} style={styles.headerIcon}>
            <Text style={{fontSize: 18}}>⭐</Text>
          </LinearGradient>
          <View>
            <Text style={styles.headerTitle}>
              {isEditing ? t("favorites.editTitle") : t("favorites.newTitle")}
            </Text>
            <Text style={styles.headerSub}>{t("favorites.headerSub")}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.body}>
        {/* ── Destination Input ───────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <View style={styles.sectionIconDot}>
            <Text style={{fontSize: 12}}>📍</Text>
          </View>
          <Text style={styles.sectionTitle}>{t("favorites.destination")}</Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.inputWrapper, errors.endAddress && styles.inputError]}>
            <Text style={[{fontSize: 14}, { marginRight: 8 }]}>🔍</Text>
            <TextInput
              style={styles.input}
              placeholder={t("favorites.searchPlaceholder")}
              placeholderTextColor={C.dim}
              value={endAddress}
              onChangeText={onEndAddressChange}
            />
            {endAddress.length > 0 && (
              <TouchableOpacity onPress={() => { setEndAddress(""); setShowEndSuggestions(false); }}>
                <Text style={{fontSize: 14}}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {errors.endAddress && (
            <Text style={styles.errorText}>{errors.endAddress}</Text>
          )}

          {/* Suggestions */}
          {showEndSuggestions && endSuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {endSuggestions.map((item, index) => (
                <TouchableOpacity
                  key={index}
                  onPress={() => onSelectSuggestion(item)}
                  style={[
                    styles.suggestionItem,
                    index === endSuggestions.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <Text style={[{fontSize: 12}, { marginRight: 8 }]}>📍</Text>
                  <Text style={styles.suggestionText} numberOfLines={1}>{item?.displayName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        <Pressable onPress={handleSubmit} style={styles.submitBtn}>
          <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.submitGrad}>
            <Text style={{fontSize: 15}}>{isEditing ? "✓" : "⭐"}</Text>
            <Text style={styles.submitText}>{isEditing ? t("favorites.saveChanges") : t("favorites.addFavorite")}</Text>
          </LinearGradient>
        </Pressable>

        {onCancel && (
          <TouchableOpacity onPress={onCancel} style={styles.cancelBtn} activeOpacity={0.8}>
            <Text style={styles.cancelText}>{t("favorites.cancel")}</Text>
          </TouchableOpacity>
        )}

        {isEditing && initialData?.id !== undefined && (
          <TouchableOpacity
            onPress={() => { if (initialData.id !== undefined) onDelete(initialData.id); }}
            style={styles.deleteBtn}
            activeOpacity={0.8}
          >
            <Text style={{fontSize: 13}}>🗑️</Text>
            <Text style={styles.deleteText}>{t("favorites.deleteFavorite")}</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // ── Header ──────────────────────────────────────────────────────────────────
  header:        { paddingTop: 56, paddingBottom: 24, paddingHorizontal: 20 },
  headerContent: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerIcon:    { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.border },
  headerTitle:   { color: C.text, fontSize: 22, fontWeight: "800" },
  headerSub:     { color: "rgba(255,255,255,0.55)", fontSize: 13, marginTop: 2 },

  // ── Body ────────────────────────────────────────────────────────────────────
  body: { paddingHorizontal: 16, paddingBottom: 20 },

  // ── Section Header ──────────────────────────────────────────────────────────
  sectionHeader:  { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 22 },
  sectionIconDot: { width: 26, height: 26, borderRadius: 7, backgroundColor: "rgba(167,139,250,0.12)", alignItems: "center", justifyContent: "center" },
  sectionTitle:   { color: C.text, fontSize: 15, fontWeight: "700", letterSpacing: 0.2 },

  // ── Card ────────────────────────────────────────────────────────────────────
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.borderFaint },

  // ── Input ───────────────────────────────────────────────────────────────────
  inputWrapper: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
    borderRadius: 10, paddingHorizontal: 12,
  },
  inputError: { borderColor: "rgba(248,113,113,0.5)" },
  input:      { flex: 1, paddingVertical: 11, fontSize: 14, color: C.text },
  errorText:  { color: C.danger, fontSize: 12, marginTop: 6, marginLeft: 2 },

  // ── Suggestions ─────────────────────────────────────────────────────────────
  suggestionsContainer: {
    marginTop: 10, backgroundColor: C.surfaceAlt,
    borderRadius: 10, borderWidth: 1, borderColor: C.borderFaint, overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 11, paddingHorizontal: 12,
    borderBottomWidth: 1, borderBottomColor: C.borderFaint,
  },
  suggestionText: { color: C.text, fontSize: 13, flex: 1 },

  // ── Buttons ─────────────────────────────────────────────────────────────────
  submitBtn:  { marginTop: 28, borderRadius: 14, overflow: "hidden" },
  submitGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  cancelBtn:  { marginTop: 10, paddingVertical: 13, borderRadius: 14, alignItems: "center", borderWidth: 1, borderColor: C.borderFaint, backgroundColor: C.surface },
  cancelText: { color: C.muted, fontSize: 14, fontWeight: "600" },

  deleteBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: "rgba(248,113,113,0.25)", backgroundColor: "rgba(248,113,113,0.06)" },
  deleteText: { color: C.danger, fontSize: 14, fontWeight: "600" },
});
