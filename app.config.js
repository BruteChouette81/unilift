module.exports = ({ config }) => ({
  ...config,
  name: "UniLift",
  slug: "unilift",
  version: "1.3.1",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "unilift",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  // OTA updates: each app `version` is its own runtime, so a JS-only `eas update`
  // only reaches builds with the matching version. Native/version bumps are NOT
  // OTA-able by design and fall back to the store force-gate (config/forceUpdate).
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: "https://u.expo.dev/4d095cd0-0669-4abb-b793-415183362b03",
    fallbackToCacheTimeout: 0,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.unilift.unilift",
    usesAppleSignIn: true,
    // Native Google Maps SDK key for react-native-maps (separate from the JS
    // REST key in `extra`). Read at build time — the EAS secret is available
    // to app.config.js during `eas build`. Note: this key ships embedded in
    // the binary; restrict it by bundle ID in Google Cloud Console.
    config: {
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription: "UniLift uses your location to match you with nearby rides and share your position during a trip.",
      NSPhotoLibraryUsageDescription: "UniLift needs access to your photos to set your profile picture.",
      NSCameraUsageDescription: "UniLift needs camera access to scan boarding QR codes.",
      NSUserNotificationUsageDescription: "UniLift sends you ride requests, booking updates, driver alerts, and payment confirmations so you never miss an important update.",
    },
    googleServicesFile: "./GoogleService-Info.plist"
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    permissions: [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
    // Native Google Maps SDK key for react-native-maps on Android — without
    // this the map renders blank/gray. Restrict by package name + SHA-1.
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
    package: "com.unilift.unilift",
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-apple-authentication",
    "expo-notifications",
    [
      "@stripe/stripe-react-native",
      {
        merchantIdentifier: "merchant.com.unilift.unilift",
        enableGooglePay: false,
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-maps",
      {
        requestLocationPermission: true,
        // Must match ios.infoPlist.NSLocationWhenInUseUsageDescription — this
        // plugin runs after the base infoPlist and would otherwise overwrite it.
        locationPermission: "UniLift uses your location to match you with nearby rides and share your position during a trip.",
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  owner: "brutechouette81",
  extra: {
    router: {},
    eas: {
      projectId: "4d095cd0-0669-4abb-b793-415183362b03",
    },
    EXPO_PUBLIC_FIREBASE_API_KEY:             process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN:         process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID:          process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET:      process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    EXPO_PUBLIC_FIREBASE_APP_ID:              process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID:      process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
    EXPO_PUBLIC_FIRESTORE_DATABASE_ID:        process.env.EXPO_PUBLIC_FIRESTORE_DATABASE_ID,
    EXPO_PUBLIC_APP_ENV:                      process.env.EXPO_PUBLIC_APP_ENV,
    EXPO_PUBLIC_API_BASE_URL:                 process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY:       process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST:  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST,
    GOOGLE_MAPS_API_KEY:                      process.env.GOOGLE_MAPS_API_KEY,
    EXPO_PUBLIC_FACEBOOK_APP_ID:              process.env.EXPO_PUBLIC_FACEBOOK_APP_ID,
    EXPO_PUBLIC_INSTAGRAM_APP_ID:             process.env.EXPO_PUBLIC_INSTAGRAM_APP_ID,
    EXPO_PUBLIC_TIKTOK_CLIENT_KEY:            process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY,
    EXPO_PUBLIC_SPOTIFY_CLIENT_ID:            process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID,
  },
});
