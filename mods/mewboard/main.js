// Mewboard for Herdr: the open tasks of this folder's Mewboard project (or all of
// yours) in a popup, handed to the agent of this space in one key.
//
// Enter: paste the task into the agent's input (not sent) · Cmd/Ctrl+Enter: send it
// to the agent now · Alt+Enter: open it in Mewboard · Tab: project / mine · Esc: close.
// A folder without a project shows a project list; the choice is remembered.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, agents, focused, shared, setShared, props, closeOverlay, notify, run, hc, theme, readTextFile, appHome, window } from "herdr";
import { DEFAULT_BASE, client, matchProject, folderKey, leaf, sortIssues, filterIssues, filterProjects, issueUrl, agentText } from "./model.js";

const SAVED = "mewboard.projects.v1";
const ru = () => shared("ui.lang") !== "en";
const L = (en, rus) => (ru() ? rus : en);
const mac = () => window()?.platform === "macos";
const keyName = (k) => (mac() ? { primary: "⌘", alt: "⌥" } : { primary: "Ctrl+", alt: "Alt+" })[k];
const KIND = {
  in_progress: () => L("In progress", "В работе"), in_review: () => L("In review", "На проверке"),
  todo: () => L("To do", "К выполнению"), backlog: () => L("Backlog", "Бэклог"), done: () => L("Done", "Готово"),
};
const ROW = 34, LIST_MAX = 470;

// The space the popup was opened from: its project folder (as ProdAdvice keeps it,
// else the space folder), the terminal that had the focus and the one ProdAdvice
// remembers for the space. Which of them gets a task is decided in target().
function context() {
  const f = focused();
  const s = spaces().find((x) => (f?.space ? x.id === f.space : x.active));
  const folder = (s && (shared("files.workspace-roots") ?? {})[s.id]) || s?.folder || f?.cwd || null;
  return { space: s?.id ?? null, folder, focused: f?.terminal ?? null, remembered: (s && (shared("files.agents") ?? {})[s.id]) || null };
}

// Optional mods/mewboard/mewboard.local.json: { "base": "https://…", "token": "mb_…" }.
// Without it the local Mewboard (127.0.0.1:4800) is used, which needs no token.
async function config() {
  try {
    const text = await readTextFile(`${appHome()}/mods/mewboard/mewboard.local.json`);
    const c = text ? JSON.parse(text) : {};
    return { base: c.base || DEFAULT_BASE, token: c.token || "" };
  } catch { return { base: DEFAULT_BASE, token: "" }; }
}

