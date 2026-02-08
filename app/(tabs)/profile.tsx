
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
//import { useTailwind } from "nativewind";
import { useAuth } from '@/context/AuthContext';
import { auth } from "@/firebaseConfig";
import * as Location from "expo-location";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

import FavoriteRouteCard from "@/components/favorite-rides";
import FavoriteRouteForm from "@/components/favoriteForm";
import { Alert, StyleSheet, TextInput, TouchableOpacity, } from "react-native";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { fetchRides } from "@/services/rideServices";

import { fetchAndSyncUserData } from "@/components/userHelper";
import { useRouter } from 'expo-router';

import * as AppleAuthentication from "expo-apple-authentication";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import { GoogleAuthProvider, OAuthProvider, signInWithCredential } from "firebase/auth";

WebBrowser.maybeCompleteAuthSession();


//import SignupScreen from "../signup";
interface Achievement {
  icon: any;
  title: string;
  description: string;
  unlocked: boolean;
}

interface StatCardProps {
  value: number | string;
  label: string;
  color: string;
}

const projectId = "unilift-6e756";

const apiKey = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q"; // from Firebase console




async function fetchUser(uid:string) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}?key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(res)
    } else {
       const data = await res.json();
    console.log("Firestore user data:", JSON.stringify(data.fields.avatar?.stringValue));
    return data
    }
   
  } catch (err) {
    console.error(err);
  }
}




