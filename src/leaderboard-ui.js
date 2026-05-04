import { fetchLeaderboard } from "./api.js";

export async function refreshLeaderboardTable() {
  const tbody = document.getElementById("leaderboard-body");
  const hint = document.getElementById("leaderboard-hint");
  if (!tbody) return;

  tbody.innerHTML = "";

  try {
    const rows = await fetchLeaderboard(40);
    if (hint) hint.textContent = "";

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "lb-empty";
      td.textContent = "No scores yet — be the first.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((row, i) => {
      const tr = document.createElement("tr");
      const date = row.createdAt
        ? formatPlayedAt(row.createdAt)
        : "—";

      tr.innerHTML = `
        <td class="lb-rank">${i + 1}</td>
        <td class="lb-user">@${escapeHtml(row.username)}</td>
        <td class="lb-name">${escapeHtml(row.name)}</td>
        <td class="lb-num">${formatNum(row.score)}</td>
        <td class="lb-num">${formatNum(row.docsCollected)}</td>
        <td class="lb-date">${escapeHtml(date)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    if (hint) {
      hint.textContent =
        e instanceof Error ? e.message : "Could not load leaderboard.";
    }
  }
}

function formatPlayedAt(raw) {
  const s = String(raw);
  const isoish = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(isoish);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? String(Math.floor(x)) : "—";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
