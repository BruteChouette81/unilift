import { encodeDriverAvailabilityFields, patchUserField } from "@/components/userHelper";
import { useAuth } from "@/context/AuthContext";
import { confirmPaymentMethod, setupPaymentMethod } from "@/services/walletService";
import { initPaymentSheet, presentPaymentSheet } from "@stripe/stripe-react-native";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { geoSuggestion, type LocationResult } from "@/services/rideServices";
import { WEEKDAY_KEYS, type DriverAvailabilityWindow, type FavoriteRoute, type WeekdayKey } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Design Tokens (UniLift brand) ──────────────────────────────────────────
const C = {
  bg:          "#080810",
  surface:     "#0f0f1e",
  surfaceAlt:  "#13132a",
  border:      "rgba(137, 56, 213, 0.30)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      "#8938D5",
  purpleLight: "#e09af7",
  pink:        "#FD165A",
  blue:        "#60a5fa",
  gold:        "#fbbf24",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  danger:      "#f87171",
  inputBg:     "rgba(15, 15, 30, 0.55)",
};

const BTN_GRADIENT = ["#FD165A", "#8938D5"] as const;
const ACTIVE_DAY_GRADIENT = ["#FD165A", "#8938D5"] as const;

type Coords = { latitude: number; longitude: number };

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function dateToMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToDate(m: number): Date {
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d;
}

/** First chunk of a Google place display name (street + city) for compact storage. */
function shortenPlace(displayName: string): string {
  const parts = displayName.split(",");
  return (parts[0] + (parts[1] ? " " + parts[1] : "")).trim();
}

