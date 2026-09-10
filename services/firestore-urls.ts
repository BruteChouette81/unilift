/**
 * Shared Firestore REST collection URLs.
 *
 * Kept separate from `firestore-rest.ts` on purpose: that module is pure
 * unwrapping logic with no runtime dependencies, which is what lets it be unit
 * tested under plain Node. Anything that reaches into `runtime-config` pulls in
 * `expo-constants` and can only run inside the Expo runtime, so it lives here.
 */
import { firestoreCollectionUrl } from "@/constants/runtime-config";

/** The `users` collection REST base — previously redeclared verbatim in three
 *  service files. */
export const USERS_BASE_URL = firestoreCollectionUrl("users");
