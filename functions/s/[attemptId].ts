import type { Env } from "../lib/auth";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const onRequestGet: PagesFunction<Env> = async ({ env, request, params }) => {
  const attemptId = String(params.attemptId || "");
  const origin = new URL(request.url).origin;

  const a = await env.DB.prepare(
    `SELECT a.duration_ms as durationMs,
            u.username as username,
            p.width as width, p.height as height
     FROM attempts a
     JOIN users u ON u.id = a.user_id
     JOIN puzzles p ON p.id = a.puzzle_id
     WHERE a.id = ? AND a.completed = 1`
  ).bind(attemptId).first<{
    durationMs: number | null;
    username: string;
    width: number;
    height: number;
  }>();

  if (!a) {
    return new Response(null, { status: 302, headers: { Location: origin } });
  }

  const replayUrl = `${origin}/#/replay/${esc(attemptId)}`;
  const size = `${a.width}x${a.height}`;
  const time = a.durationMs ? `${(a.durationMs / 1000).toFixed(2)}s` : "???";
  const title = esc(`${size} nonogram solved in ${time}`);
  const desc = esc(`Watch ${a.username}'s replay! Friends-only puzzle room with replays and leaderboards.`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title} — Nonogram</title>
<meta property="og:site_name" content="Nonogram" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${origin}/s/${esc(attemptId)}" />
<meta property="og:image" content="${origin}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${origin}/og.png" />
<meta http-equiv="refresh" content="0;url=${replayUrl}" />
</head>
<body>
<p>Redirecting to replay… <a href="${replayUrl}">Click here</a> if not redirected.</p>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html;charset=UTF-8" },
  });
};
