import * as Location from "expo-location";
import {
  firestoreDocumentUrl,
  runtimeConfig,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

// ─── Design Tokens ───────────────────────────────────────────────────────────
const C = {
  purple:  "#7C3AED",
  gold:    "#fbbf24",
  success: "#34d399",
  danger:  "#f87171",
  blue:    "#3b82f6",
  white:   "#ffffff",
  bg:      "#080810",
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

// ─── Styled Markers ───────────────────────────────────────────────────────────
function PinMarker({ icon, color, size = 18 }: { icon: string; color: string; size?: number }) {
  return (
    <View style={[m.pin, { borderColor: color, shadowColor: color }]}>
      <Ionicons name={icon as any} size={size} color={color} />
      <View style={[m.pinTip, { backgroundColor: color }]} />
    </View>
  );
}

const m = StyleSheet.create({
  pin: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#0f0f1e",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  pinTip: {
    position: "absolute",
    bottom: -7,
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.85,
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
    if (!res.ok) { console.log(res); return; }
    const data = await res.json();
    console.log("Firestore user data:", JSON.stringify(data.fields.localisation));
    return data;
  } catch (err) {
    console.error(err);
  }
}

async function getPathForRide(origin: number[], destination: number[]) {
  const url = "https://api.openrouteservice.org/v2/directions/driving-car/json";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: runtimeConfig.orsApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [origin, destination] }),
    });
    return await res.json();
  } catch (e) {
    console.error("ORS error:", e);
    return null;
  }
}

function getPassengerPath(passengerId: string[]) {
  const locations: any[] = [];
  for (let i = 0; i < passengerId.length; i++) {
    fetchUser(passengerId[i]).then((data) => {
      if (data) {
        const loc = data.fields.localisation.geoPointValue;
        locations.push(loc);
        console.log(`Passenger ${passengerId[i]} location:`, loc);
      } else {
        console.log(`No data for passenger ${passengerId[i]}`);
      }
    });
  }
  return locations;
}

// ─── Interfaces ──────────────────────────────────────────────────────────────
interface RideMapViewProps {
  onPlaceSelect: (name: string, lat: number, lng: number) => void;
  placeLocalisations: any[];
  favorites: any[];
  homeLocalisation: { lat: number; lng: number };
}

interface DriverRideMapViewProps {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  passengers: string[] | undefined;
  setCoords?: (coords: { latitude: number; longitude: number }[]) => void;
}

interface UserRideMapViewProps {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
}

const DEFAULT_REGION = {
  latitude: 46.3,
  longitude: -71.2,
  latitudeDelta: 0.9,
  longitudeDelta: 0.9,
};

// ─── DriverRideMapView ────────────────────────────────────────────────────────
export function DriverRideMapView(props: DriverRideMapViewProps) {
  const [passengerLocations, setPassengerLocations] = useState<any[]>([]);

  useEffect(() => {
    const fetchRoute = async () => {
      if (!props.passengers || props.passengers.length === 0) return;
      const data = await getPassengerPath(props.passengers);
      if (data) {
        setPassengerLocations(data);
        props.setCoords?.(data);
      }
    };
    fetchRoute();
  }, [props.passengers]);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={DEFAULT_REGION} customMapStyle={DARK_MAP_STYLE}>
        <Marker
          coordinate={{ latitude: props.origin.latitude, longitude: props.origin.longitude }}
          title="Origin"
        >
          <PinMarker icon="home" color={C.blue} />
        </Marker>

        {passengerLocations.map((loc, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={`Passenger ${index + 1}`}
          >
            <PinMarker icon="person" color={C.success} />
          </Marker>
        ))}

        <Marker
          coordinate={{ latitude: props.destination.latitude, longitude: props.destination.longitude }}
          title="Destination"
        >
          <PinMarker icon="flag" color={C.danger} />
        </Marker>
      </MapView>
    </View>
  );
}

// ─── UserRideMapView ──────────────────────────────────────────────────────────
export function UserRideMapView(props: UserRideMapViewProps) {
  const [userlocation, setUserlocation] = useState<{ latitude: number; longitude: number }>();

  useEffect(() => {
    const getLoc = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const pos = await Location.getCurrentPositionAsync({});
      setUserlocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    };
    getLoc();
    console.log(props.origin);
  }, []);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} region={DEFAULT_REGION} customMapStyle={DARK_MAP_STYLE}>
        <Marker
          coordinate={{ latitude: props.origin.latitude, longitude: props.origin.longitude }}
          title="Driver"
        >
          <PinMarker icon="car-sport" color={C.success} />
        </Marker>

        {userlocation && (
          <Marker
            coordinate={{ latitude: userlocation.latitude, longitude: userlocation.longitude }}
            title="You"
          >
            <PinMarker icon="person" color={C.blue} />
          </Marker>
        )}

        <Marker
          coordinate={{ latitude: props.destination.latitude, longitude: props.destination.longitude }}
          title="Destination"
        >
          <PinMarker icon="flag" color={C.danger} />
        </Marker>
      </MapView>
    </View>
  );
}

// ─── RideMapView (home screen) ────────────────────────────────────────────────
export default function RideMapView(props: RideMapViewProps) {
  const [routeCoords, setRouteCoords] = useState<{ latitude: any; longitude: any }[]>([]);

  useEffect(() => {
    const fetchRoute = async () => {
      const origin = [-73.5673, 45.5017];
      const destination = [-71.283689, 46.7899];
      const data = await getPathForRide(origin, destination);
      if (data) {
        const geometry = data.routes[0].geometry;
        const decoded = decodePolyline(geometry);
        setRouteCoords(decoded.map(point => ({ latitude: point[0], longitude: point[1] })));
      }
    };
    //fetchRoute();
  }, []);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} initialRegion={DEFAULT_REGION} customMapStyle={DARK_MAP_STYLE}>
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeWidth={4} strokeColor={C.purple} />
        )}

        {props.placeLocalisations.map((loc, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            title={loc.name}
            description={`Location of ${loc.name}`}
            onPress={() => props.onPlaceSelect(loc.name, loc.lat, loc.lng)}
          >
            <PinMarker icon="location" color={C.purple} />
          </Marker>
        ))}

        {props.favorites.map((loc, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: loc.destinationGeo.lat, longitude: loc.destinationGeo.lon }}
            title={loc.destination}
            description={`Location of ${loc.destination}`}
            onPress={() => props.onPlaceSelect(loc.destination, loc.destinationGeo.lat, loc.destinationGeo.lon)}
          >
            <PinMarker icon="star" color={C.gold} />
          </Marker>
        ))}

        {props.homeLocalisation && (
          <Marker
            coordinate={{ latitude: props.homeLocalisation.lat, longitude: props.homeLocalisation.lng }}
            title="Home"
            description="Your home location"
            onPress={() => props.onPlaceSelect("home", props.homeLocalisation.lat, props.homeLocalisation.lng)}
          >
            <PinMarker icon="home" color={C.blue} />
          </Marker>
        )}
      </MapView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  map: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
  },
});
