import type { Env } from "../../lib/auth";
import { json } from "../../lib/http";

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

type Row = {
  durationMs: number;
  finishedAt: string;
  username: string;
  width: number;
  height: number;
};

function periodCutoff(period: string | null): string | null {
  switch (period) {
    case "day": return new Date(Date.now() - 86_400_000).toISOString();
    case "week": return new Date(Date.now() - 7 * 86_400_000).toISOString();
    case "month": return new Date(Date.now() - 30 * 86_400_000).toISOString();
    default: return null;
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url);
  const cutoff = periodCutoff(url.searchParams.get("period"));

  const q = (size: number) =>
    env.DB.prepare(
      `SELECT a.duration_ms as durationMs,
              a.finished_at as finishedAt,
              u.username as username,
              p.width as width,
              p.height as height
       FROM attempts a
       JOIN users u ON u.id = a.user_id
       JOIN puzzles p ON p.id = a.puzzle_id
       WHERE a.completed = 1 AND a.eligible = 1 AND a.duration_ms IS NOT NULL
         AND p.width = ?1 AND p.height = ?1
         AND (?2 IS NULL OR a.finished_at >= ?2)
       ORDER BY a.duration_ms ASC
       LIMIT 3`
    ).bind(size, cutoff).all<Row>();

  const [r5, r10] = await Promise.all([q(5), q(10)]);

  const mask = (rows: Row[]) =>
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
  });
};
