/**
 * Every school the signup flow offers, grouped by region.
 *
 * ## Why this is a module and not an array in the screen
 *
 * It lived inside `SignupScreen`'s function body, which meant ~100 strings were
 * re-allocated on every keystroke of the school filter. It also carried seven
 * exact duplicates — a handful of institutions were listed once under their
 * home region and again under a second one, and a trailing "Universities"
 * block repeated five UQ campuses that the regional sections already had. The
 * picker keys by index, so those schools rendered twice in the list.
 *
 * The regional grouping is kept because it is what makes the list scannable
 * when someone scrolls it rather than searches it. The rule for adding a
 * school: put it under the region it is actually in, once. If it belongs to two
 * regions, pick the one a student would name first.
 *
 * `SCHOOL_EMAIL_DOMAINS` in `constants/certifications.ts` is the companion list
 * used for Student certification. The two are deliberately separate — a school
 * can be pickable here before its email domain is trusted for verification.
 */
export const SCHOOLS: readonly string[] = [
  // ── Québec City / Chaudière-Appalaches ──────────────────────────────────
  'Cégep de Sainte-Foy',
  'Cégep Garneau',
  'Cégep Champlain St-Lawrence',
  'Cégep de Limoilou',
  'Cégep de Lévis',
  'Université Laval',

  // ── Montréal ────────────────────────────────────────────────────────────
  'Cégep de Maisonneuve',
  'Cégep du Vieux Montréal',
  'Cégep André-Laurendeau',
  'Cégep Ahuntsic',
  'Cégep de Saint-Laurent',
  'Cégep Édouard-Montpetit',
  'Cégep de Rosemont',
  'Cégep de Bois-de-Boulogne',
  'Cégep Gérald-Godin',
  'Cégep John Abbott',
  'Dawson College',
  'Vanier College',
  'Marianopolis College',
  'Collège LaSalle',
  'Collège de Maisonneuve',
  'Université de Montréal',
  'Polytechnique Montréal',
  'HEC Montréal',
  'Université du Québec à Montréal',
  'McGill University',
  'Concordia University',

  // ── Sherbrooke / Estrie ─────────────────────────────────────────────────
  'Cégep de Sherbrooke',
  'Séminaire de Sherbrooke',
  'Université de Sherbrooke',
  'Collège Champlain – Lennoxville',

  // ── Trois-Rivières ──────────────────────────────────────────────────────
  'Cégep de Trois-Rivières',
  'Collège Laflèche',
  'Université du Québec à Trois-Rivières',

  // ── Saguenay–Lac-Saint-Jean ─────────────────────────────────────────────
  'Cégep de Chicoutimi',
  'Cégep de Jonquière',
  'Cégep de Saint-Félicien',
  'Université du Québec à Chicoutimi',

  // ── Rimouski / Bas-Saint-Laurent ────────────────────────────────────────
  'Cégep de Rimouski',
  'Cégep de La Pocatière',
  'Cégep de Rivière-du-Loup',
  'Université du Québec à Rimouski',

  // ── Outaouais ───────────────────────────────────────────────────────────
  'Cégep de l’Outaouais',
  'Heritage College',
  'Université du Québec en Outaouais',

  // ── Abitibi-Témiscamingue ───────────────────────────────────────────────
  'Cégep de l’Abitibi-Témiscamingue',
  'Université du Québec en Abitibi-Témiscamingue',

  // ── Côte-Nord ───────────────────────────────────────────────────────────
  'Cégep de Baie-Comeau',
  'Cégep de Sept-Îles',

  // ── Gaspésie / Îles-de-la-Madeleine ─────────────────────────────────────
  'Cégep de la Gaspésie et des Îles',

  // ── Lanaudière ──────────────────────────────────────────────────────────
  'Cégep régional de Lanaudière à Joliette',
  'Cégep régional de Lanaudière à L’Assomption',
  'Cégep régional de Lanaudière à Terrebonne',

  // ── Laurentides ─────────────────────────────────────────────────────────
  'Cégep de Saint-Jérôme',

  // ── Montérégie ──────────────────────────────────────────────────────────
  'Cégep de Saint-Hyacinthe',
  'Cégep de Granby',
  'Cégep de Sorel-Tracy',
  'Cégep de Valleyfield',
  'Cégep de Saint-Jean-sur-Richelieu',

  // ── Centre-du-Québec ────────────────────────────────────────────────────
  'Cégep de Drummondville',
  'Cégep de Victoriaville',

  // ── Province-wide ───────────────────────────────────────────────────────
  // The network's head office / online campus. Its constituent campuses are
  // each listed under their own region above.
  'Université du Québec',
];

/**
 * Case-, accent- and apostrophe-insensitive form used for matching, so "st
 * jerome" finds "Cégep de Saint-Jérôme" and "l'outaouais" typed with a straight
 * quote finds "Cégep de l’Outaouais", which holds a U+2019.
 *
 * `Intl.Collator` would be the tidier tool but it has no substring search, and
 * `localeCompare` only orders. NFD + stripping the combining-marks block is the
 * one approach that behaves the same in Hermes and in the Jest/node
 * environment.
 */
export function normalizeSchoolQuery(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc]/g, "'");
}

/** The schools matching `query`, or the whole list when it is blank. */
export function filterSchools(query: string): readonly string[] {
  const needle = normalizeSchoolQuery(query);
  if (!needle) return SCHOOLS;
  return SCHOOLS.filter((school) => normalizeSchoolQuery(school).includes(needle));
}
