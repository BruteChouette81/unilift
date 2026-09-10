import { autoFormatDateInput, calculateAgeFromBirthDate, formatBirthDateForDisplay, parseBirthDateInput } from "@/components/userHelper";
import { apiBaseUrl, apiFetch, firestoreDocumentUrl, devError } from "@/constants/runtime-config";
import { formatPhoneForDisplay, parsePhoneInput } from "@/utils/phoneNumber";
import PhoneNumberCard from "@/components/phone/phone-number-card";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { signOutUser } from "@/services/authService";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
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
  View
} from "react-native";
import { P } from "@/constants/palette";

const C = {
  bg:          P.bg,
  surface:     P.surface,
  border:      "rgba(137, 56, 213, 0.22)",
  borderFaint: "rgba(255, 255, 255, 0.06)",
  purple:      P.accent,
  purpleLight: P.accentLight,
  text:        P.text,
  muted:       P.textMuted,
  dim:         P.textDim,
  inputBg:     "rgba(255, 255, 255, 0.05)",
  inputBorder: "rgba(137, 56, 213, 0.2)",
  inputFocus:  "rgba(137, 56, 213, 0.7)",
};

 const SCHOOLS = [
  // Québec City / Chaudière-Appalaches
  'Cégep de Sainte-Foy',
  'Cégep Garneau',
  'Cégep Champlain St-Lawrence',
  'Cégep de Limoilou',
  'Cégep de Lévis',
  'Université Laval',

  // Montréal
  'Cégep de Maisonneuve',
  'Cégep du Vieux Montréal',
  'Cégep André-Laurendeau',
  'Cégep Ahuntsic',
  'Cégep de Saint-Laurent',
  'Cégep Édouard-Montpetit',
  'Cégep de Rosemont',
  'Cégep de Bois-de-Boulogne',
  'Cégep Gérald-Godin',
  'Cégep John Abbott',
  'Dawson College',
  'Vanier College',
  'Marianopolis College',
  'Collège LaSalle',
  'Collège de Maisonneuve',
  'Université de Montréal',
  'Polytechnique Montréal',
  'HEC Montréal',
  'Université du Québec à Montréal',
  'McGill University',
  'Concordia University',

  // Sherbrooke
  'Cégep de Sherbrooke',
  'Séminaire de Sherbrooke',
  'Université de Sherbrooke',

  // Trois-Rivières
  'Cégep de Trois-Rivières',
  'Collège Laflèche',
  'Université du Québec à Trois-Rivières',

  // Saguenay–Lac-Saint-Jean
  'Cégep de Chicoutimi',
  'Cégep de Jonquière',
  'Cégep de Saint-Félicien',
  'Université du Québec à Chicoutimi',

  // Rimouski / Bas-Saint-Laurent
  'Cégep de Rimouski',
  'Cégep de La Pocatière',
  'Cégep de Rivière-du-Loup',
  'Université du Québec à Rimouski',

  // Outaouais
  'Cégep de l’Outaouais',
  'Heritage College',
  'Université du Québec en Outaouais',

  // Abitibi-Témiscamingue
  'Cégep de l’Abitibi-Témiscamingue',
  'Université du Québec en Abitibi-Témiscamingue',

  // Côte-Nord
  'Cégep de Baie-Comeau',
  'Cégep de Sept-Îles',

  // Gaspésie / Îles-de-la-Madeleine
  'Cégep de la Gaspésie et des Îles',

  // Lanaudière
  'Cégep régional de Lanaudière à Joliette',
  'Cégep régional de Lanaudière à L’Assomption',
  'Cégep régional de Lanaudière à Terrebonne',

  // Laurentides
  'Cégep de Saint-Jérôme',

  // Montérégie
  'Cégep de Saint-Hyacinthe',
  'Cégep de Granby',
  'Cégep de Sorel-Tracy',
  'Cégep de Valleyfield',
  'Cégep Édouard-Montpetit',
  'Cégep de Saint-Jean-sur-Richelieu',
  'Cégep de Drummondville',

  // Centre-du-Québec
  'Cégep de Drummondville',
  'Cégep de Victoriaville',

  // Estrie
  'Cégep de Sherbrooke',
  'Collège Champlain – Lennoxville',

  // Universities – Québec
  'Université du Québec',
  'Université du Québec à Chicoutimi',
  'Université du Québec à Montréal',
  'Université du Québec à Rimouski',
  'Université du Québec à Trois-Rivières',
  'Université du Québec en Abitibi-Témiscamingue',
  'Université du Québec en Outaouais',
];



