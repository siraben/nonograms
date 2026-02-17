import type { Env } from "../../lib/auth";
import { json } from "../../lib/http";
import { periodCutoff, queryLeaderboard } from "../../lib/leaderboard";

const ADJECTIVES = [
  "Swift", "Clever", "Bold", "Calm", "Bright", "Keen", "Noble", "Warm",
  "Brave", "Lucky", "Quick", "Quiet", "Wise", "Wild", "Gentle", "Proud",
  "Sleek", "Witty", "Zesty", "Vivid", "Deft", "Grand", "Eager", "Fair",
  "Jolly", "Merry", "Peppy", "Spry", "Agile", "Hardy", "Plucky", "Sly",
];

const ANIMALS = [
  "Falcon", "Otter", "Fox", "Owl", "Wolf", "Hare", "Lynx", "Crane",
  "Raven", "Panda", "Tiger", "Eagle", "Seal", "Koala", "Finch", "Dolphin",
  "Badger", "Hawk", "Deer", "Swan", "Cobra", "Ibis", "Wren", "Gecko",
  "Bison", "Shrike", "Quail", "Newt", "Viper", "Stork", "Heron", "Lark",
];

function anonymize(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = ((h << 5) - h + username.charCodeAt(i)) | 0;
  }
  const adj = ADJECTIVES[Math.abs(h) % ADJECTIVES.length];
  const animal = ANIMALS[Math.abs(h >> 8) % ANIMALS.length];
  return `${adj} ${animal}`;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const cutoff = periodCutoff(url.searchParams.get("period"));

  const [r5, r10, r15, r20] = await Promise.all([
    queryLeaderboard(env.DB, 5, cutoff, 3),
    queryLeaderboard(env.DB, 10, cutoff, 3),
    queryLeaderboard(env.DB, 15, cutoff, 3),
    queryLeaderboard(env.DB, 20, cutoff, 3),
  ]);

  const mask = (rows: typeof r5.results) =>
    rows.map((r) => ({
      username: anonymize(r.username),
      durationMs: r.durationMs,
      finishedAt: r.finishedAt,
      width: r.width,
      height: r.height,
    }));

  return json({
    leaderboard5: mask(r5.results),
    leaderboard10: mask(r10.results),
    leaderboard15: mask(r15.results),
    leaderboard20: mask(r20.results),
  });
};
