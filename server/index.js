import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(__dirname, "data.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));

/*
 * Admin password. Set ADMIN_PASSWORD in the environment for production deployments.
 * The default is intentionally weak so you do not get locked out of a fresh
 * checkout — replace it before exposing the server to the open internet.
 */
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD ?? "opsy-admin");

function readAdminPassword(req) {
  const auth = String(req.headers.authorization ?? "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const headerPassword = req.headers["x-admin-password"];
  if (typeof headerPassword === "string") return headerPassword.trim();
  if (typeof req.query?.password === "string") return req.query.password.trim();
  return "";
}

function requireAdmin(req, res, next) {
  const password = readAdminPassword(req);
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin password." });
  }
  return next();
}

/** @typedef {{ id: number; email: string; username: string; name: string; company_name?: string; created_at: string }} User */
/** @typedef {{ id: number; user_id: number; score: number; docs_collected: number; laps: number; created_at: string }} ScoreRow */

/** @type {{ users: User[]; scores: ScoreRow[]; nextUserId: number; nextScoreId: number }} */
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.users)) data.users = [];
    if (!Array.isArray(data.scores)) data.scores = [];
    if (typeof data.nextUserId !== "number") data.nextUserId = 1;
    if (typeof data.nextScoreId !== "number") data.nextScoreId = 1;
    return data;
  } catch {
    return { users: [], scores: [], nextUserId: 1, nextScoreId: 1 };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function resetStoredData() {
  const empty = {
    users: [],
    scores: [],
    nextUserId: 1,
    nextScoreId: 1,
  };
  saveData(empty);
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePlayerPayload(body) {
  const name = String(body?.name ?? "").trim();
  const username = String(body?.username ?? "").trim();
  const email = normalizeEmail(body?.email);

  if (name.length < 1 || name.length > 120) {
    return { error: "Name must be between 1 and 120 characters." };
  }
  if (username.length < 2 || username.length > 32) {
    return { error: "Username must be between 2 and 32 characters." };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return {
      error:
        "Username may only contain letters, numbers, dots, underscores, and hyphens.",
    };
  }
  if (!isValidEmail(email)) {
    return { error: "Please enter a valid email address." };
  }
  const companyName = String(
    body?.companyName ?? body?.company_name ?? ""
  ).trim();
  if (companyName.length < 1 || companyName.length > 120) {
    return {
      error: "Company name must be between 1 and 120 characters.",
    };
  }
  return { name, username, email, companyName };
}

app.post("/api/register", (req, res) => {
  const v = validatePlayerPayload(req.body);
  if (v.error) {
    return res.status(400).json({ error: v.error });
  }

  const data = loadData();
  const emailLower = v.email;

  /* Email is the player's stable identity. If it already exists, treat the request as a sign-in and return the stored profile (the typed username/name are ignored so we don't accidentally rewrite an existing identity). */
  const existingByEmail = data.users.find(
    (u) => u.email.toLowerCase() === emailLower
  );
  if (existingByEmail) {
    return res.status(200).json({
      user: {
        id: existingByEmail.id,
        name: existingByEmail.name,
        username: existingByEmail.username,
        email: existingByEmail.email,
        companyName: existingByEmail.company_name ?? "",
      },
      returning: true,
    });
  }

  const usernameTaken = data.users.some(
    (u) => u.username.toLowerCase() === v.username.toLowerCase()
  );
  if (usernameTaken) {
    return res.status(409).json({
      code: "USERNAME_TAKEN",
      error:
        "That username is already taken. Please choose a different handle.",
    });
  }

  const now = new Date().toISOString();
  const user = {
    id: data.nextUserId++,
    email: emailLower,
    username: v.username,
    name: v.name,
    company_name: v.companyName,
    created_at: now,
  };
  data.users.push(user);
  saveData(data);

  return res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      companyName: user.company_name ?? "",
    },
    returning: false,
  });
});

app.post("/api/scores", (req, res) => {
  const userId = Number(req.body?.userId);
  const score = Number(req.body?.score);
  const docsCollected = Number(req.body?.docsCollected ?? 0);
  const laps = Number(req.body?.laps ?? 0);

  if (!Number.isInteger(userId) || userId < 1) {
    return res.status(400).json({ error: "Invalid user id." });
  }
  if (!Number.isFinite(score) || score < 0 || score > 1e9) {
    return res.status(400).json({ error: "Invalid score." });
  }

  const data = loadData();
  const user = data.users.find((u) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  const now = new Date().toISOString();
  const row = {
    id: data.nextScoreId++,
    user_id: userId,
    score: Math.floor(score),
    docs_collected: Math.max(0, Math.floor(docsCollected)),
    laps: Math.max(0, Math.floor(laps)),
    created_at: now,
  };
  data.scores.push(row);
  saveData(data);

  res.status(201).json({
    scoreRow: {
      id: row.id,
      score: row.score,
      docs_collected: row.docs_collected,
      laps: row.laps,
      created_at: row.created_at,
      username: user.username,
      name: user.name,
    },
  });
});

app.get("/api/leaderboard", (req, res) => {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.limit ?? "30"), 10) || 30)
  );

  const data = loadData();
  const enriched = data.scores.map((s) => {
    const u = data.users.find((x) => x.id === s.user_id);
    return {
      score: s.score,
      docsCollected: s.docs_collected,
      laps: s.laps,
      createdAt: s.created_at,
      username: u?.username ?? "?",
      name: u?.name ?? "?",
    };
  });

  enriched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });

  res.json({ leaderboard: enriched.slice(0, limit) });
});

