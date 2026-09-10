import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ScrollView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import RouteProgress from "@/components/route-progress";
import CertificationSlide from "@/components/whats-new/slides/certification-slide";
import FeeSlide from "@/components/whats-new/slides/fee-slide";
import IntroSlide from "@/components/whats-new/slides/intro-slide";
import MatchingSlide from "@/components/whats-new/slides/matching-slide";
import RidesSlide from "@/components/whats-new/slides/rides-slide";
import { MARK_GRADIENT_STOPS } from "@/constants/brand-mark";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { WHATS_NEW_SLIDES, WHATS_NEW_VERSION } from "@/constants/whats-new";
import { useLanguage } from "@/context/LanguageContext";

const COUNT = WHATS_NEW_SLIDES.length;
const LAST = COUNT - 1;

/** The page transition over which the screen inverts: the ramp floods in, the
 *  route strip retires, and the button flips to dark-on-bright. */
const FLIP: [number, number] = [LAST - 1, LAST];

const RAMP = MARK_GRADIENT_STOPS.map((s) => s.color) as unknown as readonly [
  string,
  string,
  string,
];

const INK = "#2d0015";
const CTA_DARK = "#1c0038";

type Props = {
  /** Called when the user finishes or skips. Persist the seen flag here. */
  onDone: () => void;
};

/**
 * The release takeover: five slides, driven by the finger, ending on the fee.
 *
 * Presented by `app/_layout.tsx` as a sibling overlay rather than a route. It
 * deliberately owns no navigation — `onDone` is the only way out — so it cannot
 * perturb the stack underneath it (see the `findingDriverScreen` note in the
 * layout about screens inheriting a modal container).
 */
export default function WhatsNewScreen({ onDone }: Props) {
  const { t } = useLanguage();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Reanimated 4 types `Animated.ScrollView`'s instance as `never`; the ref is
  // forwarded to the underlying RN ScrollView, which is what `scrollTo` lives on.
  const scrollRef = useRef<ScrollView>(null);
  const progress = useSharedValue(0);
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  // Measured rather than derived: the pages need a definite height because
  // `flex: 1` inside a horizontal ScrollView grows along the wrong axis.
  const [pageHeight, setPageHeight] = useState(0);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => mounted && setReduceMotion(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) =>
      setReduceMotion(on),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const onScroll = useAnimatedScrollHandler((e) => {
    progress.value = e.contentOffset.x / Math.max(width, 1);
  });

  const onSettled = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
      if (next === index) return;
      // Arriving at the fee slide is the payoff, so it gets the heavier tap.
      const feedback =
        next === LAST
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          : Haptics.selectionAsync();
      feedback.catch(() => {});
      setIndex(next);
    },
    [width, index],
  );

  const advance = useCallback(() => {
    if (index >= LAST) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
  }, [index, width, onDone]);

  // The ramp arrives with the last slide rather than being painted behind it,
  // so crossing into the finale reads as the whole screen changing.
  const floodStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, FLIP, [0, 1], Extrapolation.CLAMP),
  }));

  // The route has arrived; there is nowhere further to go.
  const stripStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, FLIP, [1, 0], Extrapolation.CLAMP),
  }));

  const skipStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, FLIP, [1, 0], Extrapolation.CLAMP),
  }));

  const ctaStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, FLIP, [P.accentLight, CTA_DARK]),
  }));
  const ctaTextStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, FLIP, [INK, P.text]),
  }));

  const slideProps = {
    reduceMotion,
    width,
    height: pageHeight,
    // Safe area plus room for the skip button. Applied by the pages themselves —
    // see the note on SlideFrame's `topInset`.
    topInset: insets.top + 56,
  };
  const onLast = index === LAST;

  return (
    <View style={[styles.root, { height }]} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, floodStyle]} pointerEvents="none">
        <LinearGradient
          colors={RAMP}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onSettled}
        onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}
      >
        <IntroSlide
          {...slideProps}
          active={index === 0}
          eyebrow={t("whatsNew.intro.eyebrow", { version: WHATS_NEW_VERSION })}
          title={t("whatsNew.intro.title")}
          body={t("whatsNew.intro.body")}
        />
        <RidesSlide
          {...slideProps}
          active={index === 1}
          eyebrow={t("whatsNew.rides.eyebrow")}
          title={t("whatsNew.rides.title")}
          body={t("whatsNew.rides.body")}
        />
        <MatchingSlide
          {...slideProps}
          active={index === 2}
          eyebrow={t("whatsNew.matching.eyebrow")}
          title={t("whatsNew.matching.title")}
          body={t("whatsNew.matching.body")}
        />
        <CertificationSlide
          {...slideProps}
          active={index === 3}
          eyebrow={t("whatsNew.certification.eyebrow")}
          title={t("whatsNew.certification.title")}
          body={t("whatsNew.certification.body")}
          adultLabel={t("whatsNew.certification.badgeAdult")}
          studentLabel={t("whatsNew.certification.badgeStudent")}
        />
        <FeeSlide
          {...slideProps}
          active={onLast}
          eyebrow={t("whatsNew.fee.eyebrow")}
          title={t("whatsNew.fee.title")}
          body={t("whatsNew.fee.body")}
          footnote={t("whatsNew.fee.footnote")}
        />
      </Animated.ScrollView>

      <Animated.View
        style={[styles.skipWrap, { top: insets.top + 8 }, skipStyle]}
        pointerEvents={onLast ? "none" : "auto"}
      >
        <Pressable onPress={onDone} hitSlop={12} accessibilityRole="button">
          <Text style={styles.skip} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {t("wizard.skip")}
          </Text>
        </Pressable>
      </Animated.View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Animated.View style={stripStyle} pointerEvents="none">
          <RouteProgress progress={progress} count={COUNT} width={width - 60} />
        </Animated.View>

        <Pressable
          onPress={advance}
          accessibilityRole="button"
          style={({ pressed }) => [styles.ctaHit, pressed && styles.ctaPressed]}
        >
          <Animated.View style={[styles.cta, ctaStyle]}>
            <Animated.Text
              style={[styles.ctaText, ctaTextStyle]}
              maxFontSizeMultiplier={FONT_CAP.action}
            >
              {onLast ? t("whatsNew.fee.cta") : t("wizard.next")}
            </Animated.Text>
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: P.bg,
    zIndex: 1000,
  },
  scroll: { flex: 1 },
  skipWrap: { position: "absolute", right: 22 },
  skip: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: P.textMuted,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  footer: { paddingHorizontal: 30, gap: 10 },
  ctaHit: { alignSelf: "stretch" },
  ctaPressed: { opacity: 0.85 },
  cta: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
});
