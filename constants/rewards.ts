export type RewardCategory = "food" | "gas" | "entertainment" | "transport";

export type Reward = {
  id: string;
  level: number;
  title: string;
  titleFr: string;
  description: string;
  descriptionFr: string;
  icon: string;
  value: string;
  category: RewardCategory;
  logoUrl?: string;   // sponsor company logo (clearbit CDN)
  /** Slug of the sponsor this reward belongs to (matches Sponsor.id from the
   *  seeder, e.g. "mcdonalds-laurier"). Undefined = generic UniLift reward. */
  sponsorId?: string;
};

export const REWARDS: Reward[] = [
  // ── McDonald's (sponsor: mcdonalds-laurier) ──────────────────────────────
  {
    id: "mcd-fries",
    level: 1,
    icon: "🍟",
    category: "food",
    title: "Free Fries",
    titleFr: "Frites gratuites",
    description: "Medium fries with any purchase",
    descriptionFr: "Frites moyennes avec tout achat",
    value: "FREE",
    logoUrl: "https://logo.clearbit.com/mcdonalds.com",
    sponsorId: "mcdonalds-laurier",
  },
  {
    id: "r2",
    level: 2,
    icon: "🍔",
    category: "food",
    title: "McDonald's Gift Card",
    titleFr: "Carte-cadeau McDonald's",
    description: "Treat yourself after a ride",
    descriptionFr: "Récompense-toi après un trajet",
    value: "$5",
    logoUrl: "https://logo.clearbit.com/mcdonalds.com",
    sponsorId: "mcdonalds-laurier",
  },
  {
    id: "mcd-bigmac",
    level: 5,
    icon: "🍔",
    category: "food",
    title: "Free Big Mac",
    titleFr: "Big Mac gratuit",
    description: "On the house — you've earned it",
    descriptionFr: "Offert — tu l'as mérité",
    value: "FREE",
    logoUrl: "https://logo.clearbit.com/mcdonalds.com",
    sponsorId: "mcdonalds-laurier",
  },

  // ── Café Campus (sponsor: cafe-campus) ───────────────────────────────────
  {
    id: "cafe-coffee",
    level: 1,
    icon: "☕",
    category: "food",
    title: "Free Coffee",
    titleFr: "Café gratuit",
    description: "Any size, after 8 PM",
    descriptionFr: "Tout format, après 20 h",
    value: "FREE",
    logoUrl: "https://logo.clearbit.com/starbucks.com",
    sponsorId: "cafe-campus",
  },
  {
    id: "cafe-pastry",
    level: 4,
    icon: "🥐",
    category: "food",
    title: "Pastry Combo",
    titleFr: "Combo viennoiserie",
    description: "Coffee + pastry discount",
    descriptionFr: "Rabais café + viennoiserie",
    value: "$3 OFF",
    logoUrl: "https://logo.clearbit.com/starbucks.com",
    sponsorId: "cafe-campus",
  },

  // ── Shaker Ste-Foy (sponsor: shaker-ste-foy) ─────────────────────────────
  {
    id: "shaker-cover",
    level: 1,
    icon: "🎟️",
    category: "entertainment",
    title: "No Cover Charge",
    titleFr: "Entrée sans frais",
    description: "Skip the cover when you arrive by UniLift",
    descriptionFr: "Pas de frais d'entrée en arrivant avec UniLift",
    value: "FREE",
    sponsorId: "shaker-ste-foy",
  },
  {
    id: "shaker-shot",
    level: 3,
    icon: "🍸",
    category: "entertainment",
    title: "Welcome Cocktail",
    titleFr: "Cocktail de bienvenue",
    description: "One house cocktail on arrival",
    descriptionFr: "Un cocktail maison à l'arrivée",
    value: "FREE",
    sponsorId: "shaker-ste-foy",
  },

  // ── Dépanneur Campus (sponsor: campus-depanneur) ─────────────────────────
  {
    id: "dep-snack",
    level: 2,
    icon: "🍫",
    category: "food",
    title: "Snack & Drink Combo",
    titleFr: "Combo collation + boisson",
    description: "Any snack + drink bundle",
    descriptionFr: "Tout combo collation + boisson",
    value: "$2 OFF",
    sponsorId: "campus-depanneur",
  },

  // ── Generic UniLift rewards (no sponsor) ─────────────────────────────────
  {
    id: "r1",
    level: 1,
    icon: "🎉",
    category: "transport",
    title: "UniLift Promo Code",
    titleFr: "Code promo UniLift",
    description: "10% off your next ride",
    descriptionFr: "10% de rabais sur ton prochain trajet",
    value: "10% OFF",
  },
  {
    id: "r6",
    level: 10,
    icon: "📦",
    category: "entertainment",
    title: "Amazon Gift Card",
    titleFr: "Carte-cadeau Amazon",
    description: "Shop anything you want",
    descriptionFr: "Achète ce que tu veux",
    value: "$25",
    logoUrl: "https://logo.clearbit.com/amazon.com",
  },
  {
    id: "r7",
    level: 15,
    icon: "💳",
    category: "entertainment",
    title: "Visa Gift Card",
    titleFr: "Carte Visa prépayée",
    description: "Use anywhere Visa is accepted",
    descriptionFr: "Utilisable partout où Visa est accepté",
    value: "$50",
    logoUrl: "https://logo.clearbit.com/visa.com",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** XP → level. 100 XP per level (matches the profile card's inline formula). */
export function xpToLevel(xp: number): number {
  return Math.floor((Number.isFinite(xp) ? xp : 0) / 100) + 1;
}

/** Whether a reward is unlocked at the user's current XP, plus the progress
 *  (0–100) of the user's XP toward this reward's unlock level (for locked bars). */
export function rewardProgress(reward: Reward, xp: number): { unlocked: boolean; pct: number } {
  const safeXp = Number.isFinite(xp) ? xp : 0;
  const level = xpToLevel(safeXp);
  const unlocked = level >= reward.level;
  if (unlocked) return { unlocked: true, pct: 100 };
  // XP needed to reach the reward's level (level N unlocks at (N-1)*100 XP).
  const targetXp = (reward.level - 1) * 100;
  const pct = targetXp <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((safeXp / targetXp) * 100)));
  return { unlocked: false, pct };
}

/** All rewards belonging to a given sponsor slug (ordered by unlock level). */
export function getSponsorRewards(sponsorId: string): Reward[] {
  return REWARDS.filter((r) => r.sponsorId === sponsorId).sort((a, b) => a.level - b.level);
}

export type RewardGroup = { key: string; label: string; logoUrl?: string; rewards: Reward[] };

// Demo display metadata for the sponsor reward groups on the profile screen.
// Kept local so the screen needs no Firestore fetch (dev demo, offline-robust).
const SPONSOR_GROUPS: { key: string; label: string; logoUrl?: string }[] = [
  { key: "mcdonalds-laurier", label: "McDonald's", logoUrl: "https://logo.clearbit.com/mcdonalds.com" },
  { key: "cafe-campus", label: "Café Campus", logoUrl: "https://logo.clearbit.com/starbucks.com" },
  { key: "shaker-ste-foy", label: "Shaker Ste-Foy" },
  { key: "campus-depanneur", label: "Dépanneur Campus" },
];

/** Rewards grouped by sponsor for the profile Rewards screen, with a trailing
 *  "UniLift" group for generic (sponsorless) rewards. Empty groups are omitted.
 *  The UniLift group label is passed in (translated by the caller). */
export function getRewardGroups(uniliftLabel: string): RewardGroup[] {
  const groups: RewardGroup[] = [];
  for (const g of SPONSOR_GROUPS) {
    const rewards = getSponsorRewards(g.key);
    if (rewards.length) groups.push({ ...g, rewards });
  }
  const generic = REWARDS.filter((r) => !r.sponsorId).sort((a, b) => a.level - b.level);
  if (generic.length) groups.push({ key: "unilift", label: uniliftLabel, rewards: generic });
  return groups;
}
