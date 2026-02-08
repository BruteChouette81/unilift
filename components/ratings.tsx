import { useAuth } from '@/context/AuthContext';
import { updateRatings, updateXP } from "@/services/rideServices";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function RatingScreen(props: { rideId: string }) {
  const [rating, setRating] = useState(0);
  const {user, loading} = useAuth()


  const handleSubmit = async () => {
    // Replace this with API / Firebase call
    const driverId = await updateRatings(props.rideId, rating)
    await updateXP(user?.uid!, driverId!, rating * 20) //do a formula with price etc

    Alert.alert("Thank you!", `You submitted a ${rating}/5 rating.`);
    //update rating and augment XP
  };

  const renderStars = () => {
    return [...Array(5)].map((_, index) => {
      const starValue = index + 1;
      return (
        <TouchableOpacity
          key={starValue}
          onPress={() => setRating(starValue)}
          activeOpacity={0.7}
        >
          <Ionicons
            name={starValue <= rating ? "star" : "star-outline"}
            size={40}
            color="#FFD700"
            style={styles.star}
          />
        </TouchableOpacity>
      );
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Rate your experience</Text>

      <View style={styles.starsContainer}>{renderStars()}</View>

      <Text style={styles.ratingText}>
        {rating > 0 ? `You selected ${rating}/5` : "Tap a star"}
      </Text>

      <TouchableOpacity
        style={[
          styles.submitButton,
          rating === 0 && styles.submitButtonDisabled,
        ]}
        disabled={rating === 0}
        onPress={handleSubmit}
        activeOpacity={0.8}
      >
        <Text style={styles.submitText}>Submit</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 20,
  },
  starsContainer: {
    flexDirection: "row",
    marginBottom: 10,
  },
  star: {
    marginHorizontal: 5,
  },
  ratingText: {
    fontSize: 16,
    color: "#555",
    marginBottom: 30,
  },
  submitButton: {
    backgroundColor: "#000",
    paddingVertical: 14,
    paddingHorizontal: 60,
    borderRadius: 10,
  },
  submitButtonDisabled: {
    backgroundColor: "#aaa",
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
