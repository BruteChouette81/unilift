import { fr } from "./fr";
import { en } from "./en";

export type Language = "fr" | "en";
export type TranslationDict = typeof fr;
export const DEFAULT_LANGUAGE: Language = "fr";
export const SUPPORTED_LANGUAGES: Language[] = ["fr", "en"];
export const translations: Record<Language, TranslationDict> = { fr, en };

export { fr, en };
