
import * as Location from "expo-location";
import {
  firestoreDocumentUrl,
  runtimeConfig,
  withFirebaseApiKey,
} from "@/constants/runtime-config";
import React, { useEffect, useState } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";

//import { PolyUtil } from "leaflet";
//import polyline from "@mapbox/polyline";
//import PolylineDirection from "@react-native-maps/polyline-direction";

//<Text style={styles.text}>🗺️ Map preview not available on web</Text>
//style={styles.placeholder}

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

    const deltaLat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const deltaLng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    path.push([
       lat / 1e5,
     lng / 1e5,
    ]);
  }

  return path;
}

interface RideMapViewProps {
 onPlaceSelect: (name: string, lat:number, lng:number) => void;
 placeLocalisations: any[];
 favorites: any[];
 homeLocalisation: {lat:number, lng:number}


}

interface DriverRideMapViewProps {
 origin: { latitude: number; longitude: number };
 destination: { latitude: number; longitude: number };
 passengers: string[] | undefined;
 setCoords?: (coords: {latitude: number, longitude: number}[]) => void;

}

interface UserRideMapViewProps {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
}
async function fetchUser(uid:string) {
  const url = withFirebaseApiKey(firestoreDocumentUrl("users", uid));
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(res)
    } else {
       const data = await res.json();
    console.log("Firestore user data:", JSON.stringify(data.fields.localisation));
    return data
    }
   
  } catch (err) {
    console.error(err);
  }
}

    async function getPathForRide(origin: number[], destination: number[]) {
       const url = "https://api.openrouteservice.org/v2/directions/driving-car/json";
  
    const body = {
      coordinates: [origin, destination]
    };
  
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": runtimeConfig.orsApiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
  
      const data = await res.json();
      return data;
    } catch (e) {
      console.error("ORS error:", e);
      return null;
    }
    }

function getPassengerPath(passengerId: string[]) { //, origin: { latitude: any; longitude: any }, destination: { latitude: any; longitude: any }
  let locations: any[] = []
  for (let i = 0; i < passengerId.length; i++) {
    // fetch localisation for each passenger
    fetchUser(passengerId[i]).then((data) => {
      if (data) {
        const loc = data.fields.localisation.geoPointValue;
        locations.push(loc);
        console.log(`Passenger ${passengerId[i]} location:`, loc);
      } else {
        console.log(`No data for passenger ${passengerId[i]}`);
      }

  });}

  //calculate path using ORS API, for the following points: origin, locations[], destination
  /*let pathPoints: any[] = []
  for (let j = 0; j < locations.length; j++) {
    console.log(`Calculating path for passenger ${passengerId[j]}`);
    if (j === 0) {
      //origin to first passenger
      getPathForRide([origin.latitude, origin.longitude], [locations[j].latitude, locations[j].longitude]).then((path) => {
        const geometry = path.routes[0].geometry;
        //console.log("Geometry:", geometry);

        const decoded = decodePolyline(geometry)
        //console.log("Decoded polyline:", decoded);

        // convert [lng, lat] → {latitude, longitude}
        const converted = decoded.map(point => ({
          latitude: point[0],
          longitude: point[1],
        }));
        pathPoints.push(...converted);
      });
      //pathPoints.push(path);
    } else if (j === locations.length - 1) {
      //last passenger to destination
      getPathForRide([locations[j].latitude, locations[j].longitude], [destination.latitude, destination.longitude]).then((path) => {
        const geometry = path.routes[0].geometry;
        //console.log("Geometry:", geometry);

        const decoded = decodePolyline(geometry)
        //console.log("Decoded polyline:", decoded);

        // convert [lng, lat] → {latitude, longitude}
        const converted = decoded.map(point => ({
          latitude: point[0],
          longitude: point[1],
        }));
        pathPoints.push(...converted);
      });
      //pathPoints.push(path);
    } else {
      //between passengers
      getPathForRide([locations[j-1].latitude, locations[j-1].longitude], [locations[j].latitude, locations[j].longitude]).then((path) => {
        const geometry = path.routes[0].geometry;
        //console.log("Geometry:", geometry);

        const decoded = decodePolyline(geometry)
        //console.log("Decoded polyline:", decoded);

        // convert [lng, lat] → {latitude, longitude}
        const converted = decoded.map(point => ({
          latitude: point[0],
          longitude: point[1],
        }));
        pathPoints.push(...converted);
      });
      //pathPoints.push(path);
    }
  }*/

  return locations;
    





}


