/**
 * Seed the Firestore `events` collection with sample Hype-map events.
 *
 * Run from the functions/ directory (firebase-admin is installed there):
 *
 *   # 1. Point at a service-account key with Firestore write access:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *   export GOOGLE_CLOUD_PROJECT=<your-firebase-project-id>   # if not in the key
 *
 *   # 2. Seed:
 *   cd functions && node seed-events.js
 *
 * Re-running is safe — it upserts by id (set), so existing docs are overwritten
 * (attendeeCount is reset to 0). Pass --keep-counts to preserve attendeeCount.
 *
 * `score` (1–10) controls the flame marker size on the map (10 = biggest fire).
 */
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
db.settings({ databaseId: "uniliftdefault" });
const GeoPoint = admin.firestore.GeoPoint;

const KEEP_COUNTS = process.argv.includes("--keep-counts");

// Sample events around Québec City. Edit freely or add your own.
const EVENTS = [
  {
    id: "neon-rave",
    name: "Neon Rave",
    nameFr: "Néon Rave",
    venue: "Place Laurier",
    lat: 46.77146578,
    lng: -71.28316956,
    score: 10,
    tag: "Party",
    tagFr: "Fête",
    description: "The biggest EDM night in Québec City. Glow up and dance till sunrise.",
    descriptionFr: "La plus grande soirée EDM de Québec. Brillez sous les néons jusqu'à l'aube.",
    date: "Sat Apr 5",
    time: "11 PM",
    ticketPriceCents: 1500,
  },
  {
    id: "campus-bar-crawl",
    name: "Campus Bar Crawl",
    nameFr: "Tournée des bars Campus",
    venue: "Vieux-Québec",
    lat: 46.8139,
    lng: -71.2082,
    score: 7,
    tag: "Bar Crawl",
    tagFr: "Tournée des bars",
    description: "Hit 5 bars with your crew. UniLift gets you there safely.",
    descriptionFr: "5 bars avec ta gang. UniLift t'y amène en sécurité.",
    date: "Fri Apr 4",
    time: "9 PM",
    ticketPriceCents: 500,
  },
  {
    id: "throwback-thursday",
    name: "Throwback Thursday",
    nameFr: "Jeudi Rétro",
    venue: "Shaker Ste-Foy",
    lat: 46.7869189,
    lng: -71.2822901,
    score: 5,
    tag: "Bar Night",
    tagFr: "Soirée Bar",
    description: "2000s & 2010s hits all night. Free entry before 11 PM.",
    descriptionFr: "Hits des années 2000-2010 toute la nuit. Entrée gratuite avant 23 h.",
    date: "Thu Apr 3",
    time: "10 PM",
    ticketPriceCents: 1000,
  },
  {
    id: "open-mic-night",
    name: "Open Mic Night",
    nameFr: "Soirée micro ouvert",
    venue: "Le Cercle",
    lat: 46.8125,
    lng: -71.2155,
    score: 2,
    tag: "Live Music",
    tagFr: "Musique live",
    description: "Cozy acoustic sets from local students. Free entry, all welcome.",
    descriptionFr: "Sets acoustiques d'étudiants locaux. Entrée gratuite, tous bienvenus.",
    date: "Wed Apr 2",
    time: "8 PM",
    // no ticketPriceCents → free entry
  },
];

(async () => {
  const batch = db.batch();
  for (const ev of EVENTS) {
    const { id, lat, lng, ...rest } = ev;
    const ref = db.collection("events").doc(id);
    const doc = { ...rest, location: new GeoPoint(lat, lng) };
    if (!KEEP_COUNTS) doc.attendeeCount = 0;
    batch.set(ref, doc, { merge: KEEP_COUNTS });
  }
  await batch.commit();
  console.log(`✅ Seeded ${EVENTS.length} events into "events" (db: uniliftdefault).`);
  process.exit(0);
})().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
