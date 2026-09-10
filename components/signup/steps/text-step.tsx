import React from "react";

import Field, { type FieldProps } from "@/components/flow/field";
import StepFrame, { type StepPageProps } from "@/components/flow/step-frame";

/**
 * A page whose whole job is one text field: name, email, birth date.
 *
 * These three differ only in their question, their keyboard and how they format
 * what you type, so they share a component rather than three files that would
 * drift apart the first time the field styling changed. The pages that do more
 * than hold a field — password, school, phone, terms, review — each have their
 * own.
 */
export default function TextStep({
  width,
  height,
  topInset,
  reduceMotion,
  ask,
  aside,
  children,
  ...field
}: StepPageProps & {
  ask: string;
  aside: string;
  /** Rendered under the field. The name page uses it for the Apple button. */
  children?: React.ReactNode;
} & Omit<FieldProps, "reduceMotion">) {
  return (
    <StepFrame width={width} height={height} topInset={topInset} ask={ask} aside={aside}>
      <Field {...field} reduceMotion={reduceMotion} />
      {children}
    </StepFrame>
  );
}
