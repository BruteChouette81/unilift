/**
 * Guards the production feature switches.
 *
 * Every flag here gates a feature that is built but not ready to ship. The test
 * exists because the failure mode is silent: nothing breaks when an unfinished
 * feature switches itself on, it just appears in front of users. Flipping one of
 * these is a deliberate release decision, so it should have to be deliberate
 * here too.
 *
 * When you genuinely ship one of these, change the expectation in the same
 * commit and say why in the message.
 */
import { CERTIFICATION_ENABLED } from "../certifications";
import { HYPE_MAP_ENABLED } from "../events";
import { SPONSORS_ENABLED } from "../sponsors";
import { REWARDS_ENABLED } from "../rewards";
import { FORCE_UPDATE_ENABLED } from "../force-update-config";

describe("features that must not ship yet", () => {
  it.each([
    ["certification", CERTIFICATION_ENABLED,
      "the /cert/* routes are still sandbox-only — on a production build every button 404s"],
    ["hype map", HYPE_MAP_ENABLED,
      "no real event data, and it was the one unfinished feature that WAS live"],
    ["sponsors", SPONSORS_ENABLED,
      "partner pins ship when there are partners"],
    ["rewards", REWARDS_ENABLED,
      "the catalogue is placeholder data and nothing can actually be redeemed"],
  ])("%s is off", (_name, flag, _why) => {
    expect(flag).toBe(false);
  });

  it("force-update is off until a release actually needs to gate old clients", () => {
    expect(FORCE_UPDATE_ENABLED).toBe(false);
  });
});

describe("flags are release decisions, not build-type accidents", () => {
  // CERTIFICATION_ENABLED used to be `= isDev`. That conflated "is this a dev
  // build?" with "is this feature finished?" — so the feature could never be
  // demoed on a production build, and would have switched itself on for everyone
  // the day someone pointed a dev build at live data.
  //
  // A boolean literal survives that mistake being made again; a value derived
  // from the environment does not.
  it.each([
    ["CERTIFICATION_ENABLED", CERTIFICATION_ENABLED],
    ["HYPE_MAP_ENABLED", HYPE_MAP_ENABLED],
    ["SPONSORS_ENABLED", SPONSORS_ENABLED],
    ["REWARDS_ENABLED", REWARDS_ENABLED],
  ])("%s is a plain boolean", (_name, flag) => {
    expect(typeof flag).toBe("boolean");
  });

  it("does not read the environment to decide", () => {
    // The flags are evaluated at import time, so if any of them were derived
    // from EXPO_PUBLIC_APP_ENV this file's own env would change the answer.
    // Pinning them as literals is what makes that impossible.
    const previous = process.env.EXPO_PUBLIC_APP_ENV;
    process.env.EXPO_PUBLIC_APP_ENV = "dev";
    expect(CERTIFICATION_ENABLED).toBe(false);
    expect(HYPE_MAP_ENABLED).toBe(false);
    expect(SPONSORS_ENABLED).toBe(false);
    process.env.EXPO_PUBLIC_APP_ENV = previous;
  });
});
