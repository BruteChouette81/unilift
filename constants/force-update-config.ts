/**
 * LOCAL FALLBACKS — used when the Firestore config doc cannot be reached.
 * The live values are controlled from Firebase Console → Firestore →
 * config/forceUpdate → { enabled: bool, minimumVersion: string, iosStoreUrl: string, androidStoreUrl: string }.
 */
export const FORCE_UPDATE_ENABLED = false;
export const FORCE_UPDATE_MINIMUM_VERSION = "1.2.1";
export const FORCE_UPDATE_IOS_URL =
  "https://apps.apple.com/app/id6755918549";
export const FORCE_UPDATE_ANDROID_URL =
  "https://play.google.com/store/apps/details?id=com.unilift";

export function isUpdateRequired(
  installed: string,
  minimum: string,
): boolean {
  // Parse to [major, minor, patch], defaulting missing/NaN segments to 0 so a
  // short or malformed version string ("1.2", "1.2.0-beta") can't break the compare.
  const parse = (v: string): [number, number, number] => {
    const parts = v.split(".").map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [iMaj, iMin, iPat] = parse(installed);
  const [mMaj, mMin, mPat] = parse(minimum);
  if (iMaj !== mMaj) return iMaj < mMaj;
  if (iMin !== mMin) return iMin < mMin;
  return iPat < mPat;
}

export type ForceUpdateRemoteConfig = {
  enabled: boolean;
  minimumVersion: string;
  iosStoreUrl: string;
  androidStoreUrl: string;
  loading: boolean;
};
