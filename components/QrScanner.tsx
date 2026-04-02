import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

interface Props {
  onScanned: (payload: string) => void;
  onClose: () => void;
}

export default function QrScanner({ onScanned, onClose }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const hasScannedRef = useRef(false);

  if (!permission) {
    // Permissions still loading
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>Camera access is required to scan QR codes.</Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </Pressable>
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(result) => {
          if (hasScannedRef.current) return;
          hasScannedRef.current = true;
          onScanned(result.data);
        }}
      />
      <View style={styles.overlay}>
        <Text style={styles.overlayTitle}>Scan Boarding QR Code</Text>
        <View style={styles.scanFrame} />
        <Pressable style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080810',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    color: '#f3f4f6',
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  permBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  overlayTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    backgroundColor: 'rgba(8,8,16,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  scanFrame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: '#a78bfa',
    borderRadius: 16,
    backgroundColor: 'transparent',
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
