/**
 * The phone-number card: enter your own number, and see who gets it.
 *
 * Lives in three places, which is the point — the profile tab, profile
 * settings, and the passenger's waiting card all render this rather than each
 * drawing their own field. Design vocabulary comes from `phone-parts.tsx`.
 *
 * ## Two ownership modes
 *
 * `onCommit` — the card owns the value and saves it itself (profile tab, ride
 * screen). Tapping Save writes to Firestore and the card returns to its resting
 * state, or stays open showing an error if the write failed.
 *
 * `value` + `onChangeText` — the parent owns the value (profile settings, which
 * batches phone, name, school and birth date into one masked PATCH). The card
 * is then a permanently-open field with no Save button of its own, because the
 * screen already has one.
 *
 * Passing neither is a programming error; passing both means `onCommit` wins.
 *
 * ## Consent
 *
 * Storing the number is gated on an explicit tick, because the number is shared
 * with other users — the policy panel above the field says with whom, and for
 * how long. Self-saving mode keeps the tick as a draft and writes it with the
 * number; controlled mode hands it to the parent (`consent` / `onConsentChange`)
 * so it rides along with that screen's own PATCH. Un-ticking a granted consent
 * calls `onRevoke`, which deletes the number: a permission we can no longer
 * honour must not leave the digits behind.
 */
import { useLanguage } from "@/context/LanguageContext";
import { FONT_CAP } from "@/constants/typography";
import {
  autoFormatPhoneInput,
  formatPhoneForDisplay,
  parsePhoneInput,
} from "@/utils/phoneNumber";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ConsentCheck, PHONE_C as C, PhoneEdge, PhonePolicy, PhoneReadout } from "./phone-parts";

type Props = {
  /** The stored number in E.164, or null. Ignored in controlled mode. */
  phone?: string | null;
  /** Tighter padding for the passenger's waiting card. */
  compact?: boolean;
  /** Self-saving mode. Resolve false to keep the editor open on failure —
   *  the same contract as `PhoneShareSheet.onSave`. */
  onCommit?: (e164: string) => Promise<boolean>;
  /** Controlled mode: the display-formatted value the parent holds. */
  value?: string;
  /** Controlled mode: receives the display-formatted value as it is typed. */
  onChangeText?: (formatted: string) => void;
  /** Whether the user has granted permission to store and share the number.
   *  Self-saving mode seeds the tick box with it; controlled mode treats it as
   *  the live value. */
  consent?: boolean;
  /** Controlled mode: the parent owns the tick box and writes `phoneConsent`
   *  with the rest of its form. */
  onConsentChange?: (next: boolean) => void;
  /** Self-saving mode: withdrawing consent. Should delete the stored number —
   *  a permission we can no longer honour is not a permission — and resolve
   *  false to leave the box ticked if the write failed. */
  onRevoke?: () => Promise<boolean>;
};

