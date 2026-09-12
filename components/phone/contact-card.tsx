/**
 * The driver's view of a passenger's number: the same readout, plus a way to use it.
 *
 * This is display only. The number arrives from `POST /rides/passenger-contact`,
 * which re-checks on every call that the caller is this ride's driver and that
 * the passenger has not been dropped off — so this component is handed either a
 * number or `null` and never decides anything about access itself. Keep it that
 * way: caching or deriving the number here would outlive the permission that
 * produced it.
 *
 * The eye here explains a boundary rather than asking for consent — the driver
 * is looking at someone else's number, and the honest thing to tell them is how
 * long they get to keep it.
 */
import { useLanguage } from "@/context/LanguageContext";
import { FONT_CAP } from "@/constants/typography";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PHONE_C as C, PhoneEdge, PhonePolicy, PhoneReadout } from "./phone-parts";

type Props = {
  /** E.164, or null when nothing was shared / access has ended. */
  phone: string | null;
  /** The passenger's first name, when known — the boundary copy is clearer with it. */
  name?: string | null;
  onCall: () => void;
  onText: () => void;
  /** True at large text sizes, where Call and Text cannot honestly stay a row. */
  stacked?: boolean;
};

export default function ContactCard({ phone, name, onCall, onText, stacked }: Props) {
  const { t } = useLanguage();

  // No number is an ordinary outcome, not a failure: the passenger declined, or
  // the drop-off already happened. Say what the driver should do instead.
  if (!phone) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="call-outline" size={14} color={C.ghost} />
        <Text style={styles.emptyText} maxFontSizeMultiplier={FONT_CAP.body}>
          {t("driverRide.noPhoneShared")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <PhoneEdge />

      <PhonePolicy
        fieldLabel={t("phoneCard.label")}
        pillLabel={t("phoneCard.boundaryLabel")}
        body={
          name
            ? t("phoneCard.boundaryBody", { name })
            : t("phoneCard.boundaryBodyGeneric")
        }
      />

      <PhoneReadout phone={phone} ghost={t("phoneCard.ghostMask")} compact />

      <View style={[styles.actions, stacked && styles.actionsStacked]}>
        <Pressable
          onPress={onCall}
          accessibilityRole="button"
          style={({ pressed }) => [styles.callBtn, stacked && styles.btnStacked, pressed && styles.pressed]}
        >
          <Ionicons name="call" size={14} color={C.onSignal} />
          <Text style={styles.callBtnText} maxFontSizeMultiplier={FONT_CAP.action}>
            {t("driverRide.callPassenger")}
          </Text>
        </Pressable>

        <Pressable
          onPress={onText}
          accessibilityRole="button"
          style={({ pressed }) => [styles.textBtn, stacked && styles.btnStacked, pressed && styles.pressed]}
        >
          <Ionicons name="chatbubble" size={13} color={C.signal} />
          <Text style={styles.textBtnText} maxFontSizeMultiplier={FONT_CAP.action}>
            {t("driverRide.textPassenger")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.cardBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    paddingVertical: 13,
    paddingLeft: 15,
    paddingRight: 13,
    marginTop: 10,
    overflow: "hidden",
    shadowColor: C.glow,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 7,
  },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  actionsStacked: { flexDirection: "column" },
  btnStacked: { flex: 0, alignSelf: "stretch" },

  // Call and Text used to be an equal-weight green button beside a blue one.
  // On a cyan card that read as three unrelated colours, so they became one
  // hue with a hierarchy instead: filled is the thing a driver outside the
  // wrong door actually reaches for, outlined is the quieter alternative.
  callBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.signal,
  },
  callBtnText: { color: C.onSignal, fontSize: 13, fontWeight: "800" },

  textBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(45, 226, 240, 0.45)",
  },
  textBtnText: { color: C.signal, fontSize: 13, fontWeight: "800" },

  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
  },
  emptyText: { flex: 1, color: C.ghost, fontSize: 12, fontStyle: "italic" },

  pressed: { opacity: 0.65 },
});
