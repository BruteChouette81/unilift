import { Stack } from 'expo-router';
import React from 'react';

// Auth stack: login + signup. Header hidden; RootLayout handles auth gating.
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
        contentStyle: { backgroundColor: '#101010' },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
