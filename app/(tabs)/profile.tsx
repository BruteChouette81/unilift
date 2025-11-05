// ProfileScreen.tsx
import * as ImagePicker from "expo-image-picker";
import { onAuthStateChanged, updateProfile } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { ActivityIndicator, Avatar, Button, Text, TextInput } from "react-native-paper";
import { auth, db } from "../../firebase";

export default function ProfileScreen() {
  const [user, setUser] = useState<any>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setEmail(u.email || "");

        const userRef = doc(db, "users", u.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const data = snap.data();
          setName(data.name || "");
          setPhotoURL(data.photoURL || "");
        } else {
          // create a new user doc if none exists
          await setDoc(userRef, { name: u.displayName || "", email: u.email, photoURL: u.photoURL || "" });
        }
      } else {
        console.log("No user logged in");
        //navigation.replace("Login");
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setPhotoURL(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, { name, photoURL });

      await updateProfile(user, { displayName: name, photoURL });
      Alert.alert("✅ Profile updated!");
    } catch (err) {
        console.log(err)
      //Alert.alert("❌ Error", err?.message);
    }
    setSaving(false);
  };

  const handleLogout = async () => {
    await auth.signOut();
    //navigation.replace("Login");
    //should be handled by auth listener in layout
  };

  if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Your Profile</Text>

      <Avatar.Image
        size={120}
        source={photoURL ? { uri: photoURL } : require("../../assets/images/default-avatar.png")}
        style={styles.avatar}
      />
      <Button mode="outlined" onPress={pickImage}>
        Change Photo
      </Button>

      <TextInput
        label="Full Name"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />

      <TextInput label="Email" value={email} disabled style={styles.input} />

      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        style={styles.saveButton}
      >
        Save Changes
      </Button>

      <Button mode="text" onPress={handleLogout} style={styles.logoutButton}>
        Log Out
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, alignItems: "center", backgroundColor: "#f9f9f9" },
  title: { fontSize: 28, fontWeight: "bold", marginVertical: 20 },
  avatar: { marginVertical: 15 },
  input: { width: "100%", marginVertical: 10 },
  saveButton: { width: "100%", marginTop: 20 },
  logoutButton: { marginTop: 15 },
});
