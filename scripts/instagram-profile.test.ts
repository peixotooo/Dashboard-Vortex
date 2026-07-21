import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInstagramProfileContinuity,
  parseInstagramProfilePayload,
} from "../src/lib/instagram/profile.ts";
import { dailyDeltaBetween } from "../src/lib/series-utils.ts";

test("parses the current Apify profile payload and followsCount", () => {
  const profile = parseInstagramProfilePayload(
    {
      username: "bulkingoficial",
      fullName: "BULKING",
      biography: "Respect the Hustle.",
      followersCount: 288_948,
      followsCount: 273,
      postsCount: 5_760,
      profilePicUrl: "https://example.com/profile.jpg",
      businessCategoryName: "Clothing",
    },
    "fallback"
  );

  assert.equal(profile.followersCount, 288_948);
  assert.equal(profile.followingCount, 273);
  assert.equal(profile.postsCount, 5_760);
  assert.equal(profile.businessCategory, "Clothing");
});

test("rejects an Apify error item instead of converting missing metrics to zero", () => {
  assert.throws(
    () =>
      parseInstagramProfilePayload(
        {
          error: "no_items",
          errorDescription: "Instagram returned no profile data",
          inputUrl: "https://www.instagram.com/bulkingoficial/",
        },
        "bulkingoficial"
      ),
    /Instagram returned no profile data/
  );
});

test("rejects profile payloads without required counters", () => {
  assert.throws(
    () =>
      parseInstagramProfilePayload(
        { username: "bulkingoficial" },
        "bulkingoficial"
      ),
    /quantidade de seguidores/
  );
});

test("blocks an anomalous zero snapshot after an established profile", () => {
  assert.throws(
    () =>
      assertInstagramProfileContinuity(
        { followersCount: 0, postsCount: 0 },
        { followersCount: 288_063, postsCount: 5_760 }
      ),
    /seguidores caíram para zero/
  );
});

test("does not attribute a multi-day gap to one daily delta", () => {
  assert.equal(dailyDeltaBetween("2026-07-17", 288_063, "2026-07-16", 287_925), 138);
  assert.equal(dailyDeltaBetween("2026-07-19", 288_536, "2026-07-17", 288_063), null);
});