const ProfileScreen = () => {
  //const { tw } = useTailwind();
  //const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);//{email: "hbaril@icloud.com", xp:0, rating:5, level:0, totalRides:5, achievements: []}
  const {user, loading} = useAuth()
  const [initialData, setInitialData] = useState<any>();
  //const [avatar, setAvatar] = useState<string>("")

  const [modifyFavorite, setModifyFavorite] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [homeAddress, setHomeAddress] = useState("")

  const [rides, setRides] = useState<any>()

  const router = useRouter();


  async function uploadUserData(token:string, uid: string, fields:any) {
  try {
   
    
    // Firestore document path
    const docPath = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}`;
    /*console.log("uploading to", docPath)
    console.log("token:", token)*/

    // Firestore REST API expects a `fields` object with type wrappers
   

    // Send PATCH request to create or update the document
    const res = await fetch(`${docPath}?key=${apiKey}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify( {fields: fields} ),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }

    const data = await res.json();
    console.log("✅ User data uploaded:", data);
    /*setUserData({
      email: fields.email.stringValue,
      xp: fields.xp.integerValue,
      rating: fields.rating.integerValue,

      ridesCompleted: fields.ridesCompleted.integerValue,


      
    })*/
    return data;
  } catch (error) {
    console.error("❌ Error uploading user data:", error);
    throw error;
  }
}
async function pickImage() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alert("Permission denied.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });

    if (!result.canceled) {
      const uri = result.assets[0].uri;
      //console.log(uri)
      await uploadImage(uri);
    }
}
async function uploadImage(uri:string) {
  if(!user) {
    console.log("no user")
    return
  }

  const token = await user.getIdToken()
  //console.log(token)
  

    const converted = await ImageManipulator.manipulateAsync(
    uri,
    [],
    { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
  );

  const blob = await (await fetch(converted.uri)).blob();
  console.log(blob.type)

const metadata = {
  //name: `profiles/${user.uid}.jpg`,
  contentType: blob.type,
};

const startRes = await fetch(
  `https://firebasestorage.googleapis.com/v0/b/unilift-6e756.firebasestorage.app/o?uploadType=resumable&name=profiles/${user.uid}.jpg`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({contentType: "image/jpeg",}),
  }
);

//console.log(startRes)

//const data = await startRes.text()

//console.log(data)

const uploadUrl = await startRes.headers.get("X-Goog-Upload-URL");
console.log(uploadUrl)

if(uploadUrl) {
  //console.log(uploadUrl)
  const res = await fetch(uploadUrl, {
  method: "PUT",
  headers: {
    "Content-Type": "image/jpeg",
    "X-Goog-Upload-Command": "upload, finalize",
    "X-Goog-Upload-Offset": "0"
  },
  body: blob,
});
const data = await res.json()
console.log(data)

const downloadURL = `https://firebasestorage.googleapis.com/v0/b/unilift-6e756.firebasestorage.app/o/profiles%2F${user.uid}.jpg?alt=media&token=${data.downloadTokens}`; //add token = apikey when fetching 

const res2 = await fetch(
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${user.uid}?updateMask.fieldPaths=avatar`,
  {
    method: "PATCH",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        avatar: { stringValue: downloadURL },
      },
    }),
  }
);
const data2 = await res2.json()
console.log(data2)

console.log("updated picture")
alert("Profile picture updated!")
onRefresh()

}



}

async function getUserLocation() {
        // Ask permission
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
            throw new Error("Location permission denied");
        }

        // Get coordinates
        const pos = await Location.getCurrentPositionAsync({});
        
        return {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
        };
    }

  async function updateLoc(token:string, uid:string, data:any) {
     try {

      /**
       * const res2 = await fetch(
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${user.uid}?updateMask.fieldPaths=avatar`,
  {
    method: "PATCH",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        avatar: { stringValue: downloadURL },
      },
    }),
  }
);
const data2 = await res2.json()
       */
   
    
    // Firestore document path
    const docPath = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}?updateMask.fieldPaths=localisation`;

    // Firestore REST API expects a `fields` object with type wrappers
   

    // Send PATCH request to create or update the document
    const res = await fetch(`${docPath}`, { //?key=${apiKey}
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify( {fields: {
        localisation: { geoPointValue: {"latitude": data.latitude, "longitude": data.longitude} }
      }} ),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }

    const data2 = await res.json();
    console.log("✅ User data uploaded:", data2);
   
    //return data;
  } catch (error) {
    console.error("❌ Error uploading user data:", error);
    throw error;
  }
  }

  async function updateFavoriteRoutes(token:string, uid:string, data:any) {
     try {
   
    
    // Firestore document path
    const docPath = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${uid}?updateMask.fieldPaths=favorite`;

    // Firestore REST API expects a `fields` object with type wrappers
   

    // Send PATCH request to create or update the document
    const res = await fetch(`${docPath}`, { //?key=${apiKey}
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify( {fields: {
        favorite: data.favorite
      }} ),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }

    const data2 = await res.json();
    console.log("✅ User data uploaded:", data2);
   
    //return data;
  } catch (error) {
    console.error("❌ Error uploading user data:", error);
    throw error;
  }
  }
  async function handleNewHomeAddress() {
     try {
   const token = await user?.getIdToken()

    
    // Firestore document path
    const docPath = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/users/${user?.uid}?updateMask.fieldPaths=homeAddress`;

    // Firestore REST API expects a `fields` object with type wrappers
   

    // Send PATCH request to create or update the document
    const res = await fetch(`${docPath}`, { //?key=${apiKey}
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify( {fields: {
        homeAddress: {stringValue: homeAddress}
      }} ),
    });

    if (!res.ok) {
      const errorText = await res.text();
      //setErrors(errorText)
      throw new Error(`Failed to upload user data: ${errorText}`);
    }

    const data2 = await res.json();
    console.log("✅ User data uploaded:", data2);
    alert("Updated your home address!")
    setHomeAddress("")
    //fetchUserData()
    onRefresh()
    //return data;
  } catch (error) {
    console.error("❌ Error uploading user data:", error);
   setErrors(errors)
  }
  }
 

  function SignupScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  /* ---------------------------- GOOGLE AUTH ---------------------------- */

  const [request, response, promptAsync] = Google.useAuthRequest({
    
    iosClientId: "YOUR_IOS_CLIENT_ID.apps.googleusercontent.com",
    androidClientId: "YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com",
  });

  useEffect(() => {
    if (response?.type === "success") {
      handleGoogleSignIn(response.authentication?.idToken);
    }
  }, [response]);

  const handleGoogleSignIn = async (idToken?: string) => {
    if (!idToken) return;

    try {
      setLoading(true);
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);

      await ensureUserProfile(result.user);
      onRefresh();
    } catch (err: any) {
      Alert.alert("Google Sign-In failed", err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ----------------------------- APPLE AUTH ----------------------------- */

  const handleAppleSignIn = async () => {
    try {
      setLoading(true);

      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        ],
      });

      const provider = new OAuthProvider("apple.com");
      const credential = provider.credential({
        idToken: appleCredential.identityToken!,
      });

      const result = await signInWithCredential(auth, credential);

      await ensureUserProfile(result.user);
      onRefresh();
    } catch (err: any) {
      if (err.code !== "ERR_CANCELED") {
        Alert.alert("Apple Sign-In failed", err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------ EMAIL / PASSWORD AUTH ----------------------- */

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please fill all fields");
      return;
    }

    try {
      setLoading(true);

      let user;
      if (isLogin) {
        const res = await signInWithEmailAndPassword(auth, email, password);
        user = res.user;
      } else {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        user = res.user;
        await ensureUserProfile(user);
      }

      onRefresh();
    } catch (error: any) {
      Alert.alert("Authentication Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  /* ------------------------ FIRESTORE PROFILE -------------------------- */

  const ensureUserProfile = async (user: any) => {
    const token = await user.getIdToken();

    const fields = {
      email: { stringValue: user.email },
      xp: { integerValue: 0 },
      rating: { integerValue: 5 },
      ridesCompleted: { integerValue: 0 },
      avatar: { nullValue: null },
      homeAddress: { nullValue: null },
      favorite: { arrayValue: { values: [] } },
    };

    await uploadUserData(token, user.uid, fields);
  };

  /* ------------------------------- UI --------------------------------- */

  return (
    <View style={styles1.container}>
      <Text style={styles1.title}>
        {isLogin ? "Welcome back" : "Create your account"}
      </Text>

      <TextInput
        placeholder="Email"
        placeholderTextColor="#aaa"
        style={styles1.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />

      <TextInput
        placeholder="Password"
        placeholderTextColor="#aaa"
        style={styles1.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles1.button} onPress={handleAuth} disabled={loading}>
        <Text style={styles1.buttonText}>
          {loading ? "Loading..." : isLogin ? "Log In" : "Sign Up"}
        </Text>
      </TouchableOpacity>

      {/* -------- OAuth Buttons -------- */}

      {/*<TouchableOpacity
        style={[styles1.button, { backgroundColor: "#fff" }]}
        onPress={() => promptAsync()}
        disabled={!request}
      >
        <Text style={{ color: "#000", fontWeight: "600" }}>
          Continue with Google
        </Text>
      </TouchableOpacity>*/}

      {AppleAuthentication.isAvailableAsync() && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={8}
          style={{ width: "100%", height: 50, marginTop: 10 }}
          onPress={handleAppleSignIn}
        />
      )}

      <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
        <Text style={styles1.switchText}>
          {isLogin ? "Don't have an account? Sign up" : "Already have an account? Log in"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}


type Ride = {
  id: string;
  date: string; // ISO string: "2025-12-15"
  destination: string;
  localisation: {latitude:number, longitude:number};
  driverId: string;
  status: "planned" | "started" | "arrived";
};

type Props = {
  rides: Ride[];
  onStartRide: (rideId: string, data:any) => void;
  onCancelRide: (rideId: string) => void;
  driverId: string | undefined;
};

const startRide = async (uid:string, data:any) => {
   // Firestore document path
    const docPath = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/rides/${uid}?updateMask.fieldPaths=started`;

    // Firestore REST API expects a `fields` object with type wrappers
   const token = await user?.getIdToken()

  try {
    // Send PATCH request to create or update the document
    const res = await fetch(`${docPath}`, { //?key=${apiKey}
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify( {fields: {
        started: { booleanValue: true }
      }} ),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }

    const data2 = await res.json();
    console.log("✅ User data uploaded:", data2);
    router.push(`/rideScreen?rideId=${uid}&Originlat=${data.originLat}&OriginLng=${data.originLng}&Destination=${data.destination}`);

    //await onRefresh()
   
    //return data;
  } catch (error) {
    console.error("❌ Error uploading user data:", error);
    throw error;
  }
}

 const cancelRide = async (uid:string) => {
  // Firestore document path
    const docPath = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/uniliftdefault/documents/rides/${uid}`;

    // Firestore REST API expects a `fields` object with type wrappers
   const token = await user?.getIdToken()
   
  try {
    // Send PATCH request to create or update the document
    const res = await fetch(`${docPath}`, { //?key=${apiKey}
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to upload user data: ${errorText}`);
    }

    const data2 = await res.json();
    console.log("✅ User data uploaded:", data2);
    alert("Ride cancelled!")
    await onRefresh()
   
    //return data;
  } catch (error) {
    console.error("❌ Error uploading user data:", error);
    throw error;
  }
 }

  function DisplayPlannedRides({  rides,
  onStartRide,
  onCancelRide,
  driverId
}: Props) {

    //1: fetch all rides 
    //check all rides of the profile and check the not started ones (planned)
    //if near date ==> start
    //else can delete

     const today = new Date().toISOString().split("T")[0];

  const renderItem = ({ item }: { item: Ride }) => {
     const ridedate = item.date?.split("T")[0];
    const isToday = ridedate === today;
    const canStart = isToday && item.status === "planned";

    return (
      <View style={styles.card}>
        <Text style={styles.route}>
          {item.destination}
        </Text>

        <Text style={styles.date}>📅 {ridedate}</Text>

        <Text style={styles.status}>Status: {item.status}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.button,
              canStart ? styles.start : styles.disabled,
            ]}
            disabled={!canStart}
            onPress={() => onStartRide(item.id, {originLat: item.localisation.latitude, originLng: item.localisation.longitude, destination: item.destination})}
          >
            <Text style={styles.buttonText}>Start</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.cancel]}
            onPress={() =>
              Alert.alert(
                "Cancel ride",
                "Are you sure you want to cancel this ride?",
                [
                  { text: "No" },
                  {
                    text: "Yes",
                    style: "destructive",
                    onPress: () => onCancelRide(item.id),
                  },
                ]
              )
            }
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <FlatList 
      data={rides.filter(r => r.status === "planned" && r.driverId === driverId)}
      keyExtractor={item => item.id}
      renderItem={renderItem}
      contentContainerStyle={{ paddingBottom: 24 }}
      scrollEnabled={false}
    />
  );
}


   useEffect(() => {
    if (!user) return;

    fetchAndSyncUserData({
      user,
      getUserLocation,
      updateLoc,
      setUserData,
    });

    fetchRides().then(setRides).catch(console.error);
  }, [user]);

  /* ------------------------------ REFRESH -------------------------------- */

  const onRefresh = async () => {
    if (!user) return;
    setRefreshing(true);

    await fetchAndSyncUserData({
      user,
      getUserLocation,
      updateLoc,
      setUserData,
    });

    fetchRides().then(setRides).catch(console.error);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!userData) {
    return (
      <SignupScreen />
    );
  } else {

  const { xp, ridesCompleted, rating, email} = userData;
  //const nextLevelXP = (level + 1) * 100; // simple formula
  const progress = (xp / 100) * 100;

  if(modifyFavorite) {
    return (
       <FavoriteRouteForm
       initialData={initialData}
  onSubmit={async (data) => {
    // Push to Firebase
    //console.log("test")
    console.log("Create:", data);
    if (data.id) {
      let newFavorites = [...userData.favorite]
      newFavorites[data.id] = {destination: data.endAddress, destinationGeolocation: {lat: data.endGeolocation?.lat, lon: data.endGeolocation?.lon}}
    
    const fields = {
      favorite: {arrayValue: { values: (newFavorites|| []).map((item: any) => {
  //const f = item.mapValue?.fields || {};
  return {
     mapValue: { fields: {
    destination: {stringValue: item.destination || ""},
    destinationGeolocation: {geoPointValue: {latitude: item.destinationGeolocation?.lat || 0, longitude: item.destinationGeolocation?.lon || 0}},
  }}};
})}}}
if (!user) return;

    updateFavoriteRoutes( await user.getIdToken(), user.uid, fields)
    setModifyFavorite(false)
    onRefresh();

    } else {
        let newFavorites = [...userData.favorite]
        //console.log(newFavorites)
    newFavorites.push({destination: data.endAddress, destinationGeo: {lat: data.endGeolocation?.lat, lon: data.endGeolocation?.lon}})
    const fields = {
      favorite: {arrayValue: { values: (newFavorites|| []).map((item: any) => {
  //const f = item.mapValue?.fields || {};
  return {
     mapValue: { fields: {
    destination: {stringValue: item.destination || ""},
    destinationGeolocation: {geoPointValue: {latitude: item.destinationGeo?.lat || 0, longitude: item.destinationGeo?.lon || 0}},
  }}};
})}}}
if (!user) return;

    updateFavoriteRoutes( await user.getIdToken(), user.uid, fields)
    setModifyFavorite(false)
    onRefresh()
    }
    
      }} onCancel={() => {setModifyFavorite(false)}}
      onDelete={async (index) => {
       
  //index= index of removed favorite
  let newFavorites = [...userData.favorite]
   newFavorites = newFavorites.slice(0, index).concat(newFavorites.slice(index + 1));
   const fields = {
      favorite: {arrayValue: { values: (newFavorites|| []).map((item: any) => {
  //const f = item.mapValue?.fields || {};
  return {
     mapValue: { fields: {
    destination: {stringValue: item.destination || ""},
    destinationGeolocation: {geoPointValue: {latitude: item.destinationGeo?.lat || 0, longitude: item.destinationGeo?.lon || 0}},
  }}};
})}}}
if (!user) return;

    updateFavoriteRoutes( await user.getIdToken(), user.uid, fields)
    setModifyFavorite(false)
    onRefresh();

      }}
/>
    )}

      

  return (
   <ScrollView style={styles.container}  refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }>
    <LinearGradient colors={["#1e1e1e", "#292929"]} style={styles.levelCard}>
       <View style={styles.levelHeader}>
           

     <TouchableOpacity onPress={pickImage}>
       <Image 
      source={{ uri: userData.avatar || "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png" }} 
      style={styles.profileImage}
    />

    </TouchableOpacity>
            
          <Text style={styles.levelTitle}>{email}</Text>
          {/*<Text style={styles.levelSubtitle}>Rising Star</Text>*/}
        </View>
    
      {/* XP / Level Card 

      
        <View style={styles.levelHeader}>
          <LinearGradient
            colors={["#3b82f6", "#9333ea"]}
            style={styles.levelCircle}
          >
            <Text style={styles.levelText}>{xp}</Text>
          </LinearGradient>
          <Text style={styles.levelTitle}>{email}</Text>
          <Text style={styles.levelSubtitle}>Rising Star</Text>
        </View>*/}

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={styles.progressLabels}>
            <Text style={styles.progressText}>{xp} XP</Text>
            <Text style={styles.progressText}>600 XP</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressHint}>{600 - xp} XP to next level</Text>
        </View>
      </LinearGradient>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <StatCard value={ridesCompleted} label="Total Rides" color="#3b82f6" />
        <StatCard value={rating} label="Rating" color="#9333ea" />
        <StatCard value={xp} label="XP" color="#06b6d4" />
      </View>

      <View style={{ marginTop: 24 }}>

        {/*planned rides */}
        {rides && <View><Text style={styles.levelTitle}>Ride Planner: </Text><DisplayPlannedRides rides={rides} onStartRide={startRide} onCancelRide={cancelRide} driverId={user?.uid}/></View>}
{/*Home Address */}
<View>
{userData.homeAddress ? <View>
  <Text style={styles.levelTitle}>Your home address</Text>
   <TextInput
           style={[styles.input, errors.startAddress && styles.errorInput]}
           placeholder={userData.homeAddress}
           value={homeAddress}
           onChangeText={setHomeAddress}
         />
         {errors.startAddress && (
           <Text style={styles.errorText}>{errors.startAddress}</Text>
         )}
         {homeAddress && <View style={styles.buttonRow}>
                <Pressable style={styles.submitButton} onPress={handleNewHomeAddress}>
                  <Text style={styles.btnText}>
                    Update
                  </Text>
                </Pressable>
        
                
              </View>}
</View> : <View>
   <Text style={styles.levelTitle}>Enter your home address</Text>
   <TextInput
           style={[styles.input, errors.startAddress && styles.errorInput]}
           placeholder="home"
           value={homeAddress}
           onChangeText={setHomeAddress}
         />
         {errors.startAddress && (
           <Text style={styles.errorText}>{errors.startAddress}</Text>
         )}
         <View style={styles.buttonRow}>
                <Pressable style={styles.submitButton} onPress={handleNewHomeAddress}>
                  <Text style={styles.btnText}>
                    Save
                  </Text>
                </Pressable>
        
                
              </View>
   
         
  </View>}
