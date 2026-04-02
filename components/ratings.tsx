import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { updateRatings, updateXP } from "@/services/rideServices";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const C = {
  bg: "#080810", surface: "#0f0f1e",
  purple: "#7C3AED", purpleLight: "#a78bfa",
  text: "#f3f4f6", muted: "#9ca3af",
  gold: "#fbbf24",
  borderFaint: "rgba(255, 255, 255, 0.06)",
};
const BUTTON_GRADIENT = ["#7C3AED", "#2563eb"] as const;

export default function RatingScreen(props: {
  rideId: string;
  onRatingSubmitted?: (rating: number) => void;
}) {
  const [rating, setRating] = useState(0);
  const { user } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const handleSubmit = async () => {
    if (props.onRatingSubmitted) {
      props.onRatingSubmitted(rating);
      return;
    }
    const driverId = await updateRatings(props.rideId, rating);
    await updateXP(user?.uid!, driverId!, rating * 20);
    Alert.alert(t("ratings.thankYou"), t("ratings.thankYouMsg", { count: rating }), [
      {
        text: t("common.ok"),
        onPress: () => router.replace("/"),
      },
    ]);
  };

  const renderStars = () => {
    return [...Array(5)].map((_, index) => {
      const starValue = index + 1;
      const filled = starValue <= rating;
      return (
        <TouchableOpacity
          key={starValue}
          onPress={() => setRating(starValue)}
          activeOpacity={0.7}
          style={styles.star}
        >
          <Ionicons
            name={filled ? "star" : "star-outline"}
            size={38}
            color={filled ? C.gold : C.muted}
          />
        </TouchableOpacity>
      );
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.starIcon}>
          <Text style={{fontSize: 26}}>⭐</Text>
        </View>
        <Text style={styles.title}>{t("ratings.title")}</Text>
        <Text style={styles.subtitle}>{t("ratings.subtitle")}</Text>

        <View style={styles.starsContainer}>{renderStars()}</View>

        <Text style={styles.ratingText}>
          {rating > 0 ? t("ratings.starsDisplay", { count: rating }) : t("ratings.tapToRate")}
        </Text>

        <TouchableOpacity
          disabled={rating === 0}
          onPress={handleSubmit}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={rating > 0 ? BUTTON_GRADIENT : ["#374151", "#374151"]}
            style={styles.submitButton}
          >
            <Text style={styles.submitText}>{t("ratings.submitBtn")}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.borderFaint,
  },
  starIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(251,191,36,0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    color: C.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: C.muted,
    marginBottom: 24,
  },
  starsContainer: {
    flexDirection: "row",
    marginBottom: 14,
  },
  star: {
    marginHorizontal: 6,
  },
  ratingText: {
    fontSize: 14,
    color: C.purpleLight,
    fontWeight: "bold",
    marginBottom: 24,
  },
  submitButton: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 60,
    alignItems: "center",
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
