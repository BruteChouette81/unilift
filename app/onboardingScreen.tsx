import { initPaymentSheet, presentPaymentSheet } from "@stripe/stripe-react-native";
import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text } from "react-native";

import FlowShell, { type FlowShellHandle } from "@/components/flow/flow-shell";
import { type Coords } from "@/components/flow/place-field";
import { type StepPageProps } from "@/components/flow/step-frame";
import CardStep from "@/components/onboarding/steps/card-step";
import FavoritesStep from "@/components/onboarding/steps/favorites-step";
import HomeStep from "@/components/onboarding/steps/home-step";
import { patchUserField } from "@/components/userHelper";
import { P } from "@/constants/palette";
import { devWarn } from "@/constants/runtime-config";
import { FONT_CAP } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useUserProfile } from "@/context/UserProfileContext";
import { confirmPaymentMethod, setupPaymentMethod } from "@/services/walletService";
import type { FavoriteRoute } from "@/types/models";

/**
 * The setup that follows account creation: home, favourite places, a card.
 *
 * Built on the same shell as signup (`components/flow/flow-shell.tsx`), because
 * it is the same idea — one thing per page, a route you travel — and the two
 * arrive back to back. The difference is that **nothing here is required**: the
 * three pages are all reachable from the start, no answer gates the next page,
 * and Skip is always on screen. Onboarding that blocks is onboarding people
 * abandon, and every field here has a home in Profile Settings anyway.
 *
 * Driver availability used to be a fourth section, hidden behind a constant
 * that has been false since it was written. It is not carried over; the recurring
 * availability planner lives in `app/driverModeScreen.tsx`.
 */

const STEP = { home: 0, favorites: 1, card: 2 } as const;
const TOTAL = 3;