</View>
    
  <Text style={styles.levelTitle}>Favorites</Text>

  {userData.favorite && userData.favorite.length > 0 ? (
    userData.favorite.map((route: any, index: number) => (
      <View key={index} style={{ marginBottom: 12 }}>
        
        <FavoriteRouteCard
          
          destination={route.destination}
          onPress={() => {setModifyFavorite(true)
            setInitialData({endGeolocation: {lat: route.destinationGeo.lat, lng: route.destinationGeo.lon}, endAddress: route.destination, id:index})
          }}
        />

       

      </View>
    ))
  ) : (
    <View style={{ marginBottom: 12, marginTop: 6 }}>
    <Text style={styles.route}>No favorite routes yet.</Text>
    </View>
  )}

   <Pressable
          style={{
            marginTop: 6,
            marginBottom: 30,
            backgroundColor: "#3B82F6",
            padding: 10,
            borderRadius: 8,
            alignItems: "center",
          }}
          onPress={() => {setModifyFavorite(true)
            setInitialData(null)
          }}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>New Favorite</Text>
        </Pressable>
</View>

       {/* Achievements
      <Text className="text-xl font-semibold text-white mb-4">
        Achievements
      </Text>
      {achievements?.map((a: Achievement, i: number) => {
        const Icon = a.icon === "Star" ? Star : a.icon === "Zap" ? Zap : a.icon === "Trophy" ? Trophy : Target;
        return (
          <LinearGradient
            key={i}
            colors={
              a.unlocked
                ? ["#1f2937", "#2d2d2d"]
                : ["#111111", "#1a1a1a"]
            }
            className={`rounded-xl p-4 mb-3 ${
              !a.unlocked ? "opacity-50" : ""
            }`}
          >
            <View className="flex-row items-center gap-4">
              <View
                className={`w-12 h-12 rounded-full items-center justify-center ${
                  a.unlocked ? "bg-blue-500" : "bg-gray-700"
                }`}
              >
                <Icon size={24} color="#fff" />
              </View>
              <View className="flex-1">
                <Text className="font-semibold text-white">{a.title}</Text>
                <Text className="text-sm text-gray-400">{a.description}</Text>
              </View>
            </View>
          </LinearGradient>
        );
      })} */}
    </ScrollView>

     
    
  );
};}