//same as RideMapView but with different markers for driver view
//goal: show origin, destination, and all passenger locations with markers
export function DriverRideMapView(props:DriverRideMapViewProps) { //onRideSelect: any
    //const [routeCoords, setRouteCoords] = useState<any[]>([]); //{ latitude: any; longitude: any }
    const [passengerLocations, setPassengerLocations] = useState<any[]>([]);

  const region = {
    latitude: 46.3,
    longitude: -71.2,
    latitudeDelta: 0.9,
    longitudeDelta: 0.9,
  };

  useEffect(() => {
    const fetchRoute = async () => {
      
      if (!props.passengers || props.passengers.length === 0) {
        console.log("No passengers provided");
        return;
      }
      const data = await getPassengerPath(props.passengers); //, props.origin, props.destination);
      //console.log("Route data:", data);

      if (data) {
        console.log("Passenger locations data:", data);
        setPassengerLocations(data);
        props.setCoords ? props.setCoords(data) : null;
        
        //setRouteCoords(data.points);
      }
    };

    fetchRoute();
  }, [props.passengers]);
  

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={region}
      >
        {/*routeCoords.length > 0 && (
        <Polyline
          coordinates={routeCoords}
          strokeWidth={5}
          strokeColor="blue"
        />
      )*/}

      <Marker
            key={"driver"}
            coordinate={{ latitude: props.origin.latitude, longitude: props.origin.longitude }}
            title={`origin`}
            description={`Location of origin`}
            onPress={() => {}}
          >
            <View style={{
    backgroundColor: 'blue',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🏠</Text>
  </View> 
          </Marker>
          
        
      

        {passengerLocations.map((loc, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: loc.latitude, longitude: loc.longitude }}
            title={`Ride ${index + 1}`}
            description={`Location of ride ${index + 1}`}
            onPress={() => {}}
          >
            <View style={{
    backgroundColor: 'green',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🚗</Text>
  </View> 
          </Marker>
          
        ))}

        <Marker
            key={"destination"}
            coordinate={{ latitude: props.destination.latitude, longitude: props.destination.longitude }}
            title={`origin`}
            description={`Location of origin`}
            onPress={() => {}}
          >
            <View style={{
    backgroundColor: 'red',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🏁</Text>
  </View> 
          </Marker>

        
        {/*<Marker
          coordinate={{ latitude: 37.78825, longitude: -122.4324 }}
          title="My Marker"
          description="This is a marker example"

        />*/}
      </MapView>
    </View>
  );
}

export function UserRideMapView(props:UserRideMapViewProps) { //onRideSelect: any
    //const [routeCoords, setRouteCoords] = useState<any[]>([]); //{ latitude: any; longitude: any }
    const [userlocation, setUserlocation] = useState<{ latitude: number; longitude: number }>();

   
     useEffect(() => {
    const getLoc = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;
    const pos = await Location.getCurrentPositionAsync({});
    setUserlocation({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });
  };
  getLoc();
  console.log(props.origin)
  }, [])


  const region = {
    latitude: 46.3,
    longitude: -71.2,
    latitudeDelta: 0.9,
    longitudeDelta: 0.9,
  };
  

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        region={region}
      >
  <Marker
            key={"driver"}
            coordinate={{
  latitude: props.origin.latitude,
  longitude: props.origin.longitude,
}}
            title={`Driver`}
            description={`Location of Driver`}
            onPress={() => {}}
          >
            <View style={{
    backgroundColor: 'Green',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🚗</Text>
  </View> 
          </Marker>

{userlocation ? (
      <Marker
            key={"user"}
            coordinate={{ latitude: userlocation.latitude, longitude: userlocation.longitude }}
            title={`origin`}
            description={`Location of origin`}
            onPress={() => {}}
          >
            <View style={{
    backgroundColor: 'blue',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🏠</Text>
  </View> 
          </Marker>) : ""}
          
        
      

        

        <Marker
            key={"destination"}
            coordinate={{
  latitude: props.destination.latitude,
  longitude: props.destination.longitude,
}}
            title={`Destination`}
            description={`Location of Destination`}
            onPress={() => {}}
          >
            <View style={{
    backgroundColor: 'red',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🏁</Text>
  </View> 
          </Marker>

        
        {/*<Marker
          coordinate={{ latitude: 37.78825, longitude: -122.4324 }}
          title="My Marker"
          description="This is a marker example"

        />*/}
      </MapView>
    </View>
  );
}

export default function RideMapView(props:RideMapViewProps) { //onRideSelect: any
    const [routeCoords, setRouteCoords] = useState<{ latitude: any; longitude: any }[]>([]);

  const region = {
    latitude: 46.3,
    longitude: -71.2,
    latitudeDelta: 0.9,
    longitudeDelta: 0.9,
  };




  useEffect(() => {
    const fetchRoute = async () => {
      const origin = [-73.5673, 45.5017];      // Montreal
      const destination = [-71.283689, 46.7899]; // Laval

      const data = await getPathForRide(origin, destination);
      console.log("Route data:", data);

      if (data) {
        const geometry = data.routes[0].geometry;
        console.log("Geometry:", geometry);

        const decoded = decodePolyline(geometry)
        console.log("Decoded polyline:", decoded);

        // convert [lng, lat] → {latitude, longitude}
        const converted = decoded.map(point => ({
          latitude: point[0],
          longitude: point[1],
        }));
        
        setRouteCoords(converted);
      }
    };

    //fetchRoute();
  }, []);
  

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        initialRegion={region}
      >
        {routeCoords.length > 0 && (
        <Polyline
          coordinates={routeCoords}
          strokeWidth={5}
          strokeColor="blue"
        />
      )}

        
        {props.placeLocalisations.map((loc, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: loc.lat, longitude: loc.lng }}
            title={`${loc.name}`}
            description={`Location of ${loc.name}`}
            onPress={() => props.onPlaceSelect(loc.name, loc.lat, loc.lng)}
          >
            <View style={{
    backgroundColor: 'purple',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🎉</Text>
  </View> 
          </Marker>
          
        ))}
        {props.favorites.map((loc, index) => (
          <Marker
            key={index}
            coordinate={{ latitude: loc.destinationGeo.lat, longitude: loc.destinationGeo.lon }}
            title={`${loc.destination}`}
            description={`Location of ${loc.destination}`}
            onPress={() => props.onPlaceSelect(loc.destination, loc.destinationGeo.lat, loc.destinationGeo.lon)}
          >
            <View style={{
    backgroundColor: 'yellow',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>⭐</Text>
  </View> 
          </Marker>
          
        ))}

        {props.homeLocalisation &&  <Marker
            key={99}
            coordinate={{ latitude: props.homeLocalisation.lat, longitude: props.homeLocalisation.lng }}
            title={`Home`}
            description={`Location of your home`}
            
         onPress={() => props.onPlaceSelect("home", props.homeLocalisation.lat, props.homeLocalisation.lng)}
          >{/* onPress={() => props.onRideSelect(`ride-${index + 1}`)} */}
            <View style={{
    backgroundColor: 'blue',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  }}>
    <Text style={{ color: 'white' }}>🏠</Text>
  </View> 
          </Marker>}
        {/*<Marker
          coordinate={{ latitude: 37.78825, longitude: -122.4324 }}
          title="My Marker"
          description="This is a marker example"

        />*/}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
});