/** Encode favourite routes into the Firestore field map used elsewhere. */
function encodeFavoriteFields(favorites: FavoriteRoute[]): Record<string, unknown> {
  return {
    favorite: {
      arrayValue: {
        values: favorites.map((f) => ({
          mapValue: {
            fields: {
              destination: { stringValue: f.destination },
              destinationGeolocation: {
                geoPointValue: {
                  latitude: f.destinationGeo.lat,
                  longitude: f.destinationGeo.lon,
                },
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
  const { t } = useLanguage();
  const { user } = useAuth();
  const { updateUserData } = useUserProfile();

  const shell = useRef<FlowShellHandle>(null);
  const [index, setIndex] = useState(0);

  const [homeAddress, setHomeAddress] = useState("");
  const [homeCoords, setHomeCoords] = useState<Coords | null>(null);

  const [favorites, setFavorites] = useState<FavoriteRoute[]>([]);
  const [favDraft, setFavDraft] = useState("");
  const [favCoords, setFavCoords] = useState<Coords | null>(null);

  const [cardAdded, setCardAdded] = useState(false);
  const [cardLast4, setCardLast4] = useState<string | null>(null);
  const [cardBrand, setCardBrand] = useState<string | null>(null);
  const [cardLoading, setCardLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const goHome = useCallback(() => router.replace("/"), [router]);

  const addFavorite = useCallback(() => {
    if (!favDraft.trim() || !favCoords) return;
    setFavorites((prev) => [
      ...prev,
      {
        destination: favDraft.trim(),
        destinationGeo: { lat: favCoords.latitude, lon: favCoords.longitude },
      },
    ]);
    setFavDraft("");
    setFavCoords(null);
  }, [favDraft, favCoords]);

  const removeFavorite = useCallback((i: number) => {
    setFavorites((prev) => prev.filter((_, at) => at !== i));
  }, []);

  const handleAddCard = async () => {
    if (!user || cardLoading) return;
    setCardLoading(true);
    try {
      const token = await user.getIdToken();
      let setupData: {
        clientSecret: string;
        customerId: string;
        ephemeralKey: string;
      };
      try {
        setupData = await setupPaymentMethod(token);
      } catch {
        // The Stripe customer is created lazily on the server; a brand-new
        // account can beat it here by a moment. One retry covers that.
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
        if (presentError.code !== "Canceled") {
          Alert.alert(t("wallet.paymentFailed"), presentError.message);
        }
        return;
      }
      const setupIntentId = clientSecret.split("_secret_")[0];
      const freshToken = await user.getIdToken();
      const { paymentMethod: pm } = await confirmPaymentMethod(
        freshToken,
        setupIntentId,
      );
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

  const handleFinish = async () => {
    if (!user || saving) return;
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};

      if (homeAddress.trim()) {
        fields.homeAddress = { stringValue: homeAddress.trim() };
        if (homeCoords) {
          fields.homeAddressCoords = {
            geoPointValue: {
              latitude: homeCoords.latitude,
              longitude: homeCoords.longitude,
            },
          };
        }
      }

      if (favorites.length > 0) {
        Object.assign(fields, encodeFavoriteFields(favorites));
      }

      if (Object.keys(fields).length > 0) {
        const token = await user.getIdToken();
        await patchUserField(token, user.uid, fields);

        // Mirror into the session cache so the tabs render the new values
        // without waiting for a refetch.
        const patch: Record<string, unknown> = {};
        if (homeAddress.trim()) {
          patch.homeAddress = homeAddress.trim();
          if (homeCoords) patch.homeAddressCoords = homeCoords;
        }
        if (favorites.length > 0) patch.favorite = favorites;
        updateUserData(patch);
      }

      goHome();
    } catch (err) {
      devWarn("Onboarding save failed:", err);
      // Still leaves for home: none of this is required, and stranding someone
      // on a setup screen over a failed optional write is the worse outcome.
      Alert.alert(t("onboarding.saveFailedTitle"), t("onboarding.saveFailedMsg"), [
        { text: t("common.ok"), onPress: goHome },
      ]);
    } finally {
      setSaving(false);
    }
  };

  const renderPages = (page: StepPageProps) => [
    <HomeStep
      key="home"
      {...page}
      value={homeAddress}
      onChangeText={(text) => {
        setHomeAddress(text);
        // Free text is not an address until a suggestion pins it.
        setHomeCoords(null);
      }}
      onSelect={(place, coords) => {
        setHomeAddress(place);
        setHomeCoords(coords);
      }}
      hasCoords={Boolean(homeCoords)}
      editable={!saving}
    />,

    <FavoritesStep
      key="favorites"
      {...page}
      favorites={favorites}
      onRemove={removeFavorite}
      draft={favDraft}
      onDraftChange={(text) => {
        setFavDraft(text);
        setFavCoords(null);
      }}
      onDraftSelect={(place, coords) => {
        setFavDraft(place);
        setFavCoords(coords);
      }}
      draftCoords={favCoords}
      onAdd={addFavorite}
      editable={!saving}
    />,

    <CardStep
      key="card"
      {...page}
      added={cardAdded}
      brand={cardBrand}
      last4={cardLast4}
      loading={cardLoading}
      onAdd={handleAddCard}
    />,
  ];

  return (
    <FlowShell
      ref={shell}
      count={TOTAL}
      renderPages={renderPages}
      index={index}
      onIndexChange={setIndex}
      busy={saving}
      busyLabel={t("onboarding.saving")}
      primaryLabel={
        index === STEP.card ? t("onboarding.finish") : t("onboarding.continueBtn")
      }
      onPrimary={() =>
        index === STEP.card ? handleFinish() : shell.current?.goTo(index + 1)
      }
      sub={
        <Pressable
          onPress={goHome}
          disabled={saving}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={styles.skip} maxFontSizeMultiplier={FONT_CAP.chrome}>
            {t("onboarding.skip")}
          </Text>
        </Pressable>
      }
    />
  );
}

const styles = StyleSheet.create({
  skip: { color: P.textMuted, fontSize: 13, fontWeight: "600" },
});
