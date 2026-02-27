# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Create environment file

   ```bash
   cp .env.example .env
   ```

   Fill all `EXPO_PUBLIC_*` values in `.env`.

2. Install dependencies

   ```bash
   npm install
   ```

3. Start the app

   ```bash
   npx expo start
   ```

## Security notes

- Do not commit `.env` files.
- Stripe keys are now read from env:
  - Mobile app: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - Firebase functions: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`

## Code structure

- `app/`
  - `app/(auth)/login.tsx`: Login screen (route-level).
  - `app/(auth)/signup.tsx`: Signup screen (route-level).
  - `app/(tabs)/index.tsx`: Home/map + ride selection.
  - `app/(tabs)/profile.tsx`: Profile UI wired to modular hooks.
- `hooks/`
  - `use-profile-data.ts`: profile user/ride fetch + refresh.
  - `use-profile-avatar.ts`: avatar picking/upload flow.
  - `use-profile-rides.ts`: start/cancel planned ride logic.
  - `use-profile-favorites.ts`: favorite routes + home address updates.
- `services/`
  - `authService.ts`: auth actions, normalization, session validity checks.
  - `userService.ts`: Firestore user document helpers/parsers.
  - `rideServices.ts`: ride API operations.
- `context/`
  - `AuthContext.tsx`: auth state, guarded auth actions, session restore checks.
- `constants/`
  - `runtime-config.ts`: runtime env validation.
  - `auth-theme.ts`: shared auth screen theme tokens/styles.

## Cleanup status (Phase 3)

- Removed dead/legacy components:
  - `components/login-screen.tsx`
  - `components/profile2.tsx`
  - `components/home-screen.tsx`
  - `components/signup-screen.tsx` (moved to route-level `app/(auth)/signup.tsx`)
- Removed stale commented code paths from core screens.

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
