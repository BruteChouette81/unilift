export type PromotedEvent = {
  id: string;
  name: string;
  nameFr: string;
  venue: string;
  date: string;
  lat: number;
  lng: number;
  tag: string;
  tagFr: string;
  description: string;
  descriptionFr: string;
  ticketPrice?: number; // cents — undefined means free entry
};

export const PROMOTED_EVENTS: PromotedEvent[] = [
  {
    id: "ev1",
    name: "Throwback Thursday",
    nameFr: "Jeudi Rétro",
    venue: "Shaker St-Foy",
    date: "Thu Apr 3",
    lat: 46.7869189,
    lng: -71.2822901,
    tag: "Bar Night",
    tagFr: "Soirée Bar",
    description: "2000s & 2010s hits all night. Free entry before 11PM.",
    descriptionFr: "Hits des années 2000-2010 toute la nuit. Entrée gratuite avant 23h.",
    ticketPrice: 1000,
  },
  {
    id: "ev2",
    name: "Neon Rave",
    nameFr: "Néon Rave",
    venue: "Place Laurier",
    date: "Sat Apr 5",
    lat: 46.77146578,
    lng: -71.28316956,
    tag: "Party",
    tagFr: "Fête",
    description: "The biggest EDM night in Quebec City. Get your glow on.",
    descriptionFr: "La plus grande soirée EDM de Québec. Brillez sous les néons.",
    ticketPrice: 1500,
  },
  {
    id: "ev3",
    name: "Campus Bar Crawl",
    nameFr: "Bar Crawl Campus",
    venue: "Vieux-Québec",
    date: "Fri Apr 4",
    lat: 46.8139,
    lng: -71.2082,
    tag: "Crawl",
    tagFr: "Bar Crawl",
    description: "Hit 5 bars with your crew. UniLift gets you there safely.",
    descriptionFr: "5 bars avec votre gang. UniLift vous y amène en sécurité.",
    ticketPrice: 500,
  },
];
