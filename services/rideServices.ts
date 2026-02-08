import { getAuth } from "firebase/auth";
import { GeoPoint } from "firebase/firestore";

const PROJECT_ID = "unilift-6e756"; // your Firebase project id
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/uniliftdefault/documents/rides`;

const API_KEY = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q"

/** Create a new ride */
export async function createRide(rideData: {
  
  destination: string;
  date: string;
  seatsAvailable: number;
  geopoint: GeoPoint;
  destinationCoords: {lat:number|undefined, lng:number|undefined};
  started: boolean;
}) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const doc = {
    fields: {
      driverId: { stringValue: user.uid },
      localisation: {geoPointValue: {"latitude": rideData.geopoint.latitude, "longitude": rideData.geopoint.longitude}},
      
      destination: { stringValue: rideData.destination },
      destinationCoords: {geoPointValue: {"latitude": rideData.destinationCoords.lat, "longitude": rideData.destinationCoords.lng}},
      started: {booleanValue: rideData.started},
      status: {stringValue: "planned"}, //planned, started, arrived ==> delete ? 

      
      seatsAvailable: { integerValue: rideData.seatsAvailable },
      date: { timestampValue: rideData.date },
      
      passengers: { arrayValue: { values: [] } },
      //createdAt: { timestampValue: new Date().toISOString() },
    },
  };
  console.log(doc)

  const res = await fetch(`${BASE_URL}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  console.log(res)

  if (!res.ok) throw new Error("Failed to create ride");
  return await res.json();
}

/** Fetch all available rides */
export async function fetchRides() {
  const res = await fetch(`${BASE_URL}?key=${API_KEY}`);
  if (!res.ok) throw new Error("Failed to fetch rides");
  const data = await res.json();
  console.log(data)

  return data.documents?.map((doc: any) => ({
    id: doc.name.split("/").pop(),
    //origin: doc.fields.origin.stringValue,
    destination: doc.fields.destination.stringValue,
    destinationCoords: doc.fields?.destinationCoords?.geoPointValue || {latitude: 0, longitude: 0},
    date: doc.fields.date?.timestampValue,
    seatsAvailable: Number(doc.fields.seatsAvailable.integerValue),
    time: doc.createdTime,
    
    driverId: doc.fields.driverId.stringValue,
    passengers: doc.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [],
    localisation: doc.fields.localisation.geoPointValue,
    started: doc.fields.started?.booleanValue,
    status:doc.fields.status?.stringValue
  })) || [];
}

/** Accept (join) a ride */
export async function acceptRide(rideId: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const rideUrl = `${BASE_URL}/${rideId}?key=${API_KEY}&updateMask.fieldPaths=passengers,seatsAvailable`;

  // Get current passengers
  const rideRes = await fetch(rideUrl);
  const rideData = await rideRes.json();

  const currentPassengers =
    rideData.fields.passengers.arrayValue?.values?.map((v: any) => v.stringValue) || [];

  // Add this user
  if (currentPassengers.includes(user.uid)) return rideData; // already joined

  currentPassengers.push(user.uid);

  const updateDoc = {
    fields: {

      passengers: {
        arrayValue: { values: currentPassengers.map((id: string) => ({ stringValue: id })) },
      },
      seatsAvailable: {
        integerValue: Number(rideData.fields.seatsAvailable.integerValue - 1)
      }
    },
  };

  const updateRes = await fetch(rideUrl, { //+ `?key=${API_KEY}`
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateDoc),
  });

  if (!updateRes.ok) throw new Error("Failed to accept ride");
  return await updateRes.json();
}

