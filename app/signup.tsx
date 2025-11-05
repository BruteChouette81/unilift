import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import { Alert, Button, StyleSheet, Text, TextInput, View } from "react-native";
import { auth, db } from "../firebase";

export default function SignupScreen({ navigation }: any) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signup, setsignup] = useState(true);

  const handleSignup = async () => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", cred.user.uid), {
        name,
        email,
        createdAt: new Date(),
      });
      Alert.alert("Success", "Account created!");
    } catch (err: any) {
      Alert.alert("Error", err.message);
    }
  };

  const handleLogin = async () => {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        Alert.alert("Login failed", err.message);
      }
    };

  return (
    signup ? <View style={styles.container}>
      <Text style={styles.title}>Sign Up</Text>
      <TextInput placeholder="Name" style={styles.input} value={name} onChangeText={setName} />
      <TextInput placeholder="Email" style={styles.input} value={email} onChangeText={setEmail} />
      <TextInput placeholder="Password" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
      <Button title="Sign Up" onPress={handleSignup} />
      <Text onPress={() => setsignup(false)} style={styles.link}>
        Already have an account? Log in
      </Text>
    </View> :  <View style={styles.container}>
          <Text style={styles.title}>Log In</Text>
          <TextInput placeholder="Email" style={styles.input} value={email} onChangeText={setEmail} />
          <TextInput placeholder="Password" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
          <Button title="Log In" onPress={handleLogin} />
          <Text onPress={() => setsignup(true)} style={styles.link}>
            Don't have an account? Sign up
          </Text>
        </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 20 },
  title: { fontSize: 28, fontWeight: "bold", marginBottom: 20, textAlign: "center" },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 10, marginBottom: 15, borderRadius: 8 },
  link: { textAlign: "center", color: "blue", marginTop: 10 },
});
