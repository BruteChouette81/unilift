import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native";
import Animated, {
  useAnimatedScrollHandler,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import LanguageToggle from "@/components/language-toggle";
import RouteProgress from "@/components/route-progress";
import { type StepPageProps } from "@/components/flow/step-frame";
import { P } from "@/constants/palette";
import { FONT_CAP } from "@/constants/typography";
import { useLanguage } from "@/context/LanguageContext";

export type FlowShellHandle = {
  /** Move to a page. Queues if the page is not rendered yet — see `unlocked`. */
  goTo: (index: number) => void;
};

type Props = {
  /** Total stops on the route. Fixed for the life of the flow. */
  count: number;
  /**
   * Builds every page, given the geometry they all need.
   *
   * Returns the whole array rather than one page at a time: the pages are
   * plain element literals, so building them all once per render is cheaper
   * than rebuilding the list once per visible page. The shell renders only as
   * many as `unlocked` allows.
   */
  renderPages: (page: StepPageProps) => React.ReactNode[];

  index: number;
  onIndexChange: (index: number) => void;

  /**
   * Highest page the user has earned. Pages beyond it are not rendered, so the
   * ScrollView's own content size is the wall — there is no scroll position to
   * fight and no gesture to cancel.
   *
   * Omit it when every page is reachable from the start, which is the right
   * answer for a flow where nothing is required.
   */
  unlocked?: number;

  primaryLabel: string;
  onPrimary: () => void;
  /** Disables the button and freezes the pager. */
  busy?: boolean;
  busyLabel?: string;

  /** Sits under the button — a skip link, a step count, a sign-in link. */
  sub?: React.ReactNode;
};

/**
 * The shell both guided flows are built on: a paged question sequence with a
 * fixed footer.
 *
 * ## Why the footer is not inside the pager
 *
 * It is the only thing that has to move when the keyboard opens. Keeping the
 * button and the progress strip out of the pages means the keyboard never
 * resizes every page mid-animation, which is what made the naive
 * `KeyboardAvoidingView` version visibly squash.
 *
 * ## Why this is one component and not two copies
 *
 * Signup and onboarding want the same behaviour down to the haptic on page
 * settle. The pager logic has several traps that are invisible until they bite
 * — the scroll that silently no-ops because the page it targets does not exist
 * yet, the back handler reading a stale index, the layout pass that fires
 * during the keyboard animation — and each one only needs fixing here.
 */
function FlowShell(
  {
    count,
    renderPages,
    index,
    onIndexChange,
    unlocked,
    primaryLabel,
    onPrimary,
    busy,
    busyLabel,
    sub,
  }: Props,
  ref: React.Ref<FlowShellHandle>,
) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  // Reanimated 4 types `Animated.ScrollView`'s instance as `never`; the ref is
  // forwarded to the underlying RN ScrollView, which owns `scrollTo`.
  const scrollRef = useRef<ScrollView>(null);
  const progress = useSharedValue(0);

  const [pageHeight, setPageHeight] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const open = unlocked ?? count - 1;
  const last = count - 1;

  const indexRef = useRef(index);
  const openRef = useRef(open);
  const busyRef = useRef(Boolean(busy));

  useEffect(() => {
    indexRef.current = index;
    openRef.current = open;
    busyRef.current = Boolean(busy);
  }, [index, open, busy]);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  // Measured rather than handed to KeyboardAvoidingView: with edge-to-edge on
  // Android the window is not resized by the IME, so `behavior="height"` is
  // unreliable there. `endCoordinates.height` is right on both platforms.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  // ── Movement ─────────────────────────────────────────────────────────────
  const scrollHandler = useAnimatedScrollHandler((e) => {
    progress.value = e.contentOffset.x / Math.max(width, 1);
  });

  const scrollToIndex = useCallback(
    (next: number) => {
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
    },
    [width],
  );

  // A scroll aimed at a page that has not been rendered yet is silently clamped
  // — at that instant the content is still only as wide as the pages that
  // exist. So the request is parked and replayed on the commit that adds it.
  const pendingRef = useRef<number | null>(null);
  useEffect(() => {
    const target = pendingRef.current;
    if (target === null || target > open) return;
    pendingRef.current = null;
    scrollToIndex(target);
  }, [open, scrollToIndex]);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next > last) return;
      if (next <= openRef.current) {
        scrollToIndex(next);
        return;
      }
      pendingRef.current = next;
    },
    [last, scrollToIndex],
  );

  useImperativeHandle(ref, () => ({ goTo }), [goTo]);

  const settle = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
      if (next === indexRef.current) return;
      indexRef.current = next;
      onIndexChange(next);
      // Otherwise one page's keyboard stays up over the next, carrying the wrong
      // keyboardType and stopping iOS re-running autofill.
      Keyboard.dismiss();
      const feedback =
        next === last
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          : Haptics.selectionAsync();
      feedback.catch(() => {});
    },
    [width, last, onIndexChange],
  );

  const goBack = useCallback(() => {
    if (indexRef.current === 0) return false;
    scrollToIndex(indexRef.current - 1);
    return true;
  }, [scrollToIndex]);

  // Android hardware back walks the pager instead of leaving the flow.
  // Registered once, reading refs, so the native listener is not torn down and
  // rebuilt on every page turn.
  useFocusEffect(
    useCallback(() => {
      const sub2 = BackHandler.addEventListener("hardwareBackPress", () => {
        if (busyRef.current) return true;
        return goBack();
      });
      return () => sub2.remove();
    }, [goBack]),
  );

  const pageProps: StepPageProps = {
    width,
    height: pageHeight,
    topInset: insets.top + 52,
    reduceMotion,
  };

  const pages = renderPages(pageProps).slice(0, open + 1);

  return (
    <View style={styles.root}>
      {/* One fixed wash rather than a boxed header — it gives the screen a
          horizon without putting a card between the question and the eye. */}
      <LinearGradient
        colors={["rgba(45,0,21,0.9)", "rgba(28,0,56,0.35)", "rgba(8,8,16,0)"]}
        style={styles.wash}
        pointerEvents="none"
      />

      <View style={[styles.chrome, { top: insets.top + 6 }]} pointerEvents="box-none">
        <Pressable
          onPress={goBack}
          hitSlop={12}
          disabled={index === 0 || busy}
          accessibilityRole="button"
          accessibilityLabel={t("wizard.back")}
          style={styles.back}
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={index === 0 ? "transparent" : P.text}
          />
        </Pressable>
        <LanguageToggle />
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        style={styles.pager}
        horizontal
        pagingEnabled
        bounces={false}
        scrollEnabled={!busy}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onScrollEndDrag={settle}
        onMomentumScrollEnd={settle}
        // Only measured while the keyboard is down. Re-measuring as the IME
        // animates would resize every page mid-flight and visibly squash them.
        onLayout={(e) => {
          if (keyboardHeight === 0) setPageHeight(e.nativeEvent.layout.height);
        }}
      >
        {pages}
      </Animated.ScrollView>

      <View
        style={[styles.footer, { paddingBottom: insets.bottom + 14 + keyboardHeight }]}
      >
        <RouteProgress
          progress={progress}
          count={count}
          width={width - 56}
          onSeek={(i) => {
            if (i <= open && !busy) goTo(i);
          }}
          seekLabel={(i) => t("wizard.stepBack", { n: i + 1 })}
        />

        <Pressable
          onPress={onPrimary}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          {busy ? (
            <>
              <ActivityIndicator size="small" color="#2d0015" />
              <Text style={styles.ctaText} maxFontSizeMultiplier={FONT_CAP.action}>
                {busyLabel ?? primaryLabel}
              </Text>
            </>
          ) : (
            <Text style={styles.ctaText} maxFontSizeMultiplier={FONT_CAP.action}>
              {primaryLabel}
            </Text>
          )}
        </Pressable>

        <View style={styles.subSlot}>{sub}</View>
      </View>
    </View>
  );
}

export default React.forwardRef(FlowShell);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  wash: { position: "absolute", top: 0, left: 0, right: 0, height: 380 },
  chrome: {
    position: "absolute",
    left: 20,
    right: 16,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  back: { padding: 4 },
  pager: { flex: 1 },
  footer: { paddingHorizontal: 28, paddingTop: 4, gap: 12 },
  cta: {
    height: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: P.accentLight,
  },
  ctaPressed: { opacity: 0.85 },
  // Maroon on orchid rather than white on purple: it is the one high-contrast
  // pairing in this palette that stays readable at the foot of a dark screen.
  ctaText: { color: "#2d0015", fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
  subSlot: { height: 22, alignItems: "center", justifyContent: "center" },
});
