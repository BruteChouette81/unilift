import { useLanguage } from "@/context/LanguageContext";
import type { ProfileCompletion, ProfileTaskKey } from "@/utils/profile-completion";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

const C = {
  border:      "rgba(137, 56, 213, 0.22)",
  purpleLight: "#e09af7",
  text:        "#f3f4f6",
  muted:       "#9ca3af",
  dim:         "#4b5563",
  success:     "#34d399",
};

const BAR_GRADIENT = ["#FD165A", "#8938D5"] as const;

const TASK_ICON: Record<ProfileTaskKey, React.ComponentProps<typeof Ionicons>["name"]> = {
  avatar:       "camera-outline",
  name:         "person-outline",
  school:       "school-outline",
  verification: "shield-checkmark-outline",
  homeAddress:  "home-outline",
  payment:      "card-outline",
};

type Props = {
  completion: ProfileCompletion;
  /** Tapping an unfinished task. Omit to render the checklist read-only. */
  onTaskPress?: (key: ProfileTaskKey) => void;
};

/**
 * Progress bar + per-task checklist. Shared by the profile-screen card and the
 * request-time nudge sheet so both always agree on what "complete" looks like.
 */
export default function ProfileCompletionMeter({ completion, onTaskPress }: Props) {
  const { t } = useLanguage();
  const { tasks, completed, total, percent } = completion;

  return (
    <View style={styles.wrap}>
      {/* Progress bar + count */}
      <View style={styles.barRow}>
        <View style={styles.barTrack}>
          <LinearGradient
            colors={BAR_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.barFill, { width: `${percent}%` }]}
          />
        </View>
        <Text style={styles.barLabel}>
          {t("profileCompletion.progressLabel", { completed, total })}
        </Text>
      </View>

      {/* Checklist */}
      <View style={styles.tasks}>
        {tasks.map((task) => {
          const label = t(
            `profileCompletion.tasks.${task.key}${task.done ? "Done" : ""}`,
          );
          const interactive = !task.done && onTaskPress !== undefined;

          return (
            <TouchableOpacity
              key={task.key}
              style={styles.taskRow}
              onPress={interactive ? () => onTaskPress(task.key) : undefined}
              disabled={!interactive}
              activeOpacity={0.7}
            >
              <View style={[styles.taskIcon, task.done && styles.taskIconDone]}>
                <Ionicons
                  name={task.done ? "checkmark" : TASK_ICON[task.key]}
                  size={14}
                  color={task.done ? C.success : C.purpleLight}
                />
              </View>
              <Text style={[styles.taskLabel, task.done && styles.taskLabelDone]} numberOfLines={1}>
                {label}
              </Text>
              {interactive && <Ionicons name="chevron-forward" size={14} color={C.dim} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:    { gap: 14, alignSelf: "stretch" },

  barRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  barTrack: {
    flex: 1, height: 8, borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  barFill:  { height: "100%", borderRadius: 4 },
  barLabel: { color: C.muted, fontSize: 12, fontWeight: "700", minWidth: 34, textAlign: "right" },

  tasks:   { gap: 8 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  taskIcon: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: "rgba(224,154,247,0.10)",
    borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  taskIconDone: {
    backgroundColor: "rgba(52,211,153,0.10)",
    borderColor: "rgba(52,211,153,0.25)",
  },
  taskLabel:     { flex: 1, color: C.text, fontSize: 13.5, fontWeight: "600" },
  taskLabelDone: { color: C.dim, textDecorationLine: "line-through", fontWeight: "500" },
});