/*const StatCard = ({
  value,
  label,
  color,
}: {
  value: number | string;
  label: string;
  color: string;
}) => (
  <LinearGradient
    colors={["#1e1e1e", "#2a2a2a"]}
    className="flex-1 mx-1 p-4 rounded-xl items-center"
  >
    <Text style={{ color }} className="text-3xl font-bold mb-1">
      {value}
    </Text>
    <Text className="text-xs text-gray-400">{label}</Text>
  </LinearGradient>
);*/

const StatCard = ({ value, label, color }: StatCardProps) => (
  <View style={[styles.statCard, { borderColor: color }]}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);



const styles1 = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101010",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "white",
    marginBottom: 32,
  },
  input: {
    width: "100%",
    height: 50,
    backgroundColor: "#1E1E1E",
    borderRadius: 8,
    color: "white",
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#333",
  },
  button: {
    width: "100%",
    height: 50,
    backgroundColor: "#007AFF",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  switchText: {
    color: "#aaa",
    marginTop: 16,
    fontSize: 14,
  },
});
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101010",
    padding: 20,
    ///paddingTop: 70
  },
  levelCard: {
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  levelHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  levelCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  levelText: {
    color: "white",
    fontSize: 34,
    fontWeight: "bold",
  },
  levelTitle: {
    color: "white",
    fontSize: 22,
    fontWeight: "700",
  },
  levelSubtitle: {
    color: "#888",
    fontSize: 14,
    marginTop: 4,
  },
  progressContainer: {
    marginTop: 8,
  },
  progressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  progressText: {
    color: "#aaa",
    fontSize: 12,
  },
  progressBar: {
    height: 8,
    backgroundColor: "#333",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: 8,
    backgroundColor: "#3b82f6",
  },
  progressHint: {
    color: "#888",
    textAlign: "center",
    marginTop: 6,
    fontSize: 13,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    paddingVertical: 16,
    flex: 1,
    alignItems: "center",
    marginHorizontal: 4,
    borderWidth: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  statLabel: {
    color: "#aaa",
    fontSize: 13,
  },
  profileImage: {
  width: 96,       // adjust size
  height: 96,
  borderRadius: 48, // makes it circular
  borderWidth: 2,   // optional border
  borderColor: "#fff",
},
 input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    fontSize: 16,
    color: "white"
  },
  errorInput: {
    borderColor: "red",
  },
  errorText: {
    color: "red",
    marginBottom: 8,
    marginLeft: 4,
  },
   buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  submitButton: {
    backgroundColor: "#3B82F6",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
 
  btnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
  },
   card: {
    backgroundColor: "#1e1e1e",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  route: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  date: {
    color: "#aaa",
    marginTop: 4,
  },
  status: {
    color: "#888",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    marginTop: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    marginRight: 8,
  },
  start: {
    backgroundColor: "#4CAF50",
  },
  cancel: {
    backgroundColor: "#E53935",
  },
  disabled: {
    backgroundColor: "#555",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },

});

export default ProfileScreen
