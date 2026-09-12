// Interactive founder sign-in for the admin-gated server reports
// (scripts/dispatch-report.mjs, scripts/connect-probe.mjs).
//
// Both routes are gated on the `admin` custom claim, which lives in a Firebase ID
// token — so a script that calls them needs a real sign-in. The password is read
// without echo and never stored, logged, or written anywhere.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export const LIVE = "https://api-qsxtpust2a-uc.a.run.app";
export const SANDBOX = "https://us-central1-unilift-6e756.cloudfunctions.net/apiSandbox";
// Public Firebase web API key — the same value already committed in eas.json.
const API_KEY = "AIzaSyDQMdY0la_sZuHvumHjFl4ibfCsOe1UW6Q";

const CTRL_C = "\u0003";
const BACKSPACE = "\u007f";

/** Read a line without echoing it, so a password never lands in the scrollback. */
export async function readSecret(prompt) {
  stdout.write(prompt);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  let out = "";
  for await (const chunk of stdin) {
    const s = chunk.toString();
    if (s === "\r" || s === "\n") break;
    if (s === CTRL_C) { stdout.write("\n"); process.exit(130); }
    if (s === BACKSPACE) { out = out.slice(0, -1); continue; }
    out += s;
  }
  stdin.setRawMode?.(wasRaw ?? false);
  stdin.pause();
  stdout.write("\n");
  return out;
}

/** An ID token for a founder account. `ID_TOKEN` in the environment skips the
 *  prompt entirely, which is what CI or a repeat run should use. */
export async function getIdToken() {
  if (process.env.ID_TOKEN) return process.env.ID_TOKEN;

  const rl = createInterface({ input: stdin, output: stdout });
  const email = await rl.question("Founder email: ");
  rl.close();
  const password = await readSecret("Password (not echoed, not stored): ");

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `sign-in failed (${res.status})`);
  return json.idToken;
}

/**
 * POST to an admin route on whichever server `--sandbox` selects.
 *
 * The `X-App-Env: dev` header is sent ONLY for the sandbox: the sandbox ignores
 * it, but the LIVE server switches both its database and its Stripe instance on
 * it, so sending it there would report on the wrong environment entirely.
 */
export async function callAdminRoute(path, { sandbox = false, idToken } = {}) {
  const base = sandbox ? SANDBOX : LIVE;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(sandbox ? { "X-App-Env": "dev" } : {}),
    },
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`✗ ${res.status}`, body);
    if (res.status === 403) {
      console.error("  The account has no `admin` claim. Run functions/scripts/set-admin-claims.js,");
      console.error("  then sign out and back in so the new claim lands in the ID token.");
    }
    process.exit(1);
  }
  return { base, body };
}
