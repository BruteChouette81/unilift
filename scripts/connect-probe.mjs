#!/usr/bin/env node
// Can a deployed server actually do Stripe Connect, with the credential it is
// really holding?
//
// The Stripe dashboard answers this for the account you logged into. It cannot
// tell you which key `functions/.env` carries — and a stale, revoked or
// accidentally test-mode STRIPE_SECRET_KEY_LIVE fails exactly the way "Connect
// not enabled" does, which is why a driver tapping *Set up payouts* just sees
// "Couldn't open Stripe".
//
//   npm run probe:connect                 # LIVE server (live Stripe key)
//   npm run probe:connect -- --sandbox    # SANDBOX server (test Stripe key)
//   ID_TOKEN=<jwt> npm run probe:connect  # skip the sign-in prompt
//
// Read-only: it creates no account, no link and no charge.
import { callAdminRoute, getIdToken } from "./lib/firebase-signin.mjs";

const sandbox = process.argv.includes("--sandbox");
const idToken = await getIdToken();
const { base, body } = await callAdminRoute("/admin/connect-probe", { sandbox, idToken });

const { environment, platform, connect, balance } = body;
const mark = (ok) => (ok ? "✓" : "✗");

/** Print the classified reason a probe failed — the code first, since that is
 *  what the app now shows a driver, then Stripe's own words. */
function explain(section) {
  console.log(`      error      ${section.error}`);
  if (section.detail?.type) console.log(`      type       ${section.detail.type}`);
  if (section.detail?.param) console.log(`      param      ${section.detail.param}`);
  if (section.detail?.requestId) console.log(`      requestId  ${section.detail.requestId}`);
  if (section.message) console.log(`      stripe     ${section.message}`);
}

console.log(`\n  server        ${base}`);
console.log(`  environment   ${environment}`);

console.log(`\n  ${mark(platform.ok)} platform account`);
if (platform.ok) {
  console.log(`      id                ${platform.id}`);
  console.log(`      country           ${platform.country ?? "—"}`);
  console.log(`      details submitted ${platform.detailsSubmitted}`);
  console.log(`      charges enabled   ${platform.chargesEnabled}`);
  console.log(`      payouts enabled   ${platform.payoutsEnabled}`);
  const caps = Object.entries(platform.capabilities ?? {});
  if (caps.length) {
    console.log(`      capabilities      ${caps.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
} else {
  explain(platform);
}

console.log(`\n  ${mark(connect.ok)} Connect enabled on this key`);
if (!connect.ok) explain(connect);

console.log(`\n  ${mark(balance.ok)} balance`);
if (balance.ok) {
  // The single most useful line when the config and the symptom disagree: it is
  // the credential itself saying which mode it is in.
  console.log(`      key mode          ${balance.livemode ? "LIVE" : "TEST"}`);
  console.log(`      currencies        ${balance.currencies.join(", ") || "none"}`);
  console.log(`      CAD balance       ${balance.hasCad ? "present" : "MISSING — the payout sweeper needs it"}`);
} else {
  explain(balance);
}

if (!sandbox && balance.ok && !balance.livemode) {
  console.log("\n  ⚠️  The LIVE server is holding a TEST key. Check STRIPE_SECRET_KEY_LIVE in functions/.env.");
}
console.log("");
