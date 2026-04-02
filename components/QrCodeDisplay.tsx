import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

interface Props {
  token: string;
  expiresAt: number;
  onExpired: () => void;
  onClose: () => void;
}

export default function QrCodeDisplay({ token, expiresAt, onExpired, onClose }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Boarding QR Code</Text>
      <Text style={styles.subtitle}>Passengers scan this to board</Text>
      <View style={styles.qrWrapper}>
        <QRCode value={token} size={220} backgroundColor="#fff" color="#000" />
      </View>
      <Text style={styles.timer}>
        Expires in {minutes}:{seconds.toString().padStart(2, '0')}
      </Text>
      <Pressable style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080810',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    color: '#a78bfa',
    fontSize: 14,
    marginBottom: 32,
  },
  qrWrapper: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    marginBottom: 24,
  },
  timer: {
    color: '#fbbf24',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 32,
  },
  closeBtn: {
    backgroundColor: '#3b0764',
    paddingHorizontal: 40,
    paddingVertical: 14,
    borderRadius: 12,
  },
  closeBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
