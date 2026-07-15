import type { UserProfile } from "@/types/models";

/** The profile items a student must complete before riding. */
export type ProfileTaskKey =
  | "avatar"
  | "name"
  | "school"
  | "verification"
  | "homeAddress"
  | "payment";

export type ProfileTask = {
  key: ProfileTaskKey;
  done: boolean;
};

export type ProfileCompletion = {
  /** Every task, in display order, with its done state. */
  tasks: ProfileTask[];
  completed: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
  isComplete: boolean;
  missing: ProfileTaskKey[];
};

/**
 * Completion is derived from two sources, not one:
 *  - `userData` covers avatar / name / school / verification / homeAddress.
 *  - `hasPaymentMethod` must come from WalletContext — `normalizeUserData`
 *    never parses the stripePaymentMethod* fields, so reading them off
 *    UserProfile would report "no card" for every user.
 */
export type ProfileCompletionInput = {
  userData: UserProfile | null;
  hasPaymentMethod: boolean;
};

/** Display order — also the order the completion card lists them in. */
export const PROFILE_TASK_ORDER: ProfileTaskKey[] = [
  "avatar",
  "name",
  "school",
  "verification",
  "homeAddress",
  "payment",
];

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Derives profile-completion state.
 *
 * A null profile (still loading, or signed out) reports every userData-backed
 * task as incomplete — callers should gate on their own loading flags before
 * nudging, so a slow read never shows a false "0/6".
 */
export function getProfileCompletion({
  userData,
  hasPaymentMethod,
}: ProfileCompletionInput): ProfileCompletion {
  const doneByKey: Record<ProfileTaskKey, boolean> = {
    avatar:      hasText(userData?.avatar),
    name:        hasText(userData?.name),
    school:      hasText(userData?.school),
    // Certifications are stackable and written only by the Cloud Function;
    // holding any tier (adult / student) counts as verified.
    verification: (userData?.certifications?.length ?? 0) > 0,
    homeAddress: hasText(userData?.homeAddress),
    payment:     hasPaymentMethod,
  };

  const tasks = PROFILE_TASK_ORDER.map((key) => ({ key, done: doneByKey[key] }));
  const completed = tasks.filter((task) => task.done).length;
  const total = tasks.length;

  return {
    tasks,
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    isComplete: completed === total,
    missing: tasks.filter((task) => !task.done).map((task) => task.key),
  };
}
