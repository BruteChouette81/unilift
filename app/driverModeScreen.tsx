import InfoButton from "@/components/info-button";
import { encodeDriverAvailabilityFields, patchUserField } from "@/components/userHelper";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useSearchHistory } from "@/hooks/use-search-history";
import { geoSuggestion } from "@/services/rideServices";
import { WEEKDAY_KEYS, type DriverAvailabilityWindow, type WeekdayKey } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import Slider from "@react-native-community/slider";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
  success:     "#34d399",
  danger:      "#f87171",
  inputBg:     "rgba(15, 15, 30, 0.55)",
};

type SuggestionKind = "geo" | "home" | "favorite" | "history";
type Suggestion = { displayName: string; lat: string; lon: string; kind: SuggestionKind };

function suggestionIcon(kind: SuggestionKind): { name: "home-outline" | "star" | "time-outline" | "location-outline"; color: string } {
  switch (kind) {
    case "home":     return { name: "home-outline",     color: C.blue };
    case "favorite": return { name: "star",             color: C.gold };
    case "history":  return { name: "time-outline",     color: C.muted };
    default:         return { name: "location-outline", color: C.purpleLight };
  }
}

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

export default function DriverModeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { user } = useAuth();
  const { userData, updateUserData } = useUserProfile();

  const [windows, setWindows] = useState<DriverAvailabilityWindow[]>(
    userData?.driverAvailability ?? [],
  );
  const [matchRadius, setMatchRadius] = useState(userData?.driverDestinationRadiusKm ?? 10);
  const [saving, setSaving] = useState(false);

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const openNew = () => { setEditingId(null); setEditorOpen(true); };
  const openEdit = (id: string) => { setEditingId(id); setEditorOpen(true); };

  const saveWindows = async (next: DriverAvailabilityWindow[], radius: number) => {
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const fields: Record<string, unknown> = {
        ...encodeDriverAvailabilityFields(next),
        driverDestinationRadiusKm: { integerValue: String(radius) },
      };
      await patchUserField(token, user.uid, fields);
      updateUserData({
        driverAvailability: next,
        driverDays: Array.from(new Set(next.flatMap((w) => w.days))),
        driverDestinationRadiusKm: radius,
      });
    } finally {
      setSaving(false);
    }
  };

  const upsertWindow = async (w: DriverAvailabilityWindow) => {
    const prev = windows;
    const idx = prev.findIndex((x) => x.id === w.id);
    const next = idx === -1 ? [...prev, w] : prev.map((x, i) => (i === idx ? w : x));
    setWindows(next);
    setEditorOpen(false);
    try {
      await saveWindows(next, matchRadius);
    } catch {
      setWindows(prev);
      Alert.alert(t("driverMode.saveFailedTitle"), t("driverMode.saveFailedMsg"));
    }
  };

  const removeWindow = async (id: string) => {
    if (!user || saving) return;
    const prev = windows;
    const next = prev.filter((w) => w.id !== id);
    setWindows(next);
    try {
      await saveWindows(next, matchRadius);
    } catch {
      setWindows(prev);
      Alert.alert(t("driverMode.saveFailedTitle"), t("driverMode.saveFailedMsg"));
    }
  };

  const editing = editingId ? windows.find((w) => w.id === editingId) ?? null : null;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <View style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#2d0015" />
          </View>
        </Pressable>
        <Text style={styles.headerTitle}>{t("driverMode.title")}</Text>
        <View style={{ width: 38, alignItems: "center", justifyContent: "center" }}>
          {saving && <ActivityIndicator size="small" color={C.purpleLight} />}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <LinearGradient colors={["#1c0b2a", "#0d0518"]} style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="car-sport" size={26} color={C.purpleLight} />
          </View>
          <Text style={styles.heroTitle}>{t("driverMode.heroTitle")}</Text>
          <Text style={styles.heroSub}>{t("driverMode.heroSub")}</Text>
        </LinearGradient>

        {/* Availability windows */}
        <View style={styles.labelRow}>
          <Text style={styles.label}>{t("driverMode.windowsLabel")}</Text>
          <InfoButton title={t("driverMode.info.days.title")} body={t("driverMode.info.days.body")} />
        </View>

        {windows.length === 0 ? (
          <Text style={styles.helperText}>{t("driverMode.noWindows")}</Text>
        ) : (
          windows.map((w) => (
            <View key={w.id} style={styles.windowCard}>
              <View style={{ flex: 1 }}>
                <View style={styles.windowTopRow}>
                  <Ionicons name="flag-outline" size={15} color={C.purpleLight} />
                  <Text style={styles.windowDest} numberOfLines={1}>{w.destination}</Text>
                </View>
                <View style={styles.windowMetaRow}>
                  <View style={styles.windowChip}>
                    <Ionicons name="time-outline" size={12} color={C.muted} />
                    <Text style={styles.windowChipText}>
                      {minutesToLabel(w.startMinutes)}–{minutesToLabel(w.endMinutes)}
                    </Text>
                  </View>
                  <Text style={styles.windowDays}>
                    {w.days.map((d) => t(`driverMode.days.${d}`)).join(" · ")}
                  </Text>
                </View>
              </View>
              <View style={styles.windowActions}>
                <TouchableOpacity onPress={() => openEdit(w.id)} hitSlop={6} style={styles.windowIconBtn}>
                  <Ionicons name="create-outline" size={18} color={C.purpleLight} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeWindow(w.id)} hitSlop={6} style={styles.windowIconBtn}>
                  <Ionicons name="trash-outline" size={18} color={C.danger} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity onPress={openNew} style={styles.addWindowBtn} activeOpacity={0.8}>
          <Ionicons name="add-circle-outline" size={18} color={C.purpleLight} />
          <Text style={styles.addWindowText}>{t("driverMode.addWindow")}</Text>
        </TouchableOpacity>

        {windows.length > 0 && (
          <Text style={styles.helperText}>{t("driverMode.windowsSummary", { count: windows.length })}</Text>
        )}

        {/* Destination match radius */}
        <View style={[styles.labelRow, { marginTop: 26 }]}>
          <Text style={styles.label}>{t("createRide.matchRadius")}</Text>
          <InfoButton title={t("createRide.info.matchRadius.title")} body={t("createRide.info.matchRadius.body")} />
        </View>
        <View style={styles.detourCard}>
          <View style={styles.detourValueRow}>
            <Ionicons name="locate-outline" size={18} color={C.purpleLight} />
            <Text style={styles.detourValue}>{matchRadius} {t("createRide.matchRadiusUnit")}</Text>
          </View>
          <Slider
            style={{ width: "100%", height: 36, marginTop: 6 }}
            minimumValue={1} maximumValue={30} step={1} value={matchRadius}
            onValueChange={setMatchRadius}
            onSlidingComplete={(v) => { void saveWindows(windows, v); }}
            minimumTrackTintColor={C.purple} maximumTrackTintColor={C.dim} thumbTintColor={C.purpleLight}
          />
          <Text style={styles.helperText}>{t("createRide.matchRadiusSub")}</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <WindowEditor
          initial={editing}
          insetsBottom={insets.bottom}
          onCancel={() => setEditorOpen(false)}
          onSave={upsertWindow}
        />
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Window editor (bottom sheet) ───────────────────────────────────────────
function WindowEditor({
  initial,
  insetsBottom,
  onCancel,
  onSave,
}: {
  initial: DriverAvailabilityWindow | null;
  insetsBottom: number;
  onCancel: () => void;
  onSave: (w: DriverAvailabilityWindow) => void;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { userData } = useUserProfile();
  const { history: searchHistory, addToHistory } = useSearchHistory(user?.uid);

  const [days, setDays] = useState<Set<WeekdayKey>>(new Set(initial?.days ?? []));
  const [startMin, setStartMin] = useState(initial?.startMinutes ?? 7 * 60 + 30);
  const [endMin, setEndMin] = useState(initial?.endMinutes ?? 9 * 60);
  const [destination, setDestination] = useState(initial?.destination ?? "");
  const [destCoords, setDestCoords] = useState<{ lat: number; lng: number } | undefined>(
    initial?.destinationCoords
      ? { lat: initial.destinationCoords.latitude, lng: initial.destinationCoords.longitude }
      : undefined,
  );
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  const suppressRef = useRef(false);
  const debouncedDest = useDebouncedValue(destination, 400);
  const favorites = userData?.favorite ?? [];

  const toggleDay = (key: WeekdayKey) => {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const onDestChange = (text: string) => {
    suppressRef.current = false;
    setDestination(text);
    setDestCoords(undefined);
    setShowSuggestions(false);
  };

  const onSelectSuggestion = (item: Suggestion) => {
    suppressRef.current = true;
    const parts = item.displayName.split(",");
    setDestination((parts[0] + (parts[1] ? " " + parts[1] : "")).trim());
    setDestCoords({ lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
    setShowSuggestions(false);
    if (item.kind === "geo" || item.kind === "favorite" || item.kind === "history") {
      addToHistory({ displayName: item.displayName, lat: item.lat, lon: item.lon });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (suppressRef.current) { suppressRef.current = false; return; }
      const q = debouncedDest.trim().toLowerCase();
      const local: Suggestion[] = [];
      if (q.length > 0) {
        if (userData?.homeAddress && (q.includes("home") || q.includes("maison") || userData.homeAddress.toLowerCase().includes(q))) {
          const coords = userData.homeAddressCoords ?? (userData.localisation.latitude && userData.localisation.longitude
            ? { latitude: userData.localisation.latitude, longitude: userData.localisation.longitude } : null);
          if (coords) local.push({ displayName: userData.homeAddress, lat: String(coords.latitude), lon: String(coords.longitude), kind: "home" });
        }
        for (const fav of favorites) {
          if (fav.destination.toLowerCase().includes(q)) {
            local.push({ displayName: fav.destination, lat: String(fav.destinationGeo.lat), lon: String(fav.destinationGeo.lon), kind: "favorite" });
          }
        }
      }
      if (q.length === 0) {
        const hist = searchHistory.map((h) => ({ displayName: h.displayName, lat: h.lat, lon: h.lon, kind: "history" as const }));
        setSuggestions(hist);
        setShowSuggestions(hist.length > 0);
        return;
      }
      if (local.length > 0) { setSuggestions(local); setShowSuggestions(true); }
      if (q.length < 2) return;
      const results = await geoSuggestion(debouncedDest.trim());
      if (cancelled) return;
      const geo: Suggestion[] = (results ?? []).map((r) => ({ displayName: r.displayName, lat: r.lat, lon: r.lon, kind: "geo" as const }));
      const combined = [...local, ...geo];
      setSuggestions(combined);
      setShowSuggestions(combined.length > 0);
    };
    void run();
    return () => { cancelled = true; };
  }, [debouncedDest, searchHistory, favorites, userData]);

  const handleSave = () => {
    if (days.size === 0) { Alert.alert(t("driverMode.title"), t("driverMode.windowDaysRequired")); return; }
    if (!destination || !destCoords) { Alert.alert(t("driverMode.title"), t("driverMode.windowDestRequired")); return; }
    if (endMin <= startMin) { Alert.alert(t("driverMode.title"), t("driverMode.windowTimeInvalid")); return; }
    onSave({
      id: initial?.id ?? makeId(),
      days: WEEKDAY_KEYS.filter((k) => days.has(k)),
      startMinutes: startMin,
      endMinutes: endMin,
      destination,
      destinationCoords: { latitude: destCoords.lat, longitude: destCoords.lng },
    });
  };

  return (
    <View style={ed.overlay}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
      <View style={{ width: "100%", marginBottom: keyboardHeight }}>
        <View style={[ed.sheet, { paddingBottom: Math.max(insetsBottom, 16) + 16 }]}>
          <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={ed.blur}>
            <View style={ed.dragZone}><View style={ed.handle} /></View>
            <Text style={ed.title}>{initial ? t("driverMode.editWindow") : t("driverMode.newWindow")}</Text>

            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {/* Days */}
              <Text style={ed.fieldLabel}>{t("driverMode.windowDaysLabel")}</Text>
              <View style={styles.daysRow}>
                {WEEKDAY_KEYS.map((key) => {
                  const active = days.has(key);
                  return (
                    <TouchableOpacity key={key} activeOpacity={0.8} onPress={() => toggleDay(key)} style={styles.dayWrap}>
                      {active ? (
                        <View style={styles.dayChipActive}>
                          <Text style={styles.dayTextActive}>{t(`driverMode.days.${key}`)}</Text>
                        </View>
                      ) : (
                        <View style={styles.dayChip}>
                          <Text style={styles.dayText}>{t(`driverMode.days.${key}`)}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Time window */}
              <Text style={[ed.fieldLabel, { marginTop: 20 }]}>{t("driverMode.windowTimeLabel")}</Text>
              <View style={ed.timeRow}>
                <TouchableOpacity style={ed.timeBtn} onPress={() => setPicker(picker === "start" ? null : "start")}>
                  <Text style={ed.timeBtnLabel}>{t("driverMode.windowFrom")}</Text>
                  <Text style={ed.timeBtnValue}>{minutesToLabel(startMin)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={ed.timeBtn} onPress={() => setPicker(picker === "end" ? null : "end")}>
                  <Text style={ed.timeBtnLabel}>{t("driverMode.windowTo")}</Text>
                  <Text style={ed.timeBtnValue}>{minutesToLabel(endMin)}</Text>
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

              {/* Destination */}
              <Text style={[ed.fieldLabel, { marginTop: 20 }]}>{t("driverMode.windowDestLabel")}</Text>
              <View style={styles.inputRow}>
                <Ionicons name="flag-outline" size={18} color={C.muted} style={{ marginRight: 10 }} />
                <TextInput
                  style={styles.textInput}
                  placeholder={t("driverMode.windowDestPlaceholder")}
                  placeholderTextColor={C.muted}
                  value={destination}
                  onChangeText={onDestChange}
                />
                {destination.length > 0 && (
                  <TouchableOpacity onPress={() => { setDestination(""); setDestCoords(undefined); setShowSuggestions(false); }}>
                    <Ionicons name="close-circle" size={18} color={C.muted} />
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>

            {/* Suggestions sit outside the scroll so they stay visible above the keyboard */}
            {showSuggestions && suggestions.length > 0 && (
              <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={[styles.suggestions, { marginTop: 6, maxHeight: 180 }]}>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  {suggestions.map((item, i) => {
                    const icon = suggestionIcon(item.kind);
                    return (
                      <TouchableOpacity key={`${item.kind}-${i}`} onPress={() => onSelectSuggestion(item)}
                        style={[styles.suggestionItem, i === suggestions.length - 1 && { borderBottomWidth: 0 }]}>
                        <Ionicons name={icon.name} size={14} color={icon.color} style={{ marginRight: 10 }} />
                        <Text style={styles.suggestionText} numberOfLines={1}>{item.displayName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </BlurView>
            )}

            <Pressable onPress={handleSave} style={[{ marginTop: 18 }, styles.saveBtn]}>
              <Text style={styles.saveBtnText}>{initial ? t("driverMode.windowSaveBtn") : t("driverMode.windowDoneBtn")}</Text>
            </Pressable>
          </BlurView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 56 : 20, paddingBottom: 14,
    backgroundColor: "rgba(8,8,16,0.97)", borderBottomWidth: 1, borderBottomColor: "rgba(137,56,213,0.20)",
  },
  backBtn: { borderRadius: 10, overflow: "hidden" },
  backBtnGrad: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.purpleLight },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: "700" },

  scroll: { padding: 20, paddingTop: 20 },

  hero: {
    borderRadius: 20, padding: 20, alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: C.border, marginBottom: 26,
  },
  heroIconWrap: {
    width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(137,56,213,0.15)", borderWidth: 1, borderColor: C.border, marginBottom: 4,
  },
  heroTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  heroSub: { color: C.muted, fontSize: 13, textAlign: "center", lineHeight: 18, paddingHorizontal: 8 },

  labelRow: { flexDirection: "row", alignItems: "center" },
  label: { color: C.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },

  daysRow: { flexDirection: "row", justifyContent: "space-between" },
  dayWrap: { flex: 1, alignItems: "center" },
  dayChip: {
    width: 40, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderFaint,
  },
  dayChipActive: {
    width: 40, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center",
    backgroundColor: C.purpleLight,
    shadowColor: C.purple, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 5,
  },
  dayText: { color: C.muted, fontSize: 12, fontWeight: "700" },
  dayTextActive: { color: "#2d0015", fontSize: 12, fontWeight: "800" },

  helperText: { color: C.dim, fontSize: 12, marginTop: 8, lineHeight: 16 },

  // Window cards
  windowCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, borderRadius: 16,
    padding: 14, marginBottom: 10,
  },
  windowTopRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  windowDest: { color: C.text, fontSize: 15, fontWeight: "700", flex: 1 },
  windowMetaRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  windowChip: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(137,56,213,0.12)",
    borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  windowChipText: { color: C.purpleLight, fontSize: 12, fontWeight: "700" },
  windowDays: { color: C.muted, fontSize: 12, fontWeight: "600" },
  windowActions: { flexDirection: "row", gap: 4 },
  windowIconBtn: {
    width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: C.borderFaint,
  },

  addWindowBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "rgba(137,56,213,0.10)", borderWidth: 1, borderColor: C.border,
    borderRadius: 14, paddingVertical: 14, marginTop: 4,
  },
  addWindowText: { color: C.purpleLight, fontSize: 14, fontWeight: "700" },

  inputRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.inputBg, borderWidth: 1,
    borderColor: C.border, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14,
  },
  textInput: { flex: 1, color: C.text, fontSize: 15 },
  suggestions: {
    marginTop: 6, backgroundColor: "rgba(10,10,22,0.88)", borderRadius: 18, borderWidth: 1,
    borderColor: C.border, overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: "rgba(137,56,213,0.12)",
  },
  suggestionText: { color: C.text, fontSize: 14, flex: 1 },

  detourCard: {
    backgroundColor: "rgba(137,56,213,0.06)", borderWidth: 1, borderColor: C.border, borderRadius: 20, padding: 18,
  },
  detourValueRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detourValue: { color: C.text, fontSize: 20, fontWeight: "800" },

  saveBtn: { height: 54, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: C.purpleLight },
  saveBtnText: { color: "#2d0015", fontWeight: "700", fontSize: 16 },
});

const ed = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden",
    borderWidth: 1, borderBottomWidth: 0, borderColor: C.border,
  },
  blur: { paddingHorizontal: 22 },
  dragZone: { width: "100%", alignItems: "center", paddingVertical: 14 },
  handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: "rgba(137,56,213,0.45)" },
  title: { color: C.text, fontSize: 18, fontWeight: "800", marginBottom: 16 },
  fieldLabel: { color: C.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  timeRow: { flexDirection: "row", gap: 12 },
  timeBtn: {
    flex: 1, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  timeBtnLabel: { color: C.muted, fontSize: 11, marginBottom: 2 },
  timeBtnValue: { color: C.text, fontSize: 18, fontWeight: "800" },
});