export default class Mewboard extends View {
  init(_p, cx) {
    this.h = cx.focus_handle();
    this.ctx = context();
    this.mode = "project"; this.picking = false;
    this.at = 0; this.query = ""; this.issues = null; this.projects = [];
    this.project = null; this.match = null; this.error = null; this.busy = true; this.note = null;
    this.scroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: L("Filter…", "Фильтр…") });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; cx.notify(); });
    // Cmd/Ctrl+Enter also submits (secondary); the key handler owns it.
    this.input.on("submit", (e, cx) => { if (!e?.secondary) this.primary(cx); });
    this.input.focus();
    cx.timer.after(400, () => this.input.focus());
    cx.spawn(async (cx) => { await this.load(cx); });
    cx.timer.every(30000, (cx) => { if (!this.picking && !this.busy) cx.spawn(async (cx) => this.refresh(cx)); });
  }

  // ---------- data ----------

  async load(cx) {
    this.busy = true; cx.notify();
    try {
      this.api = client(await config());
      this.projects = await this.api.projects();
      this.byId = Object.fromEntries(this.projects.map((p) => [p.id, p]));
      this.match = matchProject(this.ctx.folder, this.projects, shared(SAVED) ?? {});
      this.project = this.match.project;
      this.picking = !this.project;
      if (this.picking) this.setPlaceholder();
      await this.fetchIssues();
      this.error = null;
    } catch (e) { this.error = this.explain(e); }
    this.busy = false; cx.notify();
  }

  async refresh(cx) {
    try { await this.fetchIssues(); this.error = null; } catch (e) { this.error = this.explain(e); }
    cx.notify();
  }

  async fetchIssues() {
    const list = this.mode === "mine" ? await this.api.myIssues() : this.project ? await this.api.projectIssues(this.project.key) : [];
    this.issues = sortIssues(list.map((i) => ({ ...i, project_key: this.byId?.[i.project_id]?.key, project_name: this.byId?.[i.project_id]?.name })));
  }

  explain(e) {
    const text = String(e?.message ?? e);
    if (/fetch|connect|refused|request|network|dns|timed out/i.test(text) || e instanceof TypeError)
      return L(`Mewboard does not answer at ${this.api?.base ?? DEFAULT_BASE}. Is it running?`, `Mewboard не отвечает на ${this.api?.base ?? DEFAULT_BASE}. Он запущен?`);
    return text;
  }

  rows() {
    if (this.picking) return filterProjects(this.projects, this.query);
    return filterIssues(this.issues ?? [], this.query);
  }

  // A new list starts unfiltered (the placeholder is fixed at creation).
  setPlaceholder() {
    this.input.set_value(""); this.query = "";
  }

  // ---------- actions ----------

  close() { closeOverlay(props().overlay); }

  switchMode(cx) {
    if (this.picking && this.project) this.picking = false;
    this.mode = this.mode === "project" ? "mine" : "project";
    this.picking = this.mode === "project" && !this.project;
    this.at = 0; this.setPlaceholder();
    cx.spawn(async (cx) => this.refresh(cx));
  }

  startPicking(cx) {
    this.mode = "project"; this.picking = true; this.at = 0; this.setPlaceholder(); cx.notify();
  }

  choose(project, cx) {
    if (!project) return;
    const saved = { ...(shared(SAVED) ?? {}) };
    if (this.ctx.folder) { saved[folderKey(this.ctx.folder)] = project.key; setShared(SAVED, saved); }
    this.project = project; this.match = { project, how: "saved" };
    this.picking = false; this.at = 0; this.setPlaceholder();
    this.issues = null;
    cx.spawn(async (cx) => this.refresh(cx));
  }

  primary(cx) {
    const row = this.rows()[this.at];
    if (this.picking) this.choose(row, cx); else this.paste(row, cx);
  }

  // Only a terminal whose program reports agent status (Claude Code, Codex…) gets a
  // task: a plain shell would run the task's lines as commands. The focused agent,
  // then the one ProdAdvice remembers, then the space's only agent; never a guess.
  target() {
    const live = agents().filter((a) => a.space === this.ctx.space);
    const isAgent = (t) => Boolean(t) && live.some((a) => a.address === t);
    const pick = [this.ctx.focused, this.ctx.remembered].find(isAgent) ?? (live.length === 1 ? live[0].address : null);
    if (pick) return pick;
    notify(live.length
      ? { title: L("Which agent?", "Какому агенту?"), body: L("This space has several agents: click the one you need, then open the tasks again", "В пространстве несколько агентов: кликни в нужного и открой задачи снова"), level: "warning" }
      : { title: L("No agent here", "Здесь нет агента"), body: L("Start Claude Code or Codex in this space. A plain shell would run the task's lines as commands", "Запусти в этом пространстве Claude Code или Codex. Обычная оболочка выполнила бы строки задачи как команды"), level: "warning" });
    return null;
  }

  // Into the agent's input, not sent. Herdr's own clipboard, then the old text back.
  paste(issue, cx) {
    const terminal = issue && this.target();
    if (!terminal) return;
    let old = null;
    try { old = cx.read_from_clipboard(); } catch { old = null; }
    cx.write_to_clipboard(agentText(issue, this.api.base, ru()));
    run("pane.focus", { terminal });
    run("terminal.paste");
    this.note = L(`${issue.identifier} pasted into the agent's input`, `${issue.identifier} вставлена в поле агента`);
    // The paste reads the clipboard after this call returns: give it back a moment later.
    cx.timer.after(700, (cx) => {
      if (old != null) { try { cx.write_to_clipboard(old); } catch { /* the popup may be gone */ } }
      this.close();
    });
  }

  // Sent to the agent now, as if typed and submitted (herdr-core's `hc send`).
  handOver(issue, cx) {
    const terminal = issue && this.target();
    if (!terminal) return;
    const text = agentText(issue, this.api.base, ru());
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["send", terminal, text]);
        if (r && r.code) throw new Error((r.stderr || r.stdout || "").trim() || "hc send failed");
        notify({ title: L("Sent to the agent", "Отдано агенту"), body: `${issue.identifier}: ${issue.title}`, level: "info" });
        this.close();
      } catch (e) {
        this.note = null; this.error = String(e?.message ?? e); cx.notify();
      }
    });
  }

  open(issue, cx) {
    if (!issue) return;
    try { cx.open_url(issueUrl(this.api.base, issue.identifier)); }
    catch (e) { this.error = String(e?.message ?? e); }
  }

  setStatus(issue, kind, cx) {
    if (!issue) return;
    cx.spawn(async (cx) => {
      try {
        await this.api.setStatus(issue.identifier, kind);
        this.note = `${issue.identifier} → ${KIND[kind]?.() ?? kind}`;
        notify({ title: this.note, body: issue.title, level: "info" });
        await this.fetchIssues();
        this.at = Math.min(this.at, Math.max(0, this.rows().length - 1));
        this.error = null;
      } catch (e) { this.error = this.explain(e); }
      cx.notify();
    });
  }

  // ---------- drawing ----------

  render(cx) {
    const t = theme(), rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    const current = rows[this.at];
    const mono = { family: "JetBrains Mono" };  // shipped with Herdr

    const tab = (id, label) => {
      const on = this.mode === id;
      return div().id(`mb-tab-${id}`).px(10).py(4).rounded(6).cursor_pointer().text_size(12)
        .when(on, (el) => el.bg(t.hover).text_color(t.foreground)).when(!on, (el) => el.text_color(t.dim).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => { if (!on) this.switchMode(cx); })
        .child(label);
    };
    const projectLabel = this.project ? `${this.project.key} · ${this.project.name}` : L("Choose project", "Выбрать проект");

    const statusColor = (kind) => ({ in_progress: t.working, in_review: t.blocked, todo: t.foreground, backlog: t.dim })[kind] ?? t.muted;
    const priorityDot = (p) => p === "urgent" ? t.blocked : p === "high" ? t.working : null;

    const issueRow = (i, n) => {
      const on = n === this.at, dot = priorityDot(i.priority);
      return h_flex().id(`mb-row-${n}`).h(ROW).flex_none().mx(4).px(10).gap(10).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.at = n; this.input.focus(); cx.notify(); })
        .child(div().w(8).flex_none().child(dot ? div().size(6).rounded(3).bg(dot) : div()))
        .child(div().w(78).flex_none().font_family(mono.family).text_size(12).text_color(t.muted).child(i.identifier))
        .child(div().w(112).flex_none().truncate().text_size(12).text_color(statusColor(i.status)).child(`${i.status_icon ? i.status_icon + " " : ""}${i.status_name || KIND[i.status]?.() || i.status}`))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(i.title))
        .when(this.mode === "mine" && Boolean(i.project_key), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(i.project_key)))
        .when(Boolean(i.due_date), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(i.due_date)));
    };
    const projectRow = (p, n) => {
      const on = n === this.at;
      return h_flex().id(`mb-proj-${n}`).h(ROW).flex_none().mx(4).px(10).gap(10).items_center().rounded(7).cursor_pointer()
        .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.choose(p, cx))
        .child(div().w(78).flex_none().font_family(mono.family).text_size(12).text_color(t.muted).child(p.key))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(p.name))
        .when(Boolean(p.path), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).truncate().max_w(220).child(String(p.path))));
    };

    const button = (id, label, fn, primary = false) => div().id(id).px(10).py(5).rounded(6).flex_none().cursor_pointer().text_size(12)
      .border_1().border_color(primary ? t.accent : t.border).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { fn(cx); cx.notify(); }).child(label);

    let status;
    if (this.error) status = this.error;
    else if (this.busy) status = L("Loading…", "Загружаю…");
    else if (this.note) status = this.note;
    else if (this.picking) status = this.ctx.folder
      ? L(`Which project is "${leaf(this.ctx.folder)}"? The choice is remembered for this folder.`, `Какой проект у папки «${leaf(this.ctx.folder)}»? Выбор запомнится для неё.`)
      : L("Choose a project.", "Выберите проект.");
    else status = L(`${rows.length} open`, `Открытых: ${rows.length}`) + (this.mode === "project" && this.match?.how === "name" ? L(" · project found by folder name", " · проект найден по имени папки") : "");

    const hint = this.picking
      ? L("Enter choose · Tab my tasks · Esc close", "Enter выбрать · Tab мои задачи · Esc закрыть")
      : L(`Enter paste to agent · ${keyName("primary")}Enter send now · ${keyName("alt")}Enter open in Mewboard · Tab switch`,
        `Enter вставить агенту · ${keyName("primary")}Enter отдать сразу · ${keyName("alt")}Enter открыть в Mewboard · Tab режим`);

    const list = rows.length
      ? v_flex().id("mb-list").h(Math.min(LIST_MAX, rows.length * ROW)).flex_none().overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map((r, n) => (this.picking ? projectRow(r, n) : issueRow(r, n))))
      : div();
    const empty = !rows.length && !this.busy && !this.error;

    return v_flex().id("mewboard").track_focus(this.h).w_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key, m = e.modifiers ?? {}, row = this.rows()[this.at];
        if (k === "escape") return this.close();
        if (k === "tab") this.switchMode(cx);
        else if (k === "down" && rows.length) { this.at = (this.at + 1) % rows.length; this.scroll.scroll_to_item(this.at); }
        else if (k === "up" && rows.length) { this.at = (this.at + rows.length - 1) % rows.length; this.scroll.scroll_to_item(this.at); }
        else if (k === "enter" && (mac() ? m.platform : m.control) && !this.picking) this.handOver(row, cx);
        else if (k === "enter" && m.alt && !this.picking) this.open(row, cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().items_center().gap(4)
        .child(div().px(6).font_weight(600).text_color(t.foreground).child("Mewboard"))
        .child(tab("project", L("Project", "Проект")))
        .child(tab("mine", L("My tasks", "Мои задачи")))
        .child(div().flex_1())
        .when(this.mode === "project", (el) => el.child(div().id("mb-project").px(8).py(3).rounded(6).max_w(300).truncate().cursor_pointer()
          .text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.startPicking(cx)).child(projectLabel)))
        .child(div().id("mb-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(14).text_color(t.foreground)))
      .child(div().text_size(12).text_color(this.error ? t.blocked : t.dim).child(status))
      .child(empty ? div().py(18).text_color(t.dim).child(this.picking ? L("No projects match.", "Проекты не найдены.") : L("No open tasks here.", "Открытых задач нет.")) : list)
      .when(Boolean(current) && !this.picking, (el) => el.child(h_flex().gap(6).flex_wrap()
        .child(button("mb-paste", L("Paste to agent", "Вставить агенту"), (cx) => this.paste(current, cx), true))
        .child(button("mb-send", L("Send now", "Отдать сразу"), (cx) => this.handOver(current, cx)))
        .child(button("mb-open", L("Open", "Открыть"), (cx) => this.open(current, cx)))
        .child(div().w(10))
        .child(button("mb-progress", KIND.in_progress(), (cx) => this.setStatus(current, "in_progress", cx)))
        .child(button("mb-review", KIND.in_review(), (cx) => this.setStatus(current, "in_review", cx)))
        .child(button("mb-done", KIND.done(), (cx) => this.setStatus(current, "done", cx)))))
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }
}
