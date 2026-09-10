module.exports = ({ config }) => ({
  ...config,
  name: "UniLift",
  slug: "unilift",
  version: "1.4.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "unilift",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  // OTA updates: each app `version` is its own runtime, so a JS-only `eas update`
  // only reaches builds with the matching version. Native/version bumps are NOT
  // OTA-able by design and fall back to the store force-gate (config/forceUpdate).
  //
  // 1.3.4 -> 1.4.0 is therefore a STORE release, not an OTA push: it carries the
  // production cutover (payout rail, security audit, billing guardrails, hype and
  // sponsors switched off). Users on 1.3.x keep talking to the same live server
  // until they update, so nothing they can do may depend on this build alone.
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: "https://u.expo.dev/4d095cd0-0669-4abb-b793-415183362b03",
    fallbackToCacheTimeout: 0,
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.unilift.unilift",
    usesAppleSignIn: true,
    // NOTE: `ios.config.googleMapsApiKey` was removed. Setting it made Expo
    // prebuild inject a `react-native-google-maps` pod, and react-native-maps
    // 1.27 (Expo SDK 57) no longer ships that podspec, so `pod install` failed
    // outright. Nothing was lost: the app never passes `provider={PROVIDER_GOOGLE}`
    // to <MapView>, so iOS has always rendered Apple Maps and the key only
    // forced an unused second map SDK into the binary — the same reason the
    // `expo-maps` plugin was dropped. Android still needs its key below, since
    // react-native-maps always uses Google Maps there.
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      // Without this, `Linking.canOpenURL("comgooglemaps://…")` returns false on
      // EVERY iOS device — iOS refuses to answer for undeclared schemes. That
      // silently killed the native multi-stop hand-off in riderScreen and
      // gmapsHint, so drivers always got the web fallback. Native rebuild
      // required for this to take effect; it is not picked up by an OTA update.
      LSApplicationQueriesSchemes: ["comgooglemaps"],
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
    // Keychain-backed storage for the install identity that caps how many
    // accounts one device may create. Chosen over AsyncStorage because a
    // Keychain entry survives deleting the app on iOS, and a counter you can
    // reset by reinstalling is not a counter. See services/deviceIdentity.ts.
    "expo-secure-store",
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
    // NOTE: the `expo-maps` plugin was removed — the app renders maps with
    // `react-native-maps`, which takes its key from ios.config.googleMapsApiKey
    // and android.config.googleMaps.apiKey above, not from a plugin. Keeping
    // expo-maps compiled a second native map SDK (ExpoMaps pod) that nothing
    // imported. Location permissions are unaffected: they are declared directly
    // in ios.infoPlist.NSLocationWhenInUseUsageDescription and
    // android.permissions.
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
    // GOOGLE_MAPS_API_KEY is deliberately NOT exposed here any more.
    //
    // Anything in `extra` ships inside the JS bundle and is trivially extractable.
    // That key was used for Directions, Geocoding and Places — Web Service APIs,
    // which Google's Android/iOS application restrictions do NOT cover; only IP
    // restriction does, and a phone cannot satisfy it. So the key was billable by
    // anyone who unpacked the app.
    //
    // Those four calls now go through authenticated /maps/* endpoints on the
    // server, which holds an IP-restricted GOOGLE_MAPS_SERVER_KEY. The native map
    // SDK below keeps its own separate key, restricted by bundle id / package
    // name — a restriction that does apply to the SDKs.
  },
});