export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { userData, updateUserData } = useUserProfile();
  const params = useLocalSearchParams<{
    name: string;
    birthDate: string;
    school: string;
    prefs: string;
    phone: string;
  }>();

  const [name, setName]           = useState(params.name ?? "");
  const [birthDate, setBirthDate] = useState(formatBirthDateForDisplay(params.birthDate ?? ""));
  const [school, setSchool]       = useState(params.school ?? "");
  const [phone, setPhone]         = useState(formatPhoneForDisplay(params.phone ?? ""));
  // Controlled mode: this screen owns the tick box and writes `phoneConsent`
  // with the rest of the form, so the permission and the number it covers land
  // in the same PATCH.
  const [phoneConsent, setPhoneConsent] = useState(userData?.phoneConsent ?? false);
  const [showSchoolDropdown, setShowSchoolDropdown] = useState(false);
  const preferences = params.prefs ? params.prefs.split(",").filter(Boolean) : [];

  const [nameFocused,       setNameFocused]       = useState(false);
  const [birthDateFocused,  setBirthDateFocused]  = useState(false);
  const [schoolFocused,     setSchoolFocused]      = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filteredSchools = useMemo(() => {
    if (!school.trim()) return SCHOOLS;
    const lower = school.toLowerCase();
    return SCHOOLS.filter(s => s.toLowerCase().includes(lower));
  }, [school]);

  const handleSave = async () => {
    if (!user || saving) return;
    try {
      setSaving(true);
      const token = await user.getIdToken(true);

      const parsedBirthDate = parseBirthDateInput(birthDate);

      const maskFields = ["name", "school", "preferences"];
      const fields: Record<string, unknown> = {
        name:   { stringValue: name.trim() },
        school: { stringValue: school.trim() },
        preferences: {
          arrayValue: {
            values: preferences.map((p: string) => ({ stringValue: p })),
          },
        },
      };

      if (parsedBirthDate) {
        maskFields.push("birthDate");
        fields.birthDate = { stringValue: parsedBirthDate };
      }

      // Blank means "leave it alone", not "erase it" — same as birthDate above.
      // A non-blank value that will not parse is a typo worth stopping on:
      // saving it silently would leave a driver calling a dead number.
      const trimmedPhone = phone.trim();
      const parsedPhone = parsePhoneInput(trimmedPhone);
      if (trimmedPhone && !parsedPhone) {
        setSaving(false);
        Alert.alert(t("profileSettings.phoneLabel"), t("profileSettings.phoneInvalid"));
        return;
      }
      // A number without the tick is not ours to keep: the card says so above
      // the field, so saving one anyway would make that line a lie.
      if (parsedPhone && !phoneConsent) {
        setSaving(false);
        Alert.alert(t("profileSettings.phoneLabel"), t("phoneCard.consentRequired"));
        return;
      }
      if (parsedPhone) {
        maskFields.push("phone", "phoneConsent");
        fields.phone = { stringValue: parsedPhone };
        fields.phoneConsent = { booleanValue: true };
      } else if (!phoneConsent && userData?.phone) {
        // Consent withdrawn on a number already on file. Clearing the field
        // normally means "leave it alone", so the deletion has to be driven by
        // the tick box instead — otherwise the digits would survive the
        // permission that justified storing them.
        maskFields.push("phone", "phoneConsent");
        fields.phone = { stringValue: "" };
        fields.phoneConsent = { booleanValue: false };
      }

      const maskQuery = maskFields
        .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
        .join("&");

      const res = await fetch(
        `${firestoreDocumentUrl("users", user.uid)}?${maskQuery}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ fields }),
        },
      );

      if (!res.ok) {
        const errText = await res.text();
        devError("[profileSettings] Firestore PATCH failed:", res.status, errText);
        throw new Error(errText);
      }

      // Update the in-memory cache so the profile screen reflects changes immediately.
      const patch: Record<string, unknown> = { name: name.trim(), school: school.trim() };
      if (parsedPhone) { patch.phone = parsedPhone; patch.phoneConsent = true; }
      else if (!phoneConsent && userData?.phone) { patch.phone = undefined; patch.phoneConsent = false; }
      if (parsedBirthDate) {
        patch.birthDate = parsedBirthDate;
        patch.age = calculateAgeFromBirthDate(parsedBirthDate);
      }
      updateUserData(patch);

      router.back();
    } catch (err) {
      devError("[profileSettings] handleSave error:", err);
      Alert.alert(t("profileSettings.saveFailed"), t("profileSettings.saveFailedMsg"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t("profileSettings.deleteConfirm1Title"),
      t("profileSettings.deleteConfirm1Msg"),
      [
        { text: t("profileSettings.deleteConfirm1Keep"), style: "cancel" },
        {
          text: t("profileSettings.deleteConfirm1Continue"),
          style: "destructive",
          onPress: () => {
            Alert.alert(
              t("profileSettings.deleteConfirm2Title"),
              t("profileSettings.deleteConfirm2Msg"),
              [
                { text: t("profileSettings.deleteConfirm2Cancel"), style: "cancel" },
                {
                  text: t("profileSettings.deleteConfirm2Confirm"),
                  style: "destructive",
                  onPress: confirmDelete,
                },
              ],
            );
          },
        },
      ],
    );
  };

  const confirmDelete = async () => {
    if (!user || deleting) return;
    try {
      setDeleting(true);
      const token = await user.getIdToken();
      const res = await apiFetch(`${apiBaseUrl}/account/delete`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unknown error");
      }
      await signOutUser();
    } catch {
      Alert.alert(
        t("profileSettings.deleteErrorTitle"),
        t("profileSettings.deleteErrorMsg"),
      );
    } finally {
      setDeleting(false);
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
          <View style={styles.backBtnGrad}>
            <Ionicons name="arrow-back" size={18} color="#2d0015" />
          </View>
        </Pressable>
        <Text style={styles.headerTitle}>{t("profile.settings.myProfile")}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Name */}
        <Text style={styles.label}>{t("profileSettings.nameLabel")}</Text>
        <View style={[styles.inputRow, nameFocused && styles.inputRowFocused]}>
          <Ionicons name="person-outline" size={16} color={C.muted} style={styles.inputIcon} />
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder={t("profileSettings.namePlaceholder")}
            placeholderTextColor={C.muted}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
          />
        </View>

        {/* Birth Date */}
        <Text style={styles.label}>{t("profileSettings.birthDateLabel")}</Text>
        <View style={[styles.inputRow, birthDateFocused && styles.inputRowFocused]}>
          <Ionicons name="calendar-outline" size={16} color={C.muted} style={styles.inputIcon} />
          <TextInput
            style={styles.textInput}
            value={birthDate}
            onChangeText={(v) => setBirthDate(autoFormatDateInput(v))}
            placeholder={t("profileSettings.birthDatePlaceholder")}
            placeholderTextColor={C.muted}
            keyboardType="number-pad"
            maxLength={10}
            onFocus={() => setBirthDateFocused(true)}
            onBlur={() => setBirthDateFocused(false)}
          />
        </View>

        {/* Phone — the only field on this screen another person ever sees, and
            only the driver of a ride you are currently on. Rendered by the
            shared card so the scope is explained the same way here as on the
            profile tab. Controlled mode: this screen keeps batching every field
            into the one masked PATCH below, so the card has no Save of its own. */}
        <View style={styles.phoneCardSlot}>
          <PhoneNumberCard
            value={phone}
            onChangeText={setPhone}
            consent={phoneConsent}
            onConsentChange={(next) => {
              setPhoneConsent(next);
              // Untick and the field empties with it: leaving digits in a box
              // nobody is allowed to store reads as a number still on file.
              if (!next) setPhone("");
            }}
          />
        </View>

        {/* School */}
        <Text style={styles.label}>{t("profileSettings.schoolLabel")}</Text>
        <View style={[styles.inputRow, schoolFocused && styles.inputRowFocused]}>
          <Ionicons name="school-outline" size={16} color={C.muted} style={styles.inputIcon} />
          <TextInput
            style={styles.textInput}
            value={school}
            onChangeText={setSchool}
            placeholder={t("profileSettings.schoolPlaceholder")}
            placeholderTextColor={C.muted}
            onFocus={() => {
              setSchoolFocused(true);
              setShowSchoolDropdown(true);
            }}
            onBlur={() => {
              setSchoolFocused(false);
              setShowSchoolDropdown(false);
            }}
          />
        </View>
        {showSchoolDropdown && filteredSchools.length > 0 && (
          <View style={styles.dropdown}>
            {filteredSchools.map((s, idx) => (
              <Pressable
                key={idx}
                onPress={() => {
                  setSchool(s);
                  setShowSchoolDropdown(false);
                }}
                style={({ pressed }) => [styles.dropdownItem, pressed && styles.dropdownItemPressed]}
              >
                <Text style={styles.dropdownItemText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Preferences — Coming Soon */}
        <Text style={styles.label}>{t("profileSettings.prefsLabel")}</Text>
        <View style={styles.comingSoonBox}>
          <Ionicons name="construct-outline" size={18} color={C.purpleLight} />
          <View style={{ flex: 1 }}>
            <Text style={styles.comingSoonTitle}>{t("profileSettings.comingSoonTitle")}</Text>
            <Text style={styles.comingSoonSub}>{t("profileSettings.comingSoonSub")}</Text>
          </View>
        </View>

        {/* Save */}
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, { marginTop: 32 }, saving && { opacity: 0.7 }]}
        >
          {saving ? (
            <View style={styles.saveBtnContent}>
              <ActivityIndicator color="#2d0015" size="small" />
              <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>{t("profileSettings.saving")}</Text>
            </View>
          ) : (
            <Text style={styles.saveBtnText}>{t("profileSettings.saveChanges")}</Text>
          )}
        </Pressable>

        {/* Danger Zone */}
        <View style={styles.dangerZone}>
          <View style={styles.dangerZoneHeader}>
            <Ionicons name="warning-outline" size={15} color="#ef4444" />
            <Text style={styles.dangerZoneLabel}>{t("profileSettings.dangerZone")}</Text>
          </View>
          <Pressable
            onPress={handleDeleteAccount}
            disabled={deleting}
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.75 }]}
          >
            {deleting ? (
              <ActivityIndicator color="#ef4444" size="small" />
            ) : (
              <Ionicons name="trash-outline" size={16} color="#ef4444" />
            )}
            <Text style={styles.deleteBtnText}>
              {deleting ? t("profileSettings.deleting") : t("profileSettings.deleteAccount")}
            </Text>
          </Pressable>
        </View>

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
  // The phone card is a card, not a field: it supplies its own border and
  // padding, so the slot only has to reproduce the 18pt gap the input rows use.
  phoneCardSlot: { marginTop: -4, marginBottom: 18 },
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
  comingSoonBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(137, 56, 213, 0.06)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(137, 56, 213, 0.2)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 4,
  },
  comingSoonTitle: {
    color: "#e09af7",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  comingSoonSub: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 17,
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
  dangerZone: {
    marginTop: 40,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)",
    borderRadius: 14,
    overflow: "hidden",
  },
  dangerZoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(239, 68, 68, 0.07)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(239, 68, 68, 0.15)",
  },
  dangerZoneLabel: {
    color: "#ef4444",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    paddingHorizontal: 16,
    backgroundColor: "rgba(239, 68, 68, 0.06)",
  },
  deleteBtnText: {
    color: "#ef4444",
    fontSize: 15,
    fontWeight: "600",
  },
  dropdown: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.inputFocus,
    borderRadius: 12,
    marginBottom: 18,
    marginTop: -14,
    paddingVertical: 8,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.borderFaint,
  },
  dropdownItemPressed: {
    backgroundColor: "rgba(137, 56, 213, 0.1)",
  },
  dropdownItemText: {
    color: C.text,
    fontSize: 15,
  },
});