/** Delete ride (if you’re the driver) */
export async function deleteRide(rideId: string) {
  const res = await fetch(`${BASE_URL}/${rideId}?key=${API_KEY}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete ride");
}

export async function geoCode(place:string) {
  try {
    // Encode the place name so it can safely be used in a URL
    const encodedPlace = encodeURIComponent(place);

    // Nominatim (OpenStreetMap) geocoding endpoint
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedPlace}&format=json&limit=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "UniLift/1.0"  // Nominatim requires a user-agent
      }
    });

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

    const data = await response.json();

    if (data.length === 0) {
      return null; // No results found
    }

    // Extract latitude and longitude from the first result
    const { lat, lon } = data[0];

    return {
      latitude: Number(lat),
      longitude: Number(lon)
    };
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
}

export type LocationResult = {
  displayName: string;
  lat: string;
  lon: string;
};

export async function geoSuggestion(place:string) {
   //if (!place.trim()) return [];
   console.log(place)

  try {
    // Encode the place name so it can safely be used in a URL
    const encodedPlace = encodeURIComponent(place);

    // Nominatim (OpenStreetMap) geocoding endpoint
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedPlace}&format=json&addressdetails=1&limit=5&viewbox=-79.7624,62.5854,-57.1056,44.9917&bounded=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "UniLift/1.0"  // Nominatim requires a user-agent
      }
    });

    if (!response.ok) {
      throw new Error("Network response was not ok");
    }

   const data = await response.json();
   

  return data.map((item: any) => ({
    displayName: item.display_name,
    lat: item.lat,
    lon: item.lon,
  }));
  } catch (error) {
    console.error("Error fetching coordinates:", error);
    return null;
  }
}

export async function updateRatings(rideId: string, rating: number) {
  //get driver id from rideId
   const res = await fetch(`${BASE_URL}/${rideId}?key=${API_KEY}`);
  if (!res.ok) throw new Error("Failed to fetch rides");
  const data = await res.json();
  console.log(data)

  const driverId = data.fields.driverId.stringValue;
  //update driver's ratings in users collection
  const userUrl = `https://firestore.googleapis.com/v1/projects/unilift-6e756/databases/uniliftdefault/documents/users/${driverId}?key=${API_KEY}`;
  const userRes = await fetch(userUrl);
  const userData = await userRes.json();
  let currentRatings = userData.fields.ratings?.integerValue || 0;
  let numberOfRatings = userData.fields.ratingWeigth?.integerValue || 0;
  const newRatings = ((currentRatings * numberOfRatings) + rating) / (Number(numberOfRatings) + 1);
  const updateDoc = {
    fields: {
      ratings: {integerValue: Math.round(newRatings)},
      ratingWeigth: {integerValue: Number(numberOfRatings) + 1}
    },
  };
  const updateRes = await fetch(`${userUrl}&?updateMask.fieldPaths=ratings,ratingWeigth`, { //+ `?key=${API_KEY}`
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateDoc),
  });
  if (!updateRes.ok) throw new Error("Failed to update ratings");
  return driverId;

}

export async function updateXP(userId: string, driverId: string, xpToAdd: number) {
  //update user's XP in users collection
  const userUrl = `https://firestore.googleapis.com/v1/projects/unilift-6e756/databases/uniliftdefault/documents/users/${userId}?key=${API_KEY}`;
  const userRes = await fetch(userUrl);
  const userData = await userRes.json();
  let currentXP = userData.fields.xp?.integerValue || 0;
  const newXP = Number(currentXP) +  Math.floor(xpToAdd / 2);;
  const updateDoc = {
    fields: {
      xp: {integerValue: newXP}
    },
  };
  const updateRes = await fetch(`${userUrl}&updateMask.fieldPaths=xp`, { //+ `?key=${API_KEY}`
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateDoc),
  });
  if (!updateRes.ok) throw new Error("Failed to update XP");

  const driverUrl = `https://firestore.googleapis.com/v1/projects/unilift-6e756/databases/uniliftdefault/documents/users/${driverId}?key=${API_KEY}`;
  const driverRes = await fetch(driverUrl);
  const driverData = await driverRes.json();
  let driverXP = driverData.fields.xp?.integerValue || 0;
  const newDriverXP = Number(driverXP) + xpToAdd

  const updateDriverDoc = {
    fields: {
      xp: {integerValue: newDriverXP}
    },
  };
  const updateDriverRes = await fetch(`${driverUrl}&updateMask.fieldPaths=xp`, { //+ `?key=${API_KEY}`
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateDriverDoc),
  });
  if (!updateDriverRes.ok) throw new Error("Failed to update driver XP");
  return;
}

