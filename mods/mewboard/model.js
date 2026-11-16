// SPDX-License-Identifier: Apache-2.0
// Pure logic of the Mewboard mod: no Herdr imports, so tests can load it alone.

export const DEFAULT_BASE = "http://127.0.0.1:4800";
// Open status kinds, in the order the list shows them.
export const OPEN = ["in_progress", "in_review", "todo", "backlog"];
const PRIORITY = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

// One spelling per folder: Windows paths compare without case or separator.
export function folderKey(path) {
  if (!path) return "";
  const s = String(path).replace(/[\\/]+$/, "");
  return /^[A-Za-z]:[\\/]|^[\\/]{2}/.test(s) ? s.replace(/\\/g, "/").toLowerCase() : s;
}
export const leaf = (path) => String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9а-яё]/g, "");

// The project for a folder: a saved choice first, then a name match that is
// unambiguous (folder "streetsushi" -> "StreetSushi"; "bookfort-assets" -> "BookFort").
export function matchProject(folder, projects, saved = {}) {
  const key = saved[folderKey(folder)];
  if (key) {
    const p = projects.find((x) => x.key === key);
    return p ? { project: p, how: "saved" } : { project: null, how: "missing", key };
  }
  const n = norm(leaf(folder));
  if (!n) return { project: null, how: "none", candidates: [] };
  const live = projects.filter((p) => !p.deleted_at);
  const exact = live.filter((p) => norm(p.key) === n || norm(p.name) === n);
  if (exact.length === 1) return { project: exact[0], how: "name" };
  const near = exact.length ? exact : live.filter((p) => {
    const name = norm(p.name);
    return name.length > 3 && n.length > 3 && (n.startsWith(name) || name.startsWith(n));
  });
  // A parent and its own sub-projects count once: take the top one.
  const tops = near.filter((p) => !near.some((q) => q.id === p.parent_id));
  if (tops.length === 1) return { project: tops[0], how: "name" };
  return { project: null, how: tops.length ? "ambiguous" : "none", candidates: tops };
}

// Status kind first (work in progress on top), then priority, then recent.
export function sortIssues(issues) {
  const rank = (i) => { const r = OPEN.indexOf(i.status); return r < 0 ? OPEN.length : r; };
  return [...issues].sort((a, b) => rank(a) - rank(b)
    || (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9)
    || String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
}

// Every space-separated word must appear in the key, title, project or status.
export function filterIssues(issues, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return issues;
  return issues.filter((i) => {
    const hay = [i.identifier, i.title, i.status_name, i.project_key, i.project_name].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
export function filterProjects(projects, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const live = projects.filter((p) => !p.deleted_at);
  return words.length ? live.filter((p) => words.every((w) => `${p.key} ${p.name}`.toLowerCase().includes(w))) : live;
}

export const issueUrl = (base, identifier) => `${String(base).replace(/\/$/, "")}/#/i/${encodeURIComponent(identifier)}`;

// What the agent gets: the task, its description (bounded) and where it lives.
export function agentText(issue, base, ru = true) {
  const desc = String(issue.description ?? "").trim();
  const body = desc.length > 4000 ? desc.slice(0, 4000) + "\n…" : desc;
  const head = ru ? `Задача ${issue.identifier}: ${issue.title}` : `Task ${issue.identifier}: ${issue.title}`;
  return [head, body, `Mewboard: ${issueUrl(base, issue.identifier)}`].filter(Boolean).join("\n\n");
}

// The REST calls the mod needs (the same ones Mewboard's MCP server makes).
export function client({ base = DEFAULT_BASE, token = "", fetch: f = globalThis.fetch } = {}) {
  const root = String(base).replace(/\/$/, "");
  async function call(method, path, body) {
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) };
    const res = await f(root + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }
  const status = OPEN.join(",");
  return {
    base: root,
    projects: () => call("GET", "/api/projects"),
    projectIssues: (key) => call("GET", `/api/issues?project=${encodeURIComponent(key)}&include_subprojects=true&status=${status}&limit=300`),
    myIssues: () => call("GET", `/api/issues?assignee=me&status=${status}&limit=300`),
    setStatus: (identifier, kind) => call("PATCH", `/api/issues/${encodeURIComponent(identifier)}`, { status: kind }),
  };
}
