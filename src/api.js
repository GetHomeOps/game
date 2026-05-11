const BASE =
  typeof window !== "undefined" && window.__API_BASE__ != null
    ? String(window.__API_BASE__).replace(/\/+$/, "")
    : "";

function apiUrl(relPath) {
  const path = relPath.startsWith("/") ? relPath : `/${relPath}`;
  if (!BASE) return path;
  return `${BASE}${path}`;
}

/** @param {unknown} data */
function messageFromResponseBody(data) {
  if (data && typeof data === "object") {
    const o = /** @type {Record<string, unknown>} */ (data);
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (Array.isArray(o.detail) && o.detail.length) {
      const first = o.detail[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object" && "msg" in first) {
        const m = /** @type {{ msg?: string }} */ (first).msg;
        if (typeof m === "string" && m.trim()) return m.trim();
      }
    }
  }
  return "";
}

/**
 * @param {Response} res
 * @param {unknown} data
 * @param {string} fallback
 */
function apiError(res, data, fallback) {
  const msg = messageFromResponseBody(data);
  throw new Error(msg || fallback || `Request failed (${res.status})`);
}

export async function registerPlayer({ name, username, email, companyName }) {
  let res;
  try {
    res = await fetch(apiUrl("/api/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, username, email, companyName }),
    });
  } catch {
    throw new Error(
      "Could not reach the game server. Make sure it is running (for example, npm start in the server folder).",
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    apiError(res, data, `Registration failed (${res.status}).`);
  }
  return data;
}

export async function submitScore({
  userId,
  score,
  docsCollected,
  laps,
}) {
  const res = await fetch(apiUrl("/api/scores"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      score,
      docsCollected,
      laps,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    apiError(res, data, `Could not save score (${res.status}).`);
  }
  return data;
}

export async function fetchLeaderboard(limit = 30) {
  const res = await fetch(apiUrl(`/api/leaderboard?limit=${limit}`));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    apiError(res, data, `Leaderboard unavailable (${res.status}).`);
  }
  return data.leaderboard ?? [];
}
