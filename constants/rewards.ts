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
};

export const REWARDS: Reward[] = [
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
    id: "r2",
    level: 2,
    icon: "🍟",
    category: "food",
    title: "McDonald's Gift Card",
    titleFr: "Carte-cadeau McDonald's",
    description: "Treat yourself after a ride",
    descriptionFr: "Récompense-toi après un trajet",
    value: "$5",
    logoUrl: "https://logo.clearbit.com/mcdonalds.com",
  },
  {
    id: "r3",
    level: 3,
    icon: "☕",
    category: "food",
    title: "Tim Hortons Gift Card",
    titleFr: "Carte-cadeau Tim Hortons",
    description: "Coffee on us",
    descriptionFr: "Café offert",
    value: "$10",
    logoUrl: "https://logo.clearbit.com/timhortons.com",
  },
  {
    id: "r4",
    level: 5,
    icon: "⛽",
    category: "gas",
    title: "Gas Gift Card",
    titleFr: "Carte-cadeau essence",
    description: "Valid at Esso & Shell",
    descriptionFr: "Valide chez Esso et Shell",
    value: "$15",
    logoUrl: "https://logo.clearbit.com/shell.com",
  },
  {
    id: "r5",
    level: 7,
    icon: "🥪",
    category: "food",
    title: "Subway Gift Card",
    titleFr: "Carte-cadeau Subway",
    description: "Build your own sub",
    descriptionFr: "Crée ton propre sous-marin",
    value: "$20",
    logoUrl: "https://logo.clearbit.com/subway.com",
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
