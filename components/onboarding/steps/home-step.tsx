import React from "react";

import PlaceField, { type Coords } from "@/components/flow/place-field";
import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";
import { useLanguage } from "@/context/LanguageContext";

/**
 * Page 1: home address — and the welcome.
 *
 * The greeting rides on this page's reason line rather than taking a page of
 * its own. An intro page that collects nothing is a tap the user pays for and
 * gets nothing back from, and the reassurance that matters ("you can change any
 * of this later") lands harder next to the first thing being asked for.
 */
export default function HomeStep({
  width,
  height,
  topInset,
  reduceMotion,
  value,
  onChangeText,
  onSelect,
  hasCoords,
  editable,
}: StepPageProps & {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (name: string, coords: Coords) => void;
  hasCoords: boolean;
  editable?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <StepFrame
      width={width}
      height={height}
      topInset={topInset}
      ask={t("onboarding.homeAsk")}
      aside={t("onboarding.homeAside")}
    >
      <PlaceField
        label={t("onboarding.homeLabel")}
        value={value}
        placeholder={t("onboarding.homePlaceholder")}
        onChangeText={onChangeText}
        onSelect={onSelect}
        // Green only once a suggestion was picked: free text with no
        // coordinates cannot be used to match rides, so it is not a real answer.
        valid={hasCoords}
        reduceMotion={reduceMotion}
        editable={editable}
      />
    </StepFrame>
  );
}
