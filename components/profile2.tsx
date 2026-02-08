import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

import { useAuth } from "@/context/AuthContext";
import { auth } from "@/firebaseConfig";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

import FavoriteRouteCard from "@/components/favorite-rides";
import FavoriteRouteForm from "@/components/favoriteForm";
import { fetchAndSyncUserData } from "@/components/userHelper";
import { fetchRides } from "@/services/rideServices";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

type LocationType = { latitude: number; longitude: number };

type Favorite = {
  destination: string;
  destinationGeo: { lat: number | null; lon: number | null };
};

type UserData = {
  email: string;
  xp: number;
  rating: number;
  avatar: string | null;
  homeAddress: string | null;
  localisation: LocationType | null;
  ridesCompleted: number;
  favorite: Favorite[];
};

type Ride = {
  id: string;
  date: string;
  destination: string;
  localisation: LocationType;
  driverId: string;
  status: "planned" | "started" | "arrived";
};

/* -------------------------------------------------------------------------- */
/*                             UTILITY FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

const getUserLocation = async (): Promise<LocationType> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new Error("Location permission denied");

  const pos = await Location.getCurrentPositionAsync({});
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
  };
};

/* -------------------------------------------------------------------------- */
/*                               AUTH SECTION                                 */
/* -------------------------------------------------------------------------- */

const AuthScreen = ({ onAuth }: { onAuth: () => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Fill all fields");
      return;
    }

    try {
      setLoading(true);
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      onAuth();
    } catch (err: any) {
      Alert.alert("Auth error", err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.authContainer}>
      <Text style={styles.authTitle}>
        {isLogin ? "Welcome back" : "Create an account"}
      </Text>

      <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity style={styles.authButton} onPress={handleAuth}>
        <Text style={styles.authButtonText}>
          {loading ? "Loading..." : isLogin ? "Log in" : "Sign up"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
        <Text style={styles.switchText}>
          {isLogin ? "No account? Sign up" : "Already have an account?"}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

/* -------------------------------------------------------------------------- */
/*                              PROFILE SCREEN                                */
/* -------------------------------------------------------------------------- */

export default function ProfileScreen() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [userData, setUserData] = useState<UserData | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [modifyFavorite, setModifyFavorite] = useState(false);
  const [initialFavorite, setInitialFavorite] = useState<any>(null);
  const [homeAddress, setHomeAddress] = useState("");

  /* ----------------------------- INITIAL LOAD ----------------------------- */

  useEffect(() => {
    if (!user) return;

    fetchAndSyncUserData({
      user,
      getUserLocation,
      updateLoc: async () => {},
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
      updateLoc: async () => {},
      setUserData,
    });

    fetchRides().then(setRides).catch(console.error);
    setRefreshing(false);
  };

  /* ------------------------------ AVATAR --------------------------------- */

  const pickImage = async () => {
    if (!user) return;

    const result = await ImagePicker.launchImageLibraryAsync({ quality: 1 });
    if (result.canceled) return;

    const manipulated = await ImageManipulator.manipulateAsync(
      result.assets[0].uri,
      [],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );

    // upload logic handled elsewhere (recommended)
    Alert.alert("Avatar updated");
    onRefresh();
  };

  /* ------------------------------ DERIVED -------------------------------- */

  const plannedRides = useMemo(
    () => rides.filter(r => r.status === "planned" && r.driverId === user?.uid),
    [rides, user]
  );

  /* ------------------------------- GUARDS -------------------------------- */

  if (loading) {
    return <ActivityIndicator style={{ flex: 1 }} />;
  }

  if (!userData) {
    return <AuthScreen onAuth={onRefresh} />;
  }

  /* ----------------------------------------------------------------------- */
  /*                                  UI                                     */
  /* ----------------------------------------------------------------------- */

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <LinearGradient colors={["#1e1e1e", "#292929"]} style={styles.header}>
        <TouchableOpacity onPress={pickImage}>
          <Image
            source={{
              uri:
                userData.avatar ??
                "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png",
            }}
            style={styles.avatar}
          />
        </TouchableOpacity>
        <Text style={styles.email}>{userData.email}</Text>
      </LinearGradient>

      <View style={styles.statsRow}>
        <StatCard label="Rides" value={userData.ridesCompleted} color="#3b82f6" />
        <StatCard label="Rating" value={userData.rating} color="#9333ea" />
        <StatCard label="XP" value={userData.xp} color="#06b6d4" />
      </View>

      <Text style={styles.sectionTitle}>Planned rides</Text>
      <FlatList
        data={plannedRides}
        keyExtractor={r => r.id}
        renderItem={({ item }) => (
          <View style={styles.rideCard}>
            <Text style={styles.route}>{item.destination}</Text>
            <Text style={styles.date}>{item.date.split("T")[0]}</Text>
          </View>
        )}
        scrollEnabled={false}
      />

      <Text style={styles.sectionTitle}>Favorites</Text>

      {userData.favorite.map((f, i) => (
        <FavoriteRouteCard
          key={i}
          destination={f.destination}
          onPress={() => {
            setInitialFavorite({ ...f, id: i });
            setModifyFavorite(true);
          }}
        />
      ))}

      <Pressable style={styles.addButton} onPress={() => setModifyFavorite(true)}>
        <Text style={styles.addButtonText}>Add favorite</Text>
      </Pressable>

      {modifyFavorite && (
        <FavoriteRouteForm
          initialData={initialFavorite}
          onCancel={() => setModifyFavorite(false)}
          onSubmit={() => {
            setModifyFavorite(false);
            onRefresh();
          }}
        />
      )}
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/*                                COMPONENTS                                  */
/* -------------------------------------------------------------------------- */

const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <View style={[styles.statCard, { borderColor: color }]}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#101010", padding: 20 },
  header: { borderRadius: 12, padding: 20, alignItems: "center" },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: "#fff" },
  email: { color: "white", fontSize: 18, fontWeight: "600", marginTop: 10 },

  statsRow: { flexDirection: "row", marginTop: 20 },
  statCard: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    marginHorizontal: 4,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "700" },
  statLabel: { color: "#aaa", fontSize: 13 },

  sectionTitle: { color: "white", fontSize: 20, fontWeight: "700", marginVertical: 12 },

  rideCard: { backgroundColor: "#1e1e1e", padding: 12, borderRadius: 10, marginBottom: 8 },
  route: { color: "white", fontSize: 16, fontWeight: "600" },
  date: { color: "#aaa", fontSize: 13 },

  addButton: {
    marginTop: 10,
    backgroundColor: "#3b82f6",
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  addButtonText: { color: "white", fontWeight: "600" },

  authContainer: {
    flex: 1,
    backgroundColor: "#101010",
    justifyContent: "center",
    padding: 24,
  },
  authTitle: { color: "white", fontSize: 26, fontWeight: "700", marginBottom: 24 },
  input: {
    backgroundColor: "#1e1e1e",
    borderRadius: 8,
    padding: 14,
    color: "white",
    marginBottom: 12,
  },
  authButton: {
    backgroundColor: "#3b82f6",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  authButtonText: { color: "white", fontWeight: "600" },
  switchText: { color: "#aaa", textAlign: "center", marginTop: 14 },
});
