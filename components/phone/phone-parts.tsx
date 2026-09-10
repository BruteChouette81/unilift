/**
 * The shared visual vocabulary for phone numbers.
 *
 * A number shows up in three places — the profile tab, the passenger's waiting
 * card, and the driver's stop card — and before this file each of them drew it
 * differently, so nothing read as one feature. The parts here are the whole
 * design: an inset readout that treats the digits as display type, a policy
 * panel that expands to say who can see them, and the consent line that lets
 * someone grant — or take back — permission to store the number at all.
 *
 * ## Why this doesn't look like the rest of the app
 *
 * Every other card in UniLift is a purple-bordered gradient with a purple glow.
 * These wear `P.signal` — an electric cyan reserved for contact and used
 * nowhere else in the app — over a cyan-black ground, with a cyan bloom where
 * the neighbours bloom purple. On the profile tab that bloom is what identifies
 * the card from across the screen, before a single word is read.
 *
 * The restraint is in what stays uncoloured. The digits are plain white on the
 * darkest panel in the app: cyan numerals on a cyan-tinted card would flatten
 * the thing into one glowing blob. The card is the object; the number is the
 * content; only one of them gets to shout.
 */
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { formatPhoneForDisplay } from "@/utils/phoneNumber";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

/** Tokens for every phone surface. Referenced, not copied, by the two cards. */
export const PHONE_C = {
  /** Cyan-black. Reads as near-black beside the neutral cards, but the hue is
   *  there and the eye finds it. */
  cardBg:     "#04161B",
  /** Deeper than P.bg, and colder. Nothing else in the app goes darker than its
   *  container, which is what makes the readout a separate object. */
  readoutBg:  "#010A0D",
  signal:     P.signal,
  edge:       P.signal,
  border:     "rgba(45, 226, 240, 0.34)",
  hairline:   "rgba(45, 226, 240, 0.16)",
  /** The bloom. Purple everywhere else on the profile tab, cyan here. */
  glow:       P.signal,
  tint:       "rgba(45, 226, 240, 0.12)",
  tintStrong: "rgba(45, 226, 240, 0.20)",
  /** Dark ink for text sitting on a filled cyan surface. */
  onSignal:   "#012026",
  digits:     P.text,
  ghost:      "rgba(148, 175, 182, 0.55)",
  label:      "rgba(178, 233, 240, 0.75)",
  muted:      P.textMuted,
  danger:     P.danger,
} as const;

/** The luminous left bar. Absolutely positioned so it bleeds to both corners. */
export function PhoneEdge() {
  return <View style={styles.edge} pointerEvents="none" />;
}

type ReadoutProps = {
  /** E.164, or null to draw the ghost mask instead. */
  phone: string | null;
  /** The mask shown when there is no number — an invitation, not a blank. */
  ghost: string;
  /** Button, badge, or nothing. Sits at the right of the panel. */
  trailing?: React.ReactNode;
  compact?: boolean;
};

/**
 * The number, set as display type on the darkest panel in the app.
 *
 * Tabular figures matter more than they look: without them the digits reflow as
 * you type and the field jitters under the cursor.
 */
