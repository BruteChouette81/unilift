import { Stack } from 'expo-router';
import React from 'react';

// Auth stack: login + signup. Header hidden; RootLayout handles auth gating.
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: '#080810' },
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
