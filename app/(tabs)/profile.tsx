import { useAuth } from "@/context/AuthContext";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  ActivityIndicator,
  Alert,
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

import FavoriteRouteCard from "@/components/favorite-rides";
import FavoriteRouteForm from "@/components/favoriteForm";
import { PlannedRidesList } from "@/components/profile/planned-rides-list";

import { normalizeAuthError } from "@/services/authService";

import { useProfileAvatar } from "@/hooks/use-profile-avatar";
import { useProfileData } from "@/hooks/use-profile-data";
import { useProfileFavorites } from "@/hooks/use-profile-favorites";
import { useProfileRides } from "@/hooks/use-profile-rides";
import type { FavoriteRoute, UserProfile } from "@/types/models";
import { useRouter } from "expo-router";

import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

interface StatCardProps {
  value: number | string;
  label: string;
  color: string;
}

const ProfileScreen = () => {
  const { user, loading, signOutUser } = useAuth();
  const { userData, rides, refreshing, onRefresh } = useProfileData(user);
  const { pickImage } = useProfileAvatar({
    user,
    onUploaded: async () => {
      alert("Profile picture updated!");
      await onRefresh();
    },
  });

  const router = useRouter();

  const handleLogout = async () => {
    try {
      await signOutUser();
      router.replace("/(auth)/login");
    } catch (err) {
      const authError = normalizeAuthError(err, "Logout failed");
      if (authError.retryable) {
        Alert.alert(authError.title, authError.message, [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: handleLogout },
        ]);
        return;
      }
      Alert.alert(authError.title, authError.message);
    }
  };

  const { startRide, cancelRide } = useProfileRides({
    user,
    onRefresh,
    onRideStarted: ({ rideId, originLat, originLng, destination }) => {
      router.push(
        `/rideScreen?rideId=${rideId}&Originlat=${originLat}&OriginLng=${originLng}&Destination=${destination}`,
      );
    },
  });
  const {
    modifyFavorite,
    setModifyFavorite,
    initialData,
    setInitialData,
    homeAddress,
    setHomeAddress,
    errors,
    handleNewHomeAddress,
    handleFavoriteSubmit,
    handleFavoriteDelete,
  } = useProfileFavorites({
    user,
    userData,
    onRefresh,
  });

  if (loading) {
    return (
      <View
        style={styles1.container}
        className="flex-1 items-center justify-center"
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const safeUserData: UserProfile = userData ?? {
    email: user?.email ?? "",
    xp: 0,
    rating: 0,
    avatar: null,
    homeAddress: null,
    localisation: { latitude: null, longitude: null },
    ridesCompleted: 0,
    favorite: [],
  };

  const { xp, ridesCompleted, rating, email } = safeUserData;
  const progress = (xp / 100) * 100;

  if (modifyFavorite) {
    return (
      <FavoriteRouteForm
        initialData={initialData}
        onSubmit={handleFavoriteSubmit}
        onCancel={() => {
          setModifyFavorite(false);
        }}
        onDelete={handleFavoriteDelete}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <LinearGradient colors={["#1e1e1e", "#292929"]} style={styles.levelCard}>
        <View style={styles.levelHeader}>
          <TouchableOpacity onPress={pickImage}>
            <Image
              source={{
                uri:
                  safeUserData.avatar ||
                  "https://www.macfcu.org/wp-content/uploads/2024/02/Windows_10_Default_Profile_Picture.svg.png",
              }}
              style={styles.profileImage}
            />
          </TouchableOpacity>

          <Text style={styles.levelTitle}>{email}</Text>
        </View>
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

      <View style={styles.statsContainer}>
        <StatCard value={ridesCompleted} label="Total Rides" color="#3b82f6" />
        <StatCard value={rating} label="Rating" color="#9333ea" />
        <StatCard value={xp} label="XP" color="#06b6d4" />
      </View>

      <View style={{ marginTop: 24 }}>
        {rides && (
          <View>
            <Text style={styles.levelTitle}>Ride Planner: </Text>
            <PlannedRidesList
              rides={rides}
              onStartRide={startRide}
              onCancelRide={cancelRide}
              driverId={user?.uid}
            />
          </View>
        )}
        <View>
          {safeUserData.homeAddress ? (
            <View>
              <Text style={styles.levelTitle}>Your home address</Text>
              <TextInput
                style={[styles.input, errors.startAddress && styles.errorInput]}
                placeholder={safeUserData.homeAddress}
                value={homeAddress}
                onChangeText={setHomeAddress}
              />
              {errors.startAddress && (
                <Text style={styles.errorText}>{errors.startAddress}</Text>
              )}
              {homeAddress && (
                <View style={styles.buttonRow}>
                  <Pressable
                    style={styles.submitButton}
                    onPress={handleNewHomeAddress}
                  >
                    <Text style={styles.btnText}>Update</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : (
            <View>
              <Text style={styles.levelTitle}>Enter your home address</Text>
              <TextInput
                style={[styles.input, errors.startAddress && styles.errorInput]}
                placeholder="home"
                value={homeAddress}
                placeholderTextColor={"grey"}
                onChangeText={setHomeAddress}
              />
              {errors.startAddress && (
                <Text style={styles.errorText}>{errors.startAddress}</Text>
              )}
              <View style={styles.buttonRow}>
                <Pressable
                  style={styles.submitButton}
                  onPress={handleNewHomeAddress}
                >
                  <Text style={styles.btnText}>Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>

        <Text style={styles.levelTitle}>Favorites</Text>

        {safeUserData.favorite && safeUserData.favorite.length > 0 ? (
          safeUserData.favorite.map((route: FavoriteRoute, index: number) => (
            <View key={index} style={{ marginBottom: 12 }}>
              <FavoriteRouteCard
                destination={route.destination}
                onPress={() => {
                  setModifyFavorite(true);
                  setInitialData({
                    endGeolocation: {
                      lat: route.destinationGeo.lat,
                      lon: route.destinationGeo.lon,
                    },
                    endAddress: route.destination,
                    id: index,
                  });
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
          onPress={() => {
            setModifyFavorite(true);
            setInitialData(undefined);
          }}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>
            New Favorite
          </Text>
        </Pressable>
      </View>

      <View style={styles.topRow}>
        <Pressable
          onPress={handleLogout}
          style={styles.logoutButton}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
};

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
    paddingTop: 15,
  },
  topRow: {
    marginBottom: 25,
  },
  screenTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  logoutButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#1f1f1f",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ff6b6b",
  },
  logoutText: {
    color: "#ff6b6b",
    fontWeight: "700",
    fontSize: 14,
    textAlign: "center",
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
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "#fff",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    fontSize: 16,
    color: "white",
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
  route: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});

export default ProfileScreen;