export default function PhoneNumberCard({
  phone = null,
  compact,
  onCommit,
  value,
  onChangeText,
  consent = false,
  onConsentChange,
  onRevoke,
}: Props) {
  const { t } = useLanguage();
  const controlled = !onCommit && onChangeText !== undefined;

  // Only used in self-saving mode. In controlled mode the parent's `value` is
  // the single source of truth and the field is always open.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Self-saving mode only: the tick box is a draft until Save writes it with
  // the number, so backing out of the editor cannot silently grant permission.
  const [consentDraft, setConsentDraft] = useState(consent);
  const [consentError, setConsentError] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const granted = controlled ? consent : (editing ? consentDraft : consent);

  const openEditor = () => {
    setDraft(phone ? formatPhoneForDisplay(phone) : "");
    setError(false);
    setConsentError(false);
    setConsentDraft(consent);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(false);
    setConsentError(false);
    setDraft("");
  };

  const submit = async () => {
    if (saving || !onCommit) return;
    const e164 = parsePhoneInput(draft);
    if (!e164) { setError(true); return; }
    // Permission before storage, not after: without the tick there is nothing
    // authorising us to keep the number, so the write never leaves the device.
    if (!consentDraft) { setConsentError(true); return; }
    setSaving(true);
    const ok = await onCommit(e164);
    setSaving(false);
    if (ok) { setEditing(false); setDraft(""); }
    else setError(true);
  };

  /**
   * Withdrawing consent on a number already on file.
   *
   * Confirmed first, because it deletes the number rather than merely flagging
   * it: leaving the digits in Firestore while the box says "no" would make the
   * tick box a decoration, and the driver-side lookup knows nothing about it.
   */
  const confirmRevoke = () => {
    if (revoking || !onRevoke) return;
    Alert.alert(
      t("phoneCard.revokeTitle"),
      t("phoneCard.revokeBody"),
      [
        { text: t("phoneCard.cancel"), style: "cancel" },
        {
          text: t("phoneCard.revokeConfirm"),
          style: "destructive",
          onPress: () => {
            setRevoking(true);
            void onRevoke().finally(() => setRevoking(false));
          },
        },
      ],
    );
  };

  const toggleConsent = () => {
    if (controlled) { onConsentChange?.(!consent); return; }
    if (editing) {
      setConsentDraft((v) => !v);
      setConsentError(false);
      return;
    }
    // Resting state: ticked means there is a number to withdraw; unticked means
    // the fastest way to grant permission is to go add one.
    if (granted && phone) confirmRevoke();
    else openEditor();
  };

  const fieldValue = controlled ? (value ?? "") : draft;
  const showField = controlled || editing;

  /**
   * Opening the editor has to focus the field, and `autoFocus` cannot do it.
   *
   * The editor mounts inside the tap that opened it, so `autoFocus` raises the
   * keyboard while that gesture is still being handled — and a ScrollView with
   * the default `keyboardShouldPersistTaps="never"` answers the end of that
   * gesture by dismissing the keyboard again. The result is a field that takes
   * focus and loses it in the same frame. Focusing on the next frame instead
   * puts it after the gesture is finished. (The call sites also set
   * `keyboardShouldPersistTaps="handled"`, which is what stops later taps —
   * on the consent box, on the policy pill — from closing it mid-edit.)
   *
   * Controlled mode never steals focus: the field is permanently open there,
   * and grabbing the keyboard on arrival would fight the screen's other inputs.
   */
  useEffect(() => {
    if (controlled || !editing) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    // Second attempt on a timer. The frame above lands correctly on a quiet
    // screen, but this one mounts while the ScrollView is also re-laying out
    // for the keyboard inset, and a focus issued mid-layout can be dropped.
    // Focusing something already focused is a no-op, so the retry is free.
    const retry = setTimeout(() => inputRef.current?.focus(), 140);
    return () => { cancelAnimationFrame(frame); clearTimeout(retry); };
  }, [controlled, editing]);

  const header = (
    <PhonePolicy
      fieldLabel={t("phoneCard.label")}
      pillLabel={t("phoneCard.policyLabel")}
      title={t("phoneCard.policyTitle")}
      body={t("phoneCard.disclosureBody")}
      points={[
        t("phoneCard.disclosurePoint1"),
        t("phoneCard.disclosurePoint2"),
        t("phoneCard.disclosurePoint3"),
      ]}
    />
  );

  // Shown whenever there is something to consent to: an open editor, the
  // always-open controlled field, or a number already on file. It stays outside
  // the collapsible policy so the box is never something you have to find.
  const showConsent = showField || !!phone;

  const consentBlock = showConsent ? (
    <>
      <ConsentCheck
        checked={granted}
        label={t("phoneCard.consentLabel")}
        onToggle={toggleConsent}
        disabled={saving || revoking}
      />
      {consentError && (
        <Text style={styles.errorText} maxFontSizeMultiplier={FONT_CAP.chrome}>
          {t("phoneCard.consentRequired")}
        </Text>
      )}
    </>
  ) : null;

  const field = (
    <>
      {/* Pressable, not View: the digits do not fill the row, so a tap landing
          in the padding beside them used to hit nothing at all. That is the tap
          someone makes when the keyboard failed to open by itself, so it is the
          one that has to work. */}
      <Pressable
        onPress={() => inputRef.current?.focus()}
        accessible={false}
        style={[
          styles.inputRow,
          compact && styles.inputRowCompact,
          focused && styles.inputRowFocused,
          error && styles.inputRowError,
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[styles.input, compact && styles.inputCompact]}
          value={fieldValue}
          onChangeText={(raw) => {
            const formatted = autoFormatPhoneInput(raw);
            setError(false);
            if (controlled) onChangeText?.(formatted);
            else setDraft(formatted);
          }}
          placeholder={t("phoneCard.ghostMask")}
          placeholderTextColor={C.ghost}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={14}
          returnKeyType="done"
          onSubmitEditing={() => { if (!controlled) void submit(); }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!saving}
        />
      </Pressable>

      {error && (
        <Text style={styles.errorText} maxFontSizeMultiplier={FONT_CAP.chrome}>
          {t("phoneCard.invalid")}
        </Text>
      )}
    </>
  );

  // Save is drawn dimmed rather than removed while the box is unticked: a
  // button that vanishes explains nothing, and tapping it is what surfaces the
  // "tick the box" line under the consent row.
  const actions = !controlled && editing ? (
    <View style={styles.editActions}>
      <Pressable
        onPress={cancel}
        disabled={saving}
        style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
        accessibilityRole="button"
      >
        <Text style={styles.ghostBtnText} maxFontSizeMultiplier={FONT_CAP.action}>
          {t("phoneCard.cancel")}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => void submit()}
        disabled={saving}
        accessibilityRole="button"
        accessibilityState={{ disabled: !consentDraft }}
        style={({ pressed }) => [
          styles.saveBtn,
          !consentDraft && styles.saveBtnMuted,
          pressed && styles.pressed,
        ]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={C.onSignal} />
        ) : (
          <Text style={styles.saveBtnText} maxFontSizeMultiplier={FONT_CAP.action}>
            {t("phoneCard.save")}
          </Text>
        )}
      </Pressable>
    </View>
  ) : null;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {/* The edge bar is the profile card's signature. Nested inside the
          waiting card it is one accessory too many — the hairline and the dark
          readout already separate this section from the message above it. */}
      {!compact && <PhoneEdge />}
      {header}

      {showField ? field : (
        <PhoneReadout
          phone={phone}
          ghost={t("phoneCard.ghostMask")}
          compact={compact}
          trailing={
            <Pressable
              onPress={openEditor}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={phone ? t("phoneCard.editCta") : t("phoneCard.addCta")}
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            >
              <Ionicons
                name={phone ? "create-outline" : "add"}
                size={14}
                color={C.signal}
              />
              <Text style={styles.editBtnText} maxFontSizeMultiplier={FONT_CAP.chrome}>
                {phone ? t("phoneCard.editCta") : t("phoneCard.addCta")}
              </Text>
            </Pressable>
          }
        />
      )}

      {consentBlock}
      {actions}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.cardBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingVertical: 16,
    paddingLeft: 17,
    paddingRight: 14,
    marginTop: 10,
    overflow: "hidden",
    // The neighbours on the profile tab bloom purple or green. This one blooms
    // cyan, which is what picks it out of the stack at a glance.
    shadowColor: C.glow,
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 9,
  },
  // Inside the passenger's waiting card this is a *section*, not a nested card:
  // its own border and fill would read as a card-in-a-card against the green
  // panel it sits on. The dark readout keeps carrying the identity, and a
  // hairline detaches it from the message above.
  cardCompact: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
    borderRadius: 0,
    marginTop: 8,
    paddingTop: 13,
    paddingBottom: 2,
    paddingLeft: 11,
    paddingRight: 0,
    shadowOpacity: 0,
    elevation: 0,
  },

  inputRow: {
    backgroundColor: C.readoutBg,
    borderWidth: 1,
    borderColor: "rgba(45, 226, 240, 0.18)",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  inputRowCompact: { paddingVertical: 9 },
  inputRowFocused: {
    borderColor: C.signal,
    shadowColor: C.glow,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  inputRowError: { borderColor: "rgba(248,113,113,0.7)" },
  input: {
    color: C.digits,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontVariant: ["tabular-nums"],
    padding: 0,
  },
  inputCompact: { fontSize: 19, letterSpacing: 1 },
  errorText: { color: C.danger, fontSize: 12, marginTop: 7 },

  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: C.tint,
    borderWidth: 1,
    borderColor: "rgba(45, 226, 240, 0.34)",
  },
  editBtnText: { color: C.signal, fontSize: 12, fontWeight: "700" },

  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  ghostBtnText: { color: C.muted, fontSize: 13.5, fontWeight: "600" },
  saveBtn: {
    minWidth: 92,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.signal,
  },
  saveBtnMuted: { opacity: 0.45 },
  saveBtnText: { color: C.onSignal, fontSize: 13.5, fontWeight: "800" },
  pressed: { opacity: 0.65 },
});