/*
 * Admin: list every player with their email + best play and most recent
 * activity. Used by /admin.html. The password is checked against ADMIN_PASSWORD
 * before any user data is returned.
 */
app.post("/api/admin/verify", requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const data = loadData();

  /** @type {Map<number, { count: number; bestScore: number; totalDocs: number; lastPlayed: string | null }>} */
  const aggregates = new Map();
  for (const score of data.scores) {
    const prev = aggregates.get(score.user_id) ?? {
      count: 0,
      bestScore: 0,
      totalDocs: 0,
      lastPlayed: null,
    };
    prev.count += 1;
    if (score.score > prev.bestScore) prev.bestScore = score.score;
    prev.totalDocs += score.docs_collected;
    if (
      !prev.lastPlayed ||
      String(score.created_at) > String(prev.lastPlayed)
    ) {
      prev.lastPlayed = score.created_at;
    }
    aggregates.set(score.user_id, prev);
  }

  /** @type {Map<number, ScoreRow[]>} */
  const scoresByUser = new Map();
  for (const score of data.scores) {
    const rowsForUser = scoresByUser.get(score.user_id) ?? [];
    rowsForUser.push(score);
    scoresByUser.set(score.user_id, rowsForUser);
  }

  const rows = data.users
    .slice()
    .sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at))
    )
    .map((u) => {
      const agg = aggregates.get(u.id) ?? {
        count: 0,
        bestScore: 0,
        totalDocs: 0,
        lastPlayed: null,
      };
      return {
        id: u.id,
        name: u.name,
        companyName: u.company_name ?? "",
        username: u.username,
        email: u.email,
        scores: (scoresByUser.get(u.id) ?? [])
          .slice()
          .sort((a, b) =>
            String(b.created_at).localeCompare(String(a.created_at))
          )
          .map((s) => s.score),
        createdAt: u.created_at,
        playCount: agg.count,
        bestScore: agg.bestScore,
        totalDocs: agg.totalDocs,
        lastPlayed: agg.lastPlayed,
      };
    });

  const scoreRows = data.users.flatMap((u) => {
    const userScores = scoresByUser.get(u.id) ?? [];
    if (!userScores.length) {
      return [
        {
          userId: u.id,
          name: u.name,
          companyName: u.company_name ?? "",
          username: u.username,
          email: u.email,
          scoreId: null,
          score: null,
          docsCollected: null,
          laps: null,
          playedAt: null,
          joinedAt: u.created_at,
        },
      ];
    }
    return userScores.map((s) => ({
      userId: u.id,
      name: u.name,
      companyName: u.company_name ?? "",
      username: u.username,
      email: u.email,
      scoreId: s.id,
      score: s.score,
      docsCollected: s.docs_collected,
      laps: s.laps,
      playedAt: s.created_at,
      joinedAt: u.created_at,
    }));
  });

  scoreRows.sort((a, b) => {
    const aPlayed = a.playedAt ?? a.joinedAt ?? "";
    const bPlayed = b.playedAt ?? b.joinedAt ?? "";
    return String(bPlayed).localeCompare(String(aPlayed));
  });

  res.json({
    users: rows,
    scoreRows,
    totals: {
      users: data.users.length,
      plays: data.scores.length,
      docs: data.scores.reduce((s, x) => s + (x.docs_collected || 0), 0),
    },
    /* Tell the UI whether the server is using the default dev password so the
       admin page can warn the operator to set ADMIN_PASSWORD in production. */
    defaultPasswordInUse: ADMIN_PASSWORD === "opsy-admin",
  });
});

/*
 * Reset via POST on the same path as the admin listing so restrictive proxies
 * (or partial deploys) that reach GET /api/admin/users still honor reset.
 * Legacy POST /api/admin/reset remains for scripts and older admin builds.
 */
app.post("/api/admin/users", requireAdmin, (req, res) => {
  const body = req.body;
  if (
    body &&
    typeof body === "object" &&
    body.reset === true
  ) {
    resetStoredData();
    return res.json({ ok: true });
  }
  return res.status(400).json({ error: "Invalid request." });
});

app.post("/api/admin/reset", requireAdmin, (_req, res) => {
  resetStoredData();
  res.json({ ok: true });
});

/* Avoid 404 spam: browsers request /favicon.ico even when HTML declares a PNG icon. */
app.get("/favicon.ico", (_req, res) => {
  res.redirect(301, "/src/assets/ui/opsy_head_hud.png?v=3");
});

app.use(express.static(ROOT));

const PORT = Number(process.env.PORT) || 3333;
app.listen(PORT, () => {
  console.log(`Opsy- The Game server http://localhost:${PORT}`);
});
