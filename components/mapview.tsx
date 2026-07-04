import { hypeScoreToIconSize, type HypeEvent } from "@/constants/events";
import {
  devLog,
  firestoreDocumentUrl,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import { getRouteStats } from "@/services/routeService";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import React, { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, TouchableOpacity, View } from "react-native";
import MapView, { Marker, Polyline, type Region } from "react-native-maps";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  purple:  "#8938D5",
  gold:    "#fbbf24",
  success: "#34d399",
  danger:  "#f87171",
  blue:    "#60a5fa",
  white:   "#ffffff",
  bg:      "#080810",
  fire:    "#f97316",
};

// ─── Dark Map Style ───────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: "geometry",        stylers: [{ color: "#0f0f1e" }] },
  { elementType: "labels.text.fill",stylers: [{ color: "#9ca3af" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#080810" }] },
  { featureType: "administrative",  elementType: "geometry", stylers: [{ color: "#1e1b4b" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#a78bfa" }] },
  { featureType: "poi",             elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { featureType: "poi.park",        elementType: "geometry", stylers: [{ color: "#0d1224" }] },
  { featureType: "poi.park",        elementType: "labels.text.fill", stylers: [{ color: "#4b5563" }] },
  { featureType: "road",            elementType: "geometry", stylers: [{ color: "#1e1b4b" }] },
  { featureType: "road",            elementType: "geometry.stroke", stylers: [{ color: "#13132a" }] },
  { featureType: "road",            elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "road.highway",    elementType: "geometry", stylers: [{ color: "#3b0764" }] },
  { featureType: "road.highway",    elementType: "geometry.stroke", stylers: [{ color: "#1e1b4b" }] },
  { featureType: "road.highway",    elementType: "labels.text.fill", stylers: [{ color: "#a78bfa" }] },
  { featureType: "transit",         elementType: "geometry", stylers: [{ color: "#13132a" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "water",           elementType: "geometry", stylers: [{ color: "#080810" }] },
  { featureType: "water",           elementType: "labels.text.fill", stylers: [{ color: "#4b5563" }] },
];

// ─── Marker that takes one snapshot then stops tracking ───────────────────────
// Custom-view markers in react-native-maps require the native layer to take a
// "snapshot" of the React view before they appear on the map. By default
// (tracksViewChanges=true) every render snapshots — bad for perf. Setting it
// to false outright means markers added AFTER the map is ready never snapshot,
// so they only appear once the user touches the map. This wrapper does it
// right: snapshot on mount, then disable tracking on the next tick.
function SnapshottingMarker(
  props: React.ComponentProps<typeof Marker> & { children: React.ReactNode },
) {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setTracking(false), 600);
    return () => clearTimeout(id);
  }, []);
  return (
    <Marker {...props} tracksViewChanges={tracking}>
      {props.children}
    </Marker>
  );
}

// ─── Styled Markers ───────────────────────────────────────────────────────────
function PinMarker({
  icon,
  color,
  size = 30,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
  size?: number;
}) {
  return (
    <View style={[m.pin, { shadowColor: color }]}>
      <Ionicons name={icon} size={size} color={color} />
      <View style={[m.pinTip, { backgroundColor: color }]} />
    </View>
  );
}

function AvatarPinMarker({ uri, color }: { uri: string | null; color: string }) {
  return (
    <View style={[m.pin, { shadowColor: color }]}>
      {uri ? (
        <Image source={{ uri }} style={m.avatarImg} />
      ) : (
        <Ionicons name="person" size={30} color={color} />
      )}
      <View style={[m.pinTip, { backgroundColor: color }]} />
    </View>
  );
}

const m = StyleSheet.create({
  pin: {
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 8,
  },
  pinTip: {
    position: "absolute",
    bottom: -7,
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.9,
  },
  avatarImg: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
});

// ─── Shared logic ────────────────────────────────────────────────────────────
function decodePolyline(encoded: string): number[][] {
  let index = 0;
  const len = encoded.length;
  const path = [];
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    path.push([lat / 1e5, lng / 1e5]);
  }
  return path;
}

async function fetchUser(uid: string) {
  const url = withFirebaseApiKey(firestoreDocumentUrl("users", uid));
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(err);
  }
}

/** @deprecated Use getRouteStats from services/routeService instead. */
async function getPathForRide(origin: number[], destination: number[]) {
  // Kept for backward compatibility; delegates to the shared route service.
  const from = { latitude: origin[1], longitude: origin[0] };
  const to = { latitude: destination[1], longitude: destination[0] };
  return getRouteStats(from, to);
}

function getPassengerPath(passengerId: string[]) {
  const locations: any[] = [];
  for (let i = 0; i < passengerId.length; i++) {
    fetchUser(passengerId[i]).then((data) => {
      if (data) {
        const loc = data.fields.localisation.geoPointValue;
        locations.push(loc);
      }
    });
  }
  return locations;
}

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface RideMapViewProps {
  onPlaceSelect: (name: string, lat: number, lng: number) => void;
  favorites: any[];
  homeLocalisation: { lat: number; lng: number };
  /** Hype-map events; flame marker size scales with each event's score (1–10). */
  events?: HypeEvent[];
  /** Tapping an event marker opens the floating Hype card (not the lift flow). */
  onEventSelect?: (event: HypeEvent) => void;
}

interface DriverRideMapViewProps {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  passengers: string[] | undefined;
  setCoords?: (coords: { latitude: number; longitude: number }[]) => void;
  pendingLocations?: { latitude: number; longitude: number; passengerId: string; avatarUri?: string | null; dropoff?: { latitude: number; longitude: number } }[];
  /** Pickup map keyed by passenger uid — used to draw multi-waypoint polyline. */
  passengerPickups?: Record<string, { latitude: number; longitude: number }>;
  /** Dropoff map keyed by passenger uid — per-passenger dropoff location. */
  passengerDropoffs?: Record<string, { latitude: number; longitude: number }>;
  /** Encoded polyline captured at ride start. When provided the component
   *  decodes and renders it directly — no Google Directions call is made. */
  frozenPolyline?: string;
}

interface UserRideMapViewProps {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  driverLocation?: { latitude: number; longitude: number };
}

const DEFAULT_REGION = {
  latitude: 46.3,
  longitude: -71.2,
  latitudeDelta: 0.9,
  longitudeDelta: 0.9,
};

// ─── DriverRideMapView ────────────────────────────────────────────────────────
export function DriverRideMapView(props: DriverRideMapViewProps) {
  const [routePath, setRoutePath] = useState<{ latitude: number; longitude: number }[]>([]);
  // Track whether we've already decoded a frozen polyline so we don't redo it.
  const frozenDecodedRef = useRef(false);
  const mapRef = useRef<MapView>(null);
  const [mapReady, setMapReady] = useState(false);
  // Signature of the last set of coords we framed — avoids re-fitting (and the
  // camera jump) on every parent re-render when nothing actually moved.
  const lastFitSigRef = useRef("");

  const isReal = (c?: { latitude: number; longitude: number } | null): c is { latitude: number; longitude: number } =>
    !!c && (c.latitude !== 0 || c.longitude !== 0);

  // Read passenger pickup/dropoff markers DIRECTLY off the live ride-doc maps
  // (fed by the onSnapshot listener). Previously these were derived from the
  // `passengers` array through an async state hop, which could silently render
  // nothing if the ordering raced. Rendering straight from the maps means a
  // pickup/dropoff shows the moment the snapshot delivers it.
  const pickups = props.passengerPickups
    ? Object.entries(props.passengerPickups).filter((e): e is [string, { latitude: number; longitude: number }] => isReal(e[1]))
    : [];
  const dropoffs = props.passengerDropoffs
    ? Object.entries(props.passengerDropoffs).filter((e): e is [string, { latitude: number; longitude: number }] => isReal(e[1]))
    : [];

  devLog("[RIDE-DEBUG] mapview markers", {
    pickupsIn: props.passengerPickups ? Object.keys(props.passengerPickups).length : 0,
    dropoffsIn: props.passengerDropoffs ? Object.keys(props.passengerDropoffs).length : 0,
    pickupsRendered: pickups.length,
    dropoffsRendered: dropoffs.length,
    hasFrozenPolyline: !!props.frozenPolyline,
    routePathLen: routePath.length,
  });

  // Collect every meaningful point so the camera can frame them all. Without
  // this the map sat on a fixed wide region and the passenger pickup/dropoff/
  // destination markers were off-screen — appearing as if no data loaded.
  const fitTargets: { latitude: number; longitude: number }[] = [];
  if (isReal(props.origin)) fitTargets.push(props.origin);
  if (isReal(props.destination)) fitTargets.push(props.destination);
  for (const [, l] of pickups) fitTargets.push(l);
  for (const [, l] of dropoffs) fitTargets.push(l);
  for (const l of props.pendingLocations ?? []) if (isReal(l)) fitTargets.push({ latitude: l.latitude, longitude: l.longitude });
  const fitSig = fitTargets.map((c) => `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`).sort().join("|");

  useEffect(() => {
    if (!mapReady || fitTargets.length === 0) return;
    if (fitSig === lastFitSigRef.current) return;
    lastFitSigRef.current = fitSig;
    // Small delay so React commits the marker renders before the camera
    // animation triggers the native snapshot pass for custom-view markers.
    const id = setTimeout(() => {
      if (fitTargets.length === 1) {
        mapRef.current?.animateToRegion(
          { ...fitTargets[0], latitudeDelta: 0.05, longitudeDelta: 0.05 },
          500,
        );
      } else {
        mapRef.current?.fitToCoordinates(fitTargets, {
          edgePadding: { top: 120, right: 60, bottom: 260, left: 60 },
          animated: true,
        });
      }
    }, 200);
    return () => clearTimeout(id);
  // fitTargets is derived from fitSig; depending on the signature keeps deps stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, fitSig]);

  // Polyline: render only when the frozen encoded polyline is provided (post-start).
  // Before the ride starts, no polyline is drawn on the driver map.
  useEffect(() => {
    if (!props.frozenPolyline) return;
    if (frozenDecodedRef.current) return;
    frozenDecodedRef.current = true;
    const decoded = decodePolyline(props.frozenPolyline).map(
      ([lat, lng]) => ({ latitude: lat, longitude: lng }),
    );
    setRoutePath(decoded);
  }, [props.frozenPolyline]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        customMapStyle={DARK_MAP_STYLE}
        onMapReady={() => setMapReady(true)}
      >
        <SnapshottingMarker
          coordinate={{ latitude: props.origin.latitude, longitude: props.origin.longitude }}
          title="Driver"
        >
          <PinMarker icon="home" color={C.blue} />
        </SnapshottingMarker>

        {/* Passenger pickup points (green) */}
        {pickups.map(([uid, loc]) => (
          <SnapshottingMarker
            key={`pickup-${uid}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title="Passenger pickup"
          >
            <PinMarker icon="person" color={C.success} />
          </SnapshottingMarker>
        ))}

        {/* Passenger drop-off points (purple) */}
        {dropoffs.map(([uid, loc]) => (
          <SnapshottingMarker
            key={`dropoff-${uid}`}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title="Passenger drop-off"
          >
            <PinMarker icon="location-sharp" color={C.purple} />
          </SnapshottingMarker>
        ))}

        {props.pendingLocations?.map((loc, index) => (
          <React.Fragment key={`req-${loc.passengerId}`}>
            <Marker
              coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
              title={`Request ${index + 1}`}
            >
              <AvatarPinMarker uri={loc.avatarUri ?? null} color={C.gold} />
            </Marker>
            {loc.dropoff && (
              <SnapshottingMarker
                key={`req-dropoff-${loc.passengerId}`}
                coordinate={{ latitude: loc.dropoff.latitude, longitude: loc.dropoff.longitude }}
                title={`Requested Dropoff ${index + 1}`}
              >
                <PinMarker icon="location-sharp" color={C.gold} />
              </SnapshottingMarker>
            )}
          </React.Fragment>
        ))}

        <SnapshottingMarker
          coordinate={{ latitude: props.destination.latitude, longitude: props.destination.longitude }}
          title="Destination"
        >
          <PinMarker icon="flag" color={C.danger} />
        </SnapshottingMarker>

        {routePath.length > 1 && (
          <Polyline
            coordinates={routePath}
            strokeColor={C.purple}
            strokeWidth={4}
          />
        )}
      </MapView>
    </View>
  );
}

// ─── UserRideMapView ──────────────────────────────────────────────────────────
function UserRideMapViewInner(props: UserRideMapViewProps) {
  const [userlocation, setUserlocation] = useState<{ latitude: number; longitude: number }>();

  useEffect(() => {
    const getLoc = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      setUserlocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    };
    getLoc();
  }, []);

  const driverCoord = props.driverLocation ?? props.origin;

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={DEFAULT_REGION} customMapStyle={DARK_MAP_STYLE}>
        <Marker
          coordinate={{ latitude: driverCoord.latitude, longitude: driverCoord.longitude }}
          title="Driver"
          tracksViewChanges={false}
        >
          <PinMarker icon="car-sport" color={C.success} />
        </Marker>

        {userlocation && (
          <Marker
            coordinate={{ latitude: userlocation.latitude, longitude: userlocation.longitude }}
            title="You"
            tracksViewChanges={false}
          >
            <PinMarker icon="person" color={C.blue} />
          </Marker>
        )}

        <Marker
          coordinate={{ latitude: props.destination.latitude, longitude: props.destination.longitude }}
          title="Destination"
          tracksViewChanges={false}
        >
          <PinMarker icon="flag" color={C.danger} />
        </Marker>
      </MapView>
    </View>
  );
}

export const UserRideMapView = React.memo(UserRideMapViewInner, (prev, next) => {
  return (
    prev.origin.latitude === next.origin.latitude &&
    prev.origin.longitude === next.origin.longitude &&
    prev.destination.latitude === next.destination.latitude &&
    prev.destination.longitude === next.destination.longitude &&
    prev.driverLocation?.latitude === next.driverLocation?.latitude &&
    prev.driverLocation?.longitude === next.driverLocation?.longitude
  );
});

// ─── RideMapView (home screen) ────────────────────────────────────────────────
const RECENTER_THRESHOLD = 0.01; // ~1 km

export default function RideMapView(props: RideMapViewProps) {
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isCentered, setIsCentered] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const initialFitDoneRef = useRef(false);
  const mapRef = useRef<MapView>(null);

  const hasHome = props.homeLocalisation.lat !== 0 || props.homeLocalisation.lng !== 0;

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    })();
  }, []);

  // Once the map is ready and we have at least one point of interest, fit the
  // camera around all known places (once). The animation is also what forces the
  // native layer to re-snapshot custom-view markers that were added after the
  // map's initial render — without it they only appear on user interaction.
  useEffect(() => {
    if (!mapReady || initialFitDoneRef.current) return;

    const coords: { latitude: number; longitude: number }[] = [];
    if (userLocation) coords.push(userLocation);
    if (hasHome) coords.push({ latitude: props.homeLocalisation.lat, longitude: props.homeLocalisation.lng });
    for (const fav of props.favorites) {
      coords.push({ latitude: fav.destinationGeo.lat, longitude: fav.destinationGeo.lon });
    }

    if (coords.length === 0) return;

    initialFitDoneRef.current = true;

    // Small delay so React finishes committing the marker renders before the
    // animation triggers the native snapshot pass.
    const t = setTimeout(() => {
      if (coords.length === 1) {
        mapRef.current?.animateToRegion({
          latitude: coords[0].latitude,
          longitude: coords[0].longitude,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        }, 500);
      } else {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 60, bottom: 220, left: 60 },
          animated: true,
        });
      }
    }, 150);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, userLocation?.latitude, userLocation?.longitude, hasHome, props.favorites.length]);

  const handleRecenter = () => {
    if (!userLocation) return;
    mapRef.current?.animateToRegion({
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 400);
    setIsCentered(true);
  };

  const handleRegionChange = (region: Region) => {
    if (!userLocation) return;
    const latDiff = Math.abs(region.latitude - userLocation.latitude);
    const lngDiff = Math.abs(region.longitude - userLocation.longitude);
    setIsCentered(latDiff < RECENTER_THRESHOLD && lngDiff < RECENTER_THRESHOLD);
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={DEFAULT_REGION}
        customMapStyle={DARK_MAP_STYLE}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChange}
      >
        {/* 1 ── Home ──────────────────────────────────────────────────── */}
        {hasHome && (
          <SnapshottingMarker
            coordinate={{ latitude: props.homeLocalisation.lat, longitude: props.homeLocalisation.lng }}
            title="Home"
            description="Your home location"
            onPress={() => props.onPlaceSelect("home", props.homeLocalisation.lat, props.homeLocalisation.lng)}
          >
            <PinMarker icon="home" color={C.blue} />
          </SnapshottingMarker>
        )}

        {/* 2 ── Live Location ─────────────────────────────────────────── */}
        {userLocation && (
          <SnapshottingMarker
            coordinate={userLocation}
            title="You"
            description="Your current location"
          >
            <PinMarker icon="navigate" color={C.success} />
          </SnapshottingMarker>
        )}

        {/* 3 ── Favorites ─────────────────────────────────────────────── */}
        {props.favorites.map((loc, index) => (
          <SnapshottingMarker
            key={`fav-${loc.destinationGeo.lat}-${loc.destinationGeo.lon}-${index}`}
            coordinate={{ latitude: loc.destinationGeo.lat, longitude: loc.destinationGeo.lon }}
            title={loc.destination}
            description={`Location of ${loc.destination}`}
            onPress={() => props.onPlaceSelect(loc.destination, loc.destinationGeo.lat, loc.destinationGeo.lon)}
          >
            <PinMarker icon="star" color={C.gold} />
          </SnapshottingMarker>
        ))}

        {/* 4 ── Hype Events (flame size scales with score 1–10, renders last = on top) ─ */}
        {props.events?.map((ev) => (
          <SnapshottingMarker
            key={ev.id}
            coordinate={{ latitude: ev.lat, longitude: ev.lng }}
            title={ev.name}
            description={ev.venue}
            onPress={() => props.onEventSelect?.(ev)}
          >
            <PinMarker icon="flame" color={C.fire} size={hypeScoreToIconSize(ev.score)} />
          </SnapshottingMarker>
        ))}
      </MapView>

      {/* ── Recenter button ───────────────────────────────────────────────── */}
      {!isCentered && userLocation && (
        <TouchableOpacity style={styles.recenterBtn} onPress={handleRecenter} activeOpacity={0.8}>
          <Ionicons name="locate" size={18} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  // Fill the parent container rather than the whole window so the map renders
  // correctly whether it's full-screen (ride screens) or a shorter panel
  // (driver ready-to-start). Full-screen parents are flex:1, so this still
  // fills the screen there.
  map: { ...StyleSheet.absoluteFillObject },
  recenterBtn: {
    position: "absolute",
    bottom: 150,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#8938D5",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#8938D5",
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});