export function PhoneReadout({ phone, ghost, trailing, compact }: ReadoutProps) {
  return (
    <View style={[styles.readout, compact && styles.readoutCompact]}>
      <Text
        style={[
          styles.digits,
          compact && styles.digitsCompact,
          !phone && styles.digitsGhost,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        maxFontSizeMultiplier={FONT_CAP.display}
      >
        {phone ? formatPhoneForDisplay(phone) : ghost}
      </Text>
      {trailing}
    </View>
  );
}

type PolicyProps = {
  /** The card's own field label, drawn at the left of the header row. */
  fieldLabel: string;
  /** What the toggle reveals, named as such: "Number policy". */
  pillLabel: string;
  /** Heading of the open panel. Omitted by the driver-side variant, whose one
   *  paragraph is its own headline. */
  title?: string;
  body: string;
  points?: string[];
  /** Rendered under the points — the consent line, on the cards that ask for it. */
  footer?: React.ReactNode;
};

/**
 * The field label, the toggle that opens the policy, and the policy itself.
 *
 * It owns the header row rather than sitting inside one, because the panel has
 * to be a sibling of that row: nested in it, the paragraph became a third
 * column squeezed beside the label and the pill, which is what made the copy
 * unreadable before.
 *
 * It expands inline rather than into a modal (the `InfoButton` pattern used
 * elsewhere) on purpose: this is consent copy about the field directly below
 * it, and a popup you dismiss is a worse place for that than a paragraph that
 * stays put. Conditional render rather than an animated height, so there is no
 * motion to opt out of.
 */
export function PhonePolicy({
  fieldLabel, pillLabel, title, body, points, footer,
}: PolicyProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.fieldLabel} maxFontSizeMultiplier={FONT_CAP.chrome}>
          {fieldLabel}
        </Text>

        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={pillLabel}
          style={({ pressed }) => [
            styles.eyePill,
            open && styles.eyePillOpen,
            pressed && styles.eyePillPressed,
          ]}
        >
          <Ionicons
            name={open ? "shield-checkmark" : "shield-checkmark-outline"}
            size={13}
            color={PHONE_C.signal}
          />
          <Text style={styles.eyeText} maxFontSizeMultiplier={FONT_CAP.chrome} numberOfLines={1}>
            {pillLabel}
          </Text>
          {/* The affordance: a closed pill has to say it opens into something. */}
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={12}
            color={PHONE_C.signal}
          />
        </Pressable>
      </View>

      {open && (
        <View style={styles.disclosure}>
          {title ? (
            <Text style={styles.disclosureTitle} maxFontSizeMultiplier={FONT_CAP.body}>
              {title}
            </Text>
          ) : null}
          <Text style={styles.disclosureBody} maxFontSizeMultiplier={FONT_CAP.body}>
            {body}
          </Text>
          {points?.length ? (
            <View style={styles.pointList}>
              {points.map((point) => (
                <View key={point} style={styles.pointRow}>
                  <View style={styles.pointDot} />
                  <Text style={styles.pointText} maxFontSizeMultiplier={FONT_CAP.body}>
                    {point}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {footer}
        </View>
      )}
    </>
  );
}

type ConsentCheckProps = {
  checked: boolean;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
};

/**
 * The permission itself: one box, one sentence, no small print.
 *
 * It is deliberately outside the collapsed policy panel on the editing cards —
 * a consent you have to go looking for is not a consent — and the ticked state
 * is coloured, so "I agreed to this" is legible from across the card.
 */
export function ConsentCheck({ checked, label, onToggle, disabled }: ConsentCheckProps) {
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.consentRow,
        checked && styles.consentRowOn,
        pressed && !disabled && styles.consentRowPressed,
      ]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked && <Ionicons name="checkmark" size={12} color={PHONE_C.onSignal} />}
      </View>
      <Text
        style={[styles.consentText, checked && styles.consentTextOn]}
        maxFontSizeMultiplier={FONT_CAP.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: PHONE_C.edge,
    shadowColor: PHONE_C.glow,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 1, height: 0 },
  },

  readout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: PHONE_C.readoutBg,
    borderWidth: 1,
    borderColor: "rgba(45, 226, 240, 0.18)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readoutCompact: { paddingVertical: 10, paddingHorizontal: 12 },
  digits: {
    flex: 1,
    color: PHONE_C.digits,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 1.5,
    fontVariant: ["tabular-nums"],
  },
  digitsCompact: { fontSize: 19, letterSpacing: 1 },
  digitsGhost: { color: PHONE_C.ghost, fontWeight: "600" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },
  // Sentence case, deliberately — the tracked-caps label used elsewhere in the
  // app is the thing these cards are trying not to look like.
  fieldLabel: { color: PHONE_C.label, fontSize: 13, fontWeight: "600", flexShrink: 1 },

  eyePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: PHONE_C.tint,
    borderWidth: 1,
    borderColor: "rgba(45, 226, 240, 0.38)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexShrink: 1,
  },
  eyePillOpen: { backgroundColor: PHONE_C.tintStrong },
  eyePillPressed: { opacity: 0.6 },
  eyeText: { color: PHONE_C.signal, fontSize: 11.5, fontWeight: "700", flexShrink: 1 },

  // The panel is a quiet inset block, not free-floating text: the old version
  // was a 12.5pt paragraph wedged into the header row, and every complaint
  // about it was really a complaint about line length and leading.
  disclosure: {
    marginBottom: 14,
    padding: 13,
    borderRadius: 13,
    backgroundColor: "rgba(45, 226, 240, 0.05)",
    borderWidth: 1,
    borderColor: PHONE_C.hairline,
  },
  disclosureTitle: {
    color: PHONE_C.label,
    fontSize: 12.5,
    fontWeight: "700",
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  disclosureBody: { color: PHONE_C.muted, fontSize: 13, lineHeight: 20 },
  pointList: { marginTop: 11, gap: 9 },
  pointRow: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  pointDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: PHONE_C.signal,
    marginTop: 8,
  },
  pointText: { flex: 1, color: PHONE_C.muted, fontSize: 13, lineHeight: 20 },

  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginTop: 12,
    padding: 11,
    borderRadius: 12,
    backgroundColor: "rgba(45, 226, 240, 0.04)",
    borderWidth: 1,
    borderColor: PHONE_C.hairline,
  },
  consentRowOn: {
    backgroundColor: PHONE_C.tint,
    borderColor: "rgba(45, 226, 240, 0.34)",
  },
  consentRowPressed: { opacity: 0.7 },
  box: {
    width: 19,
    height: 19,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(45, 226, 240, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  boxOn: { backgroundColor: PHONE_C.signal, borderColor: PHONE_C.signal },
  consentText: { flex: 1, color: PHONE_C.muted, fontSize: 12.5, lineHeight: 18 },
  consentTextOn: { color: PHONE_C.label },
});
