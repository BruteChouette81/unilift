# Claude Code Prompt — UniLift Live Ride Screen (redesign + iOS QR fix)


---

## Context

You are working on **UniLift**, a carpooling app for young adults in Quebec (French-primary, EN/FR bilingual). This task is about the **live ride screen** — the screen both driver and passenger see *after the driver has accepted the passenger*, through pickup, QR handshake, the ride, drop-off, and payment.

**The underlying logic already works and must not be broken.** Specifically, these are implemented and should be left functionally intact: the map showing the accepted passenger, the QR display/scan handshake, the geofence drop-off detection, and the automatic payment execution at drop-off. This task is **(1) a targeted iOS bug fix on the QR feature** and **(2) a UI/UX overhaul** of the live screen. It is **not** a rewrite of the ride logic.

**Do not assume the codebase.** Before writing any code:

1. Explore and map: the live ride screen(s) for both driver and passenger, the QR display code, the QR scan code, the drop-off/geofence detection, and the payment trigger.
2. Summarize what exists and your plan, and confirm it matches this spec **before** editing.
3. Clearly separate which changes are bugfix vs. which are pure presentation.

---

## The flow being redesigned

Both roles move through these phases. Each phase needs a clear, friendly UI state.

**Driver:**
1. Accepted → en route to pickup (map already shows the passenger).
2. Met the passenger → driver activates the QR code; their device displays it.
3. Passenger scans → in car → en route to drop-off.
4. At the passenger's location → drop-off; payment executes automatically.
5. Complete → summary.

**Passenger:**
1. Accepted → driver en route (driver/car info, ETA).
2. Driver arrived → scan the driver's QR code.
3. In car → en route, trip progress.
4. At destination → drop-off; payment executes.
5. Complete → receipt/summary.

---

## Part 1 — Fix the QR code (iOS / Apple)

The QR handshake works but has **bugs on iOS** specifically. Clean it up and make it reliable on Apple devices.

- Investigate and root-cause the iOS issues **before** patching — don't band-aid symptoms.
- Check the usual iOS culprits for QR *display*: screen brightness (iOS often needs brightness boosted to max while a QR is shown so it scans reliably), rendering size/resolution, behavior across app backgrounding / screen lock / orientation change, and lifecycle when returning to the screen.
- Check the iOS *scan* side too: camera permission flow, autofocus, and reliability.
- **The QR code itself must stay maximum-contrast** — solid dark modules on a solid light background. Do **not** apply the new glass/translucent styling to the QR surface; tinting or blurring it will break scanning.
- Consider auto-boosting screen brightness while the QR is displayed and restoring it after.

Deliver a QR handshake that is clean and reliable on iOS, with the root cause documented.

---

## Part 2 — Redesign the UI (glassmorphism, modern, user-friendly)

Make the live ride screen genuinely **user-friendly** and visually **modern with a glass style** (glassmorphism), for both roles.

**Design direction:**
- Keep the **live map as the base layer**; float information as **frosted translucent glass cards** over it — soft backdrop blur, depth/layering, rounded corners, subtle borders and highlights.
- **One clear primary action per phase.** Both users are often in motion — each state should make "what's happening now" and "what to do next" obvious at a glance. Large tap targets.
- Show the essentials per phase clearly: the other party (name, car for the driver-side), pickup/drop-off, ETA/distance, trip progress, and fare/payout where relevant.

**Hard constraints (do not skip these):**
- **Contrast & legibility over the map.** Glass over a bright, varied, moving map background is exactly where text becomes unreadable — and UniLift was previously rejected from the App Store for a contrast issue (Guideline 4) on a dark background. Every text element and CTA must stay legible over *any* map content: use a tint/scrim behind glass panels so contrast holds regardless of what's under them. Meet WCAG AA contrast.
- **Performance.** Backdrop blur is GPU-heavy over a live, animating map. Limit the number of blurred layers, avoid jank while the map pans/zooms, and verify smoothness on lower-end devices — not just the simulator.
- **Outdoor readability.** This UI is used outside, often in sunlight. Prioritize readability and big, reachable controls.
- All new user-facing strings in **both French and English**, per the existing i18n convention.

---

## Edge cases to handle

- QR displayed but hard to scan (glare/brightness) — ensure the brightness boost covers it; consider a fallback or retry affordance.
- App backgrounded, screen locked, or rotated mid-QR — the QR must come back correctly.
- Multiple passengers in one ride (capacity > 1) — confirm the live screen handles more than one accepted passenger gracefully, or flag it if the current screen assumes a single passenger.
- Network drop mid-ride — states shouldn't get stuck; recover cleanly.
- Drop-off geofence is fuzzy — don't alter the payment logic, but make sure the UI reflects "arriving / arrived / paid" states clearly.

---

## Quality bar

- The ride logic (map, QR scan, drop-off detection, payment) behaves exactly as before — verify no regression.
- QR handshake is reliable on iOS across backgrounding, lock, and orientation.
- The redesigned screen is legible and smooth over the live map on a real device, both roles, every phase.
- No stuck states, no broken navigation.

When done, give me: (1) the root cause of the iOS QR bug and the fix, (2) what changed visually vs. what stayed logic-identical, (3) files touched, and (4) how you tested QR reliability, contrast, and performance on device.