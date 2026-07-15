# In-App Wizards & Helpers — Audit

**Status:** Phase 1 (audit only). No code changed.
**Goal:** Add guided wizards (first-run walkthroughs) and lightweight inline helpers across the app so new students understand the form fields, the reward/settings system, how to connect a card, and how to search for a ride.

---

## 1. What already exists (reuse, don't rebuild)

| Asset | File | What it is | Verdict |
|---|---|---|---|
| **`InfoButton`** | [components/info-button.tsx](../components/info-button.tsx) | A `(i)` circle that opens a blurred modal with a `title` + `body`. Already fully i18n-driven. | ✅ **This is our inline-helper primitive.** Reuse everywhere. Already used in `wallet.tsx` and `profile.tsx`. |
| **Notification hard-gate** | [app/_layout.tsx:521](../app/_layout.tsx#L521) → `NotificationGateScreen` | When `authenticated && !permissionGranted`, the entire app is replaced by a full-screen "enable notifications" wall (`useNotificationGate`). Re-checks on every foreground. | ✅ **Works.** Notifications are effectively mandatory. See §4. |
| **Notification priming modal** | [components/notification-prompt-modal.tsx](../components/notification-prompt-modal.tsx) + [hooks/use-notification-prompt.ts](../hooks/use-notification-prompt.ts) | A softer "turn on notifications" card meant to appear on every launch until granted. | ⚠️ **Orphaned.** `useNotificationPrompt` is only wired into `settingsScreen.tsx` (and even there via a manual duplicate). Never mounted globally. See §4. |
| **i18n** | [constants/translations/en.ts](../constants/translations/en.ts), [fr.ts](../constants/translations/fr.ts) | All copy is `t("…")`. `notifPrompt.*`, `notifGate.*`, `wallet.info.*`, `profile.info.*` blocks already exist. | ✅ Every wizard string must be added to **both** en + fr. |

**Gap:** there is **no first-run walkthrough / coach-mark system** anywhere in the app. `InfoButton` is passive (user must tap `(i)`). Wizards are the missing active-onboarding layer.

---

## 2. Proposed helper taxonomy

Three tiers, escalating in intrusiveness. Match the tier to the need — don't make everything a wizard.

1. **Inline info (`InfoButton`)** — passive, on-demand. For "what does this one field/number mean?" Already built. Just add more of them.
2. **Coach marks / spotlight wizard** — a first-run, multi-step overlay that dims the screen and points at real elements one at a time ("This is where you search → Next"). Best for spatial UI (the map/home screen).
3. **Card-carousel wizard** — a centered multi-step modal (like `NotificationPromptModal` but with Back/Next/step-dots) that explains a flow before/while the user does it. Best for forms and dense screens (signup, wallet, profile).

**New shared components to build in Phase 2:**
- `components/wizard/WizardModal.tsx` — the card-carousel (steps, dots, Back/Next/Skip, "Got it"). Styled from the existing `notification-prompt-modal` + `info-button` tokens (purple→pink gradient, BlurView, `#080810` bg).
- `components/wizard/CoachOverlay.tsx` — spotlight overlay for the map screen (measures a target `ref`, cuts a hole, floats a tooltip). Optional; can fall back to a card-carousel if measuring proves fiddly in Expo Go.
- `hooks/use-first-run.ts` — `const { seen, markSeen } = useFirstRun(key)`. Persists per-wizard "seen" flags in `AsyncStorage` under `unilift:wizard:<key>`. Also exposes a manual `replay()` so each wizard can be re-triggered from a `(i)` or a "Show me again" affordance.

**Persistence:** each wizard has a stable key (`signup`, `home-search`, `wallet-card`, `profile-tour`). Store `"1"` once completed/skipped. Never auto-show twice. Always allow manual replay (users forget, and reviewers/testers need it).

---

## 3. Per-surface audit

### 3.1 Sign-up form — **card-carousel wizard** (explicitly requested)
File: [app/(auth)/signup.tsx](../app/(auth)/signup.tsx). A 3-step form (account → age/school/terms → certification).

Every field the wizard must explain, and *why a student cares*:

| Step | Field | Helper copy angle |
|---|---|---|
| 1 | **Name** | Shown to drivers/passengers you match with — use your real first name for trust. |
| 1 | **Email** | Your login + where ride receipts go. Use your school email if you have one (unlocks Student certification later). |
| 1 | **Password** | Standard security note. |
| 2 | **Birth date** | Gates the **Adult (18+) certification** tier and legal eligibility to drive. Explain the auto-format (DD/MM/YYYY). |
| 2 | **School** | Powers campus matching + the Student certification badge. It's a searchable dropdown, not free text — explain the picker. |
| 2 | **Terms checkbox** | Required to continue; one line on what they're agreeing to. |
| 3 | **Certification tiers** | Explain Uncertified → Adult → Student and that it's **optional now, finish later in Profile**. The screen already renders the ladder; the wizard just narrates it. |

**Recommendation:** two-layer. (a) Add an `InfoButton` next to each field label for on-demand detail. (b) A one-time card-carousel that fires when Step 1 first mounts (`useFirstRun("signup")`), walking through the 3 steps at a high level, with a "Skip" for returning/Apple users. Note Apple sign-up **skips steps 2–3** (age/school collected later) — the wizard must not promise fields Apple users won't see.

### 3.2 Notifications — **verify the gate, retire the orphan** (explicitly requested)
See §4. This is a *correctness* task, not a new wizard.

### 3.3 Profile — **card-carousel "profile tour"** (explicitly requested)
File: [app/(tabs)/profile.tsx](../app/(tabs)/profile.tsx). Requested focus: **rewards** and **settings**.

Elements worth a helper:
- **XP bar / level** (top card) — what XP is and how you earn it.
- **Rewards banner** → `/rewardsScreen` ([profile.tsx:331](../app/(tabs)/profile.tsx#L331)) — "Here's where your rides turn into perks." *(User specifically called out "very few application rewards" — the tour should surface the rewards entry point so it isn't missed.)*
- **Certification badges** → `/certificationScreen` ([:248](../app/(tabs)/profile.tsx#L248)) — how to raise your trust tier.
- **Driver mode** → `/driverModeScreen` ([:378](../app/(tabs)/profile.tsx#L378)) — become a driver / earn.
- **Favorites** ([:441](../app/(tabs)/profile.tsx#L441)) — already has an `InfoButton`. Good template.
- **Floating settings gear** ([:193](../app/(tabs)/profile.tsx#L193)) — the tour should point here since settings is otherwise easy to miss (top-right, icon-only). Inside settings: language, notifications toggle, logout.

**Recommendation:** first-visit coach tour (`useFirstRun("profile-tour")`) hitting 4 stops: XP → Rewards banner → Certification → Settings gear. Add `InfoButton`s to the XP bar and Rewards banner for permanent on-demand help. Add a "Take the tour" row in `settingsScreen` to replay.

### 3.4 Wallet — **card-carousel "how to connect a card"** (explicitly requested)
File: [app/(tabs)/wallet.tsx](../app/(tabs)/wallet.tsx). Already has 4 `InfoButton`s (pending charge, payment method, earnings, transactions) — good baseline.

The missing piece is the **"Add card" flow** itself ([wallet.tsx:279](../app/(tabs)/wallet.tsx#L279) → Stripe `initPaymentSheet`/`presentPaymentSheet`):
- Why a card is required (you can't request a lift without one — enforced by `ensurePaymentMethodOrAlert` on the home screen).
- What happens: Stripe sheet opens, card is stored securely, UniLift never sees the number.
- Billing model: charges are **pooled and billed end-of-month**, not per-ride (the hero card already says this — the wizard reinforces it).
- Drivers: earnings accrue and pay out end-of-month.

**Recommendation:** a card-carousel that auto-fires **once, only when `paymentMethod == null`** (`useFirstRun("wallet-card")`), ending on a "Add your card" CTA that calls the existing `handleAddCard`. Also reachable via a small "How does this work?" link above the Add-card button. High value because this is the monetization funnel and the #1 blocker to requesting a first ride.

### 3.5 Home / Main map — **spotlight coach marks** (explicitly requested: "explain if your passenger were to search")
File: [app/(tabs)/index.tsx](../app/(tabs)/index.tsx).

Elements:
- **Floating search bar** ([:525](../app/(tabs)/index.tsx#L525)) — "Type where you're going. We'll find a driver headed the same way." This is the primary requested explanation.
- **Suggestions dropdown** — icons mean different things: 🏠 home, ⭐ favorite, 🔥 hype event, 🕐 recent, 📍 place. A helper legend is genuinely useful here.
- **Hype (🔥) toggle** ([:555](../app/(tabs)/index.tsx#L555)) — switches to night mode + reveals party/event markers.
- **Tapping the map / a marker** → opens the Request-Lift sheet. Non-obvious that the map itself is interactive.
- **Request-Lift sheet** — shows live available-driver count; explain the wait-for-driver flow (`findingDriverScreen`).

**Recommendation:** first-run spotlight (`useFirstRun("home-search")`) with 3 stops: Search bar → Hype toggle → "tap anywhere on the map to pick a destination." Because the map is full-bleed with floating chrome, a spotlight/coach overlay reads better than a centered card. Add a persistent tiny `(i)` in the search bar row that replays it.

### 3.6 Secondary surfaces (lower priority, note for later)
- **Onboarding** ([app/onboardingScreen.tsx](../app/onboardingScreen.tsx)) — already the post-signup data-collection flow. Verify it doesn't overlap/collide with the signup wizard; the signup wizard should hand off cleanly to onboarding.
- **Driver mode / Drive online** ([app/driveOnlineScreen.tsx](../app/driveOnlineScreen.tsx), `driverModeScreen.tsx`) — already reference wizard/coach language in code; a driver-side "how earning works" wizard is a strong follow-up but out of scope for this pass.
- **Active ride / QR boarding** — the QR handshake is unusual; a one-time helper ("show your QR to the driver at max brightness") would cut confusion, but defer.

---

## 4. Notification correctness (the "make sure it works" item)

**Finding:** Notifications are **already enforced** — [app/_layout.tsx:521](../app/_layout.tsx#L521) renders a blocking `NotificationGateScreen` for any authenticated user without permission, and `useNotificationGate` re-checks on every foreground (so returning from OS Settings clears it automatically). This satisfies "the app must make sure notifications are open."

**Problems to fix in Phase 2:**
1. **Orphaned duplicate.** `useNotificationPrompt` ([hooks/use-notification-prompt.ts](../hooks/use-notification-prompt.ts)) — the "ask on every launch" priming modal — is never mounted at the root. Meanwhile `settingsScreen.tsx` re-implements the same enable logic by hand ([settingsScreen.tsx:158](../app/settingsScreen.tsx#L158)) instead of using the hook. Two code paths, one dead. **Decide:** since the hard gate already forces the issue, either (a) delete `useNotificationPrompt` as dead code, or (b) keep it *only* as the softer pre-gate primer and refactor settings to use it. Recommend (a) unless we want a gentler first-ask before the wall.
2. **No "why" education.** The gate demands permission but a first-time student may not trust it. Fold a one-line rationale into the **signup wizard** ("UniLift needs notifications so you hear the instant a driver accepts — this is required") so the wall isn't a cold surprise.
3. **Verify on a real device.** The permission request (`registerForPushNotifications`) and Firestore token save should be confirmed on physical iOS + Android (simulators silently no-op permission lookups, per the hook comments).

**Action:** treat this as a small refactor + device-verification ticket, plus one wizard slide — not a new UI system.

---

## 5. Phase 2 build plan (proposed order)

1. **Shared infra** — `use-first-run.ts`, `WizardModal.tsx` (card-carousel), and `wizard.*` i18n scaffold in en/fr. (Foundational; everything else depends on it.)
2. **Wallet wizard** (`wallet-card`) — highest ROI (monetization funnel), simplest surface, reuses existing `InfoButton`s.
3. **Home spotlight** (`home-search`) — the explicitly-requested passenger-search explainer; build `CoachOverlay` here (or fall back to `WizardModal` if measuring is fiddly in Expo Go).
4. **Signup wizard** (`signup`) — card-carousel + per-field `InfoButton`s; wire the notification rationale slide.
5. **Profile tour** (`profile-tour`) — rewards + settings focus.
6. **Notification cleanup** — remove/consolidate `useNotificationPrompt`; device-verify the gate.
7. **Replay affordances** — "Show me again"/"Take the tour" entries (settings + per-screen `(i)`), so no wizard is a one-shot.

**Cross-cutting requirements**
- Every string in **both** `en.ts` and `fr.ts`.
- Reuse design tokens (`#080810` bg, `#8938D5`→`#FD165A` gradient, `BlurView`, purple-light `#e09af7`).
- Never block the actual task — always `Skip`/`Later`; never show a given wizard twice automatically.
- Respect existing flows: signup → `onboardingScreen`; Apple sign-up skips steps 2–3; wallet wizard only when `paymentMethod == null`.

---

## 6. Open questions for the user (resolve before Phase 2)
1. **Coach spotlight vs. card carousel for the map** — do we invest in the spotlight overlay (nicer, more work in Expo Go) or ship card-carousels everywhere for consistency/speed?
2. **Soft primer before the notification wall** — keep a gentle "why notifications" ask first (revive `useNotificationPrompt`), or rely solely on the existing hard gate + a signup slide?
3. **Auto-fire vs. opt-in** — should wizards fire automatically on first visit (recommended), or only when the user taps a "?" ? 
4. **Scope of profile tour** — just Rewards + Settings as requested, or include XP / Certification / Driver mode stops too?