/** Encode favorite routes into the Firestore field map used elsewhere in the app. */
function encodeFavoriteFields(favorites: FavoriteRoute[]): Record<string, unknown> {
  return {
    favorite: {
      arrayValue: {
        values: favorites.map((f) => ({
          mapValue: {
            fields: {
              destination: { stringValue: f.destination },
              destinationGeolocation: {
                geoPointValue: { latitude: f.destinationGeo.lat, longitude: f.destinationGeo.lon },
              },
            },
          },
        })),
      },
    },
  };
}

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { updateUserData } = useUserProfile();

  // ── Home address ──────────────────────────────────────────────────────────
  const [homeAddress, setHomeAddress] = useState("");
  const [homeCoords, setHomeCoords] = useState<Coords | null>(null);

  // ── Driver availability ─────────────────────────────────────────────────
  const [driverEnabled, setDriverEnabled] = useState(false);
  const [days, setDays] = useState<Set<WeekdayKey>>(new Set());
  const [startMin, setStartMin] = useState(7 * 60 + 30);
  const [endMin, setEndMin] = useState(9 * 60);
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const [driverDest, setDriverDest] = useState("");
  const [driverDestCoords, setDriverDestCoords] = useState<Coords | null>(null);

  // ── Favorite places ───────────────────────────────────────────────────────
  const [favorites, setFavorites] = useState<FavoriteRoute[]>([]);
  const [favInput, setFavInput] = useState("");
  const [favCoords, setFavCoords] = useState<Coords | null>(null);

  const [saving, setSaving] = useState(false);

  // ── Card / payment ────────────────────────────────────────────────────────
  const [cardAdded, setCardAdded] = useState(false);
  const [cardLast4, setCardLast4] = useState<string | null>(null);
  const [cardBrand, setCardBrand] = useState<string | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  const toggleDay = (key: WeekdayKey) =>
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const addFavorite = () => {
    if (!favInput.trim() || !favCoords) return;
    setFavorites((prev) => [
      ...prev,
      { destination: favInput.trim(), destinationGeo: { lat: favCoords.latitude, lon: favCoords.longitude } },
    ]);
    setFavInput("");
    setFavCoords(null);
  };

  const removeFavorite = (index: number) =>
    setFavorites((prev) => prev.filter((_, i) => i !== index));

  const handleAddCard = async () => {
    if (!user || cardLoading) return;
    setCardLoading(true);
    try {
      const token = await user.getIdToken();
      let setupData: { clientSecret: string; customerId: string; ephemeralKey: string };
      try {
        setupData = await setupPaymentMethod(token);
      } catch {
        await new Promise((r) => setTimeout(r, 1200));
        setupData = await setupPaymentMethod(await user.getIdToken());
      }
      const { clientSecret, customerId, ephemeralKey } = setupData;
      const { error: initError } = await initPaymentSheet({
        customerId,
        customerEphemeralKeySecret: ephemeralKey,
        setupIntentClientSecret: clientSecret,
        merchantDisplayName: "UniLift",
      });
      if (initError) {
        Alert.alert(t("wallet.paymentSetupError"), initError.message);
        return;
      }
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== "Canceled") Alert.alert(t("wallet.paymentFailed"), presentError.message);
        return;
      }
      const setupIntentId = clientSecret.split("_secret_")[0];
      const freshToken = await user.getIdToken();
      const { paymentMethod: pm } = await confirmPaymentMethod(freshToken, setupIntentId);
      setCardAdded(true);
      setCardLast4(pm.last4);
      setCardBrand(pm.brand);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : undefined;
      Alert.alert(t("wallet.unexpectedError"), msg ?? t("wallet.somethingWrong"));
    } finally {
      setCardLoading(false);
    }
  };

  const goHome = () => router.replace("/");

  const handleFinish = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};

      if (homeAddress.trim()) {
        fields.homeAddress = { stringValue: homeAddress.trim() };
        if (homeCoords) {
          fields.homeAddressCoords = {
            geoPointValue: { latitude: homeCoords.latitude, longitude: homeCoords.longitude },
          };
        }
      }

      let savedWindows: DriverAvailabilityWindow[] = [];
      if (driverEnabled && days.size > 0 && driverDest.trim() && driverDestCoords && endMin > startMin) {
        savedWindows = [
          {
            id: makeId(),
            days: WEEKDAY_KEYS.filter((k) => days.has(k)),
            startMinutes: startMin,
            endMinutes: endMin,
            destination: driverDest.trim(),
            destinationCoords: driverDestCoords,
          },
        ];
        Object.assign(fields, encodeDriverAvailabilityFields(savedWindows));
      }

      if (favorites.length > 0) {
        Object.assign(fields, encodeFavoriteFields(favorites));
      }

      if (Object.keys(fields).length > 0) {
        const token = await user.getIdToken();
        await patchUserField(token, user.uid, fields);

        const patch: Record<string, unknown> = {};
        if (homeAddress.trim()) {
          patch.homeAddress = homeAddress.trim();
          if (homeCoords) patch.homeAddressCoords = homeCoords;
        }
        if (savedWindows.length > 0) {
          patch.driverAvailability = savedWindows;
          patch.driverDays = Array.from(new Set(savedWindows.flatMap((w) => w.days)));
        }
        if (favorites.length > 0) patch.favorite = favorites;
        updateUserData(patch);
      }

      goHome();
    } catch (err) {
      console.warn("Onboarding save failed:", err);
      Alert.alert(t("onboarding.saveFailedTitle"), t("onboarding.saveFailedMsg"), [
        { text: t("common.ok"), onPress: goHome },
      ]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={styles.title}>{t("onboarding.title")}</Text>
        <Text style={styles.subtitle}>{t("onboarding.subtitle")}</Text>

        {/* ── Home address ──────────────────────────────────────────────── */}
        <View style={styles.labelRow}>
          <Ionicons name="home-outline" size={16} color={C.blue} />
          <Text style={styles.label}>{t("onboarding.homeLabel")}</Text>
        </View>
        <PlaceField
          value={homeAddress}
          placeholder={t("onboarding.homePlaceholder")}
          icon="location-outline"
          onChangeText={(text) => { setHomeAddress(text); setHomeCoords(null); }}
          onSelect={(item) => { setHomeAddress(shortenPlace(item.displayName)); setHomeCoords({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) }); }}
        />
        <Text style={styles.hint}>{t("onboarding.homeHint")}</Text>

        {/* ── Driver availability ───────────────────────────────────────── */}
        <View style={[styles.labelRow, { marginTop: 28 }]}>
          <Ionicons name="car-sport-outline" size={16} color={C.purpleLight} />
          <Text style={styles.label}>{t("onboarding.driverLabel")}</Text>
        </View>
        <Pressable
          onPress={() => setDriverEnabled((v) => !v)}
          style={[styles.toggleRow, driverEnabled && styles.toggleRowActive]}
        >
          <Text style={styles.toggleText}>{t("onboarding.driverToggle")}</Text>
          <View style={[styles.switch, driverEnabled && styles.switchOn]}>
            <View style={[styles.knob, driverEnabled && styles.knobOn]} />
          </View>
        </Pressable>

        {driverEnabled && (
          <View style={styles.driverPanel}>
            <Text style={styles.fieldLabel}>{t("onboarding.driverDaysLabel")}</Text>
            <View style={styles.daysRow}>
              {WEEKDAY_KEYS.map((key) => {
                const active = days.has(key);
                return (
                  <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => toggleDay(key)} style={styles.dayWrap}>
                    {active ? (
                      <LinearGradient colors={ACTIVE_DAY_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dayChipActive}>
                        <Text style={styles.dayTextActive}>{t(`driverMode.days.${key}`)}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.dayChip}>
                        <Text style={styles.dayText}>{t(`driverMode.days.${key}`)}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>{t("onboarding.driverTimeLabel")}</Text>
            <View style={styles.timeRow}>
              <TouchableOpacity style={styles.timeBtn} onPress={() => setPicker(picker === "start" ? null : "start")}>
                <Text style={styles.timeBtnLabel}>{t("onboarding.driverFrom")}</Text>
                <Text style={styles.timeBtnValue}>{minutesToLabel(startMin)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.timeBtn} onPress={() => setPicker(picker === "end" ? null : "end")}>
                <Text style={styles.timeBtnLabel}>{t("onboarding.driverTo")}</Text>
                <Text style={styles.timeBtnValue}>{minutesToLabel(endMin)}</Text>
              </TouchableOpacity>
            </View>
            {picker && (
              <DateTimePicker
                value={minutesToDate(picker === "start" ? startMin : endMin)}
                mode="time"
                is24Hour
                display={Platform.OS === "ios" ? "spinner" : "default"}
                themeVariant="dark"
                textColor="#ffffff"
                onChange={(event, selected) => {
                  if (Platform.OS === "android") setPicker(null);
                  if (event.type === "dismissed" || !selected) return;
                  const m = dateToMinutes(selected);
                  if (picker === "start") setStartMin(m); else setEndMin(m);
                }}
              />
            )}

            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>{t("onboarding.driverDestLabel")}</Text>
            <PlaceField
              value={driverDest}
              placeholder={t("onboarding.driverDestPlaceholder")}
              icon="flag-outline"
              onChangeText={(text) => { setDriverDest(text); setDriverDestCoords(null); }}
              onSelect={(item) => { setDriverDest(shortenPlace(item.displayName)); setDriverDestCoords({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) }); }}
            />
          </View>
        )}
        <Text style={styles.hint}>{t("onboarding.driverHint")}</Text>

        {/* ── Favorite places ───────────────────────────────────────────── */}
        <View style={[styles.labelRow, { marginTop: 28 }]}>
          <Ionicons name="star-outline" size={16} color={C.gold} />
          <Text style={styles.label}>{t("onboarding.favoritesLabel")}</Text>
        </View>

        {favorites.map((fav, i) => (
          <View key={`${fav.destination}-${i}`} style={styles.favCard}>
            <Ionicons name="star" size={15} color={C.gold} />
            <Text style={styles.favText} numberOfLines={1}>{fav.destination}</Text>
            <TouchableOpacity onPress={() => removeFavorite(i)} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.muted} />
            </TouchableOpacity>
          </View>
        ))}

        <PlaceField
          value={favInput}
          placeholder={t("onboarding.favoritesPlaceholder")}
          icon="star-outline"
          onChangeText={(text) => { setFavInput(text); setFavCoords(null); }}
          onSelect={(item) => { setFavInput(shortenPlace(item.displayName)); setFavCoords({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) }); }}
        />
        <TouchableOpacity
          onPress={addFavorite}
          disabled={!favInput.trim() || !favCoords}
          activeOpacity={0.8}
          style={[styles.addFavBtn, (!favInput.trim() || !favCoords) && { opacity: 0.4 }]}
        >
          <Ionicons name="add-circle-outline" size={18} color={C.purpleLight} />
          <Text style={styles.addFavText}>{t("onboarding.addFavorite")}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>{t("onboarding.favoritesHint")}</Text>

        {/* ── Payment card ──────────────────────────────────────────────── */}
        <View style={[styles.labelRow, { marginTop: 28 }]}>
          <Ionicons name="card-outline" size={16} color={C.purpleLight} />
          <Text style={styles.label}>{t("onboarding.cardLabel")}</Text>
        </View>
        {cardAdded ? (
          <View style={styles.cardAdded}>
            <Ionicons name="checkmark-circle" size={20} color="#34d399" />
            <Text style={styles.cardAddedText}>
              {cardBrand?.toUpperCase()} •••• {cardLast4}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={handleAddCard}
            disabled={cardLoading}
            activeOpacity={0.8}
            style={[styles.addCardBtn, cardLoading && { opacity: 0.6 }]}
          >
            {cardLoading ? (
              <ActivityIndicator color={C.purpleLight} size="small" />
            ) : (
              <Ionicons name="add-circle-outline" size={18} color={C.purpleLight} />
            )}
            <Text style={styles.addCardText}>{t("onboarding.addCard")}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.hint}>{t("onboarding.cardHint")}</Text>

        {/* ── Actions ───────────────────────────────────────────────────── */}
        <Pressable onPress={handleFinish} disabled={saving} style={{ marginTop: 34 }}>
          <LinearGradient colors={BTN_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.finishBtn, saving && { opacity: 0.7 }]}>
            {saving ? (
              <View style={styles.btnRow}>
                <ActivityIndicator color="#fff" />
                <Text style={[styles.finishBtnText, { marginLeft: 8 }]}>{t("onboarding.saving")}</Text>
              </View>
            ) : (
              <Text style={styles.finishBtnText}>{t("onboarding.finish")}</Text>
            )}
          </LinearGradient>
        </Pressable>

        <TouchableOpacity onPress={goHome} disabled={saving} style={styles.skipBtn} hitSlop={8}>
          <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Reusable place input with Google autocomplete suggestions ───────────────
function PlaceField({
  value,
  placeholder,
  icon,
  onChangeText,
  onSelect,
}: {
  value: string;
  placeholder: string;
  icon: keyof typeof Ionicons.glyphMap;
  onChangeText: (text: string) => void;
  onSelect: (item: LocationResult) => void;
}) {
  const [suggestions, setSuggestions] = useState<LocationResult[]>([]);
  const [show, setShow] = useState(false);
  const suppressRef = useRef(false);
  const debounced = useDebouncedValue(value, 400);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressRef.current) { suppressRef.current = false; return; }
      if (debounced.trim().length < 2) { setShow(false); return; }
      const results = await geoSuggestion(debounced.trim());
      if (cancelled) return;
      setSuggestions(results ?? []);
      setShow((results?.length ?? 0) > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debounced]);

  return (
    <View>
      <View style={styles.inputRow}>
        <Ionicons name={icon} size={18} color={C.muted} style={{ marginRight: 10 }} />
        <TextInput
          style={styles.textInput}
          placeholder={placeholder}
          placeholderTextColor={C.muted}
          value={value}
          onChangeText={(text) => { suppressRef.current = false; onChangeText(text); }}
        />
        {value.length > 0 && (
          <TouchableOpacity onPress={() => { suppressRef.current = true; onChangeText(""); setShow(false); }} hitSlop={6}>
            <Ionicons name="close-circle" size={18} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>
      {show && suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.slice(0, 5).map((item, i) => (
            <TouchableOpacity
              key={`${item.placeId ?? item.displayName}-${i}`}
              onPress={() => { suppressRef.current = true; onSelect(item); setShow(false); }}
              style={[styles.suggestionItem, i === Math.min(suggestions.length, 5) - 1 && { borderBottomWidth: 0 }]}
            >
              <Ionicons name="location-outline" size={14} color={C.purpleLight} style={{ marginRight: 10 }} />
              <Text style={styles.suggestionText} numberOfLines={1}>{item.displayName}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 22 },

  title: { color: C.text, fontSize: 26, fontWeight: "800", marginBottom: 8 },
  subtitle: { color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: 28 },

  labelRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  label: { color: C.text, fontSize: 15, fontWeight: "700" },
  fieldLabel: { color: C.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  hint: { color: C.dim, fontSize: 12, lineHeight: 16, marginTop: 8 },

  inputRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.inputBg, borderWidth: 1,
    borderColor: C.border, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14,
  },
  textInput: { flex: 1, color: C.text, fontSize: 15 },

  suggestions: {
    marginTop: 6, backgroundColor: "rgba(10,10,22,0.96)", borderRadius: 16, borderWidth: 1,
    borderColor: C.border, overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(137,56,213,0.12)",
  },
  suggestionText: { color: C.text, fontSize: 14, flex: 1 },

  // Driver toggle
  toggleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderFaint, borderRadius: 16,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  toggleRowActive: { borderColor: C.border, backgroundColor: C.surfaceAlt },
  toggleText: { color: C.text, fontSize: 15, fontWeight: "600", flex: 1, marginRight: 12 },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.1)", padding: 3, justifyContent: "center" },
  switchOn: { backgroundColor: C.purple },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: "flex-start" },
  knobOn: { alignSelf: "flex-end" },

  driverPanel: {
    backgroundColor: "rgba(137,56,213,0.06)", borderWidth: 1, borderColor: C.border,
    borderRadius: 18, padding: 16, marginTop: 12,
  },
  daysRow: { flexDirection: "row", justifyContent: "space-between" },
  dayWrap: { flex: 1, alignItems: "center" },
  dayChip: {
    width: 38, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderFaint,
  },
  dayChipActive: {
    width: 38, height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center",
    shadowColor: C.purple, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  dayText: { color: C.muted, fontSize: 12, fontWeight: "700" },
  dayTextActive: { color: "#fff", fontSize: 12, fontWeight: "800" },

  timeRow: { flexDirection: "row", gap: 12 },
  timeBtn: {
    flex: 1, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  timeBtnLabel: { color: C.muted, fontSize: 11, marginBottom: 2 },
  timeBtnValue: { color: C.text, fontSize: 18, fontWeight: "800" },

  // Favorites
  favCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8,
  },
  favText: { color: C.text, fontSize: 14, fontWeight: "600", flex: 1 },
  addFavBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(137,56,213,0.10)", borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingVertical: 13, marginTop: 8,
  },
  addFavText: { color: C.purpleLight, fontSize: 14, fontWeight: "700" },

  // Card
  cardAdded: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(52,211,153,0.08)", borderWidth: 1,
    borderColor: "rgba(52,211,153,0.25)", borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  cardAddedText: { color: "#34d399", fontSize: 15, fontWeight: "700" },
  addCardBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(137,56,213,0.10)", borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingVertical: 13, marginTop: 4,
  },
  addCardText: { color: C.purpleLight, fontSize: 14, fontWeight: "700" },

  // Actions
  finishBtn: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  finishBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnRow: { flexDirection: "row", alignItems: "center" },
  skipBtn: { alignItems: "center", paddingVertical: 16, marginTop: 4 },
  skipText: { color: C.muted, fontSize: 14, fontWeight: "600" },
});
