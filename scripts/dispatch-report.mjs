#!/usr/bin/env node
// Ask a deployed server who /requests/dispatch would notify right now.
//
// This is the production answer to "nobody got the push". On a dev build the
// same question is answered in-app (DEV badge → Dispatch diagnostics), but a
// production TestFlight/App Store build has no DEV badge and no console, so the
// only way in is POST /admin/dispatch-report — which is gated on the `admin`
// custom claim (functions/scripts/set-admin-claims.js).
//
//   npm run report:dispatch                 # LIVE server (production)
//   npm run report:dispatch -- --sandbox    # SANDBOX server (dev data)
//   ID_TOKEN=<jwt> npm run report:dispatch  # skip the sign-in prompt
//
// Read-only: it sends no notifications and writes nothing.
import { callAdminRoute, getIdToken } from "./lib/firebase-signin.mjs";

const sandbox = process.argv.includes("--sandbox");
const idToken = await getIdToken();
const { base, body } = await callAdminRoute("/admin/dispatch-report", { sandbox, idToken });

const { environment, database, matching, broadcast, totals, skipped, me } = body;
console.log(`\n  server        ${base}`);
console.log(`  environment   ${environment} (${database})`);
console.log(`  matching      ${matching}`);
console.log(
  `  cap           ${broadcast.maxRecipients ?? "none"}` +
    (broadcast.blocked ? `  ⚠️  BLOCKED — ${broadcast.blocked}` : ""),
);
console.log(`\n  users                    ${totals.users}`);
console.log(`  eligible recipients      ${totals.eligible}`);
console.log(`  reached by one dispatch  ${totals.wouldNotifyOnOneDispatch}`);

const reasons = Object.entries(skipped ?? {});
if (reasons.length) {
  console.log("\n  skipped:");
  reasons
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => console.log(`    ${String(count).padStart(5)}  ${reason}`));
}

if (me) {
  console.log(
    `\n  this account: ${me.wouldReceive ? "WOULD receive a broadcast" : `would NOT — ${me.blockedBy}`}`,
  );
  console.log(
    `    ride mode ${me.driverModeEnabled ? "on" : "off"} · ` +
      `token ${me.hasPushToken ? "present" : "MISSING"} · ` +
      `env ${me.tokenEnv ?? "untagged"} · ` +
      `${me.tokenAgeDays == null ? "no registration date" : `${me.tokenAgeDays}d old`}`,
  );
}
console.log("");
