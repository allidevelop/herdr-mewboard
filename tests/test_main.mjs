// The popup with a fake Herdr host and a fake Mewboard API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const state = new Map(), calls = [], requests = [], notes = [];
let focus = { space: 's1', terminal: 't9', cwd: null }, agentsList = [{ address: 't9', space: 's1', app: 'claude-code' }], down = false, clipboard = 'mine', hcResult = { code: 0, stdout: '', stderr: '' };
const spacesList = [{ id: 's1', active: true, folder: 'C:\\DEV\\streetsushi', machine: null, tabs: [] }];
const PROJECTS = [{ id: 'p1', key: 'SS', name: 'StreetSushi' }, { id: 'p2', key: 'MB', name: 'Mewboard' }];
const ISSUES = { SS: [{ id: 'i1', identifier: 'SS-1', title: 'Корзина', status: 'todo', status_name: 'К выполнению', priority: 'none', project_id: 'p1' },
  { id: 'i2', identifier: 'SS-2', title: 'Оплата', status: 'in_progress', status_name: 'В работе', priority: 'high', project_id: 'p1', description: 'Подключить LiqPay' }],
  MB: [{ id: 'i3', identifier: 'MB-7', title: 'Мод для Herdr', status: 'in_progress', priority: 'none', project_id: 'p2' }] };
async function fetch(url, init = {}) {
  requests.push({ url, ...init });
  if (down) throw new TypeError('error sending request: connection refused');
  const u = new URL(url), path = u.pathname;
  let body = [];
  if (path === '/api/projects') body = PROJECTS;
  else if (path === '/api/issues') body = u.searchParams.get('assignee') === 'me' ? [...ISSUES.SS, ...ISSUES.MB] : ISSUES[u.searchParams.get('project')] ?? [];
  else if (path.startsWith('/api/issues/')) body = { ok: true };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
}
const host = {
  spaces: () => spacesList, agents: () => agentsList, focused: () => focus, shared: (k) => state.get(k), setShared: (k, v) => state.set(k, v),
  props: () => ({ overlay: 'ov1' }), closeOverlay: (id) => calls.push({ close: id }), notify: (n) => notes.push(n),
  run: (name, args) => calls.push({ name, args }), hc: async (args) => { calls.push({ hc: args }); return hcResult; },
  theme: () => new Proxy({}, { get: () => '#777777' }), readTextFile: async () => null, appHome: () => 'C:\\Users\\x\\.config\\herdr-app',
  window: () => ({ platform: 'windows' }),
};
const element = () => new Proxy(function () {}, { get: (_, key) => key === 'then' ? undefined : (...args) => (key === 'when' ? (args[0] ? args[1](element()) : element()) : element()), apply: () => element() });
const input = () => ({ text: '', events: {}, value() { return this.text; }, set_value(v) { this.text = v; }, on(k, fn) { this.events[k] = fn; }, focus() {} });
const context = vm.createContext({ console, JSON, Object, String, Number, Math, Array, Promise, Error, TypeError, URL, encodeURIComponent, fetch });
const shim = (exports) => new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context });
const modules = {
  herdr: shim(host), 'gpui-kit': shim({ View: class {}, div: element }),
  'gpui-base': shim({ v_flex: element, h_flex: element, InputState: { new: input }, Input: { new: element }, ScrollHandle: { new: () => ({ scroll_to_item() {} }) } }),
};
const model = new vm.SourceTextModule(fs.readFileSync(new URL('../mods/mewboard/model.js', import.meta.url), 'utf8'), { context });
const main = new vm.SourceTextModule(fs.readFileSync(new URL('../mods/mewboard/main.js', import.meta.url), 'utf8'), { context });
await model.link(() => { throw new Error('model.js imports nothing'); });
await main.link((spec) => (spec === './model.js' ? model : modules[spec]));
await main.evaluate();
const Mewboard = main.namespace.default;

function newCx() {
  const cx = { tasks: [], timers: [], notify() {}, stop_propagation() {}, focus_handle: () => ({ focus() {} }),
    timer: { after: (ms, fn) => cx.timers.push(fn), every() {} },
    spawn(fn) { const p = fn(cx); cx.tasks.push(p); return p; },
    read_from_clipboard: () => clipboard, write_to_clipboard: (t) => { clipboard = t; }, open_url: (u) => calls.push({ open: u }) };
  return cx;
}
async function settle(cx) { while (cx.tasks.length) await Promise.all(cx.tasks.splice(0)); }
async function open() { const cx = newCx(), view = new Mewboard(); view.init({}, cx); await settle(cx); view.render(cx); return { view, cx }; }
let n = 0;
const deq = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };

await test('the folder name finds the project; its open tasks come in work order', async () => {
  const { view } = await open();
  assert.equal(view.project.key, 'SS');
  deq(view.rows().map((i) => i.identifier), ['SS-2', 'SS-1']);
  assert.ok(requests.some((r) => r.url.includes('/api/issues?project=SS')));
});
await test('Enter pastes the task into the agent and gives the clipboard back', async () => {
  const { view, cx } = await open(); calls.length = 0;
  view.input.events.submit({ secondary: false }, cx);
  assert.ok(clipboard.startsWith('Задача SS-2: Оплата\n\nПодключить LiqPay'));
  deq(calls.map((c) => c.name).filter(Boolean), ['pane.focus', 'terminal.paste']);
  assert.equal(calls[0].args.terminal, 't9');
  cx.timers.pop()(cx);
  assert.equal(clipboard, 'mine'); deq(calls.at(-1), { close: 'ov1' });
});
await test('Ctrl+Enter sends now through hc send; Alt+Enter opens Mewboard', async () => {
  const { view, cx } = await open(); calls.length = 0;
  view.handOver(view.rows()[0], cx); await settle(cx);
  deq(calls[0].hc.slice(0, 2), ['send', 't9']);
  assert.ok(notes.at(-1).title.includes('Отдано'));
  view.open(view.rows()[1], cx);
  deq(calls.at(-1), { open: 'http://127.0.0.1:4800/#/i/SS-1' });
  hcResult = { code: 1, stdout: '', stderr: 'terminal t9 not found' };
  view.handOver(view.rows()[0], cx); await settle(cx);
  assert.match(view.error, /t9 not found/); hcResult = { code: 0, stdout: '', stderr: '' };
});
await test('status buttons patch the issue and reload the list', async () => {
  const { view, cx } = await open(); requests.length = 0;
  view.setStatus(view.rows()[1], 'in_progress', cx); await settle(cx);
  const patch = requests.find((r) => r.method === 'PATCH');
  deq([patch.url, JSON.parse(patch.body)], ['http://127.0.0.1:4800/api/issues/SS-1', { status: 'in_progress' }]);
  assert.ok(requests.some((r) => r.url.includes('/api/issues?project=SS')), 'reloaded');
  assert.match(view.note, /SS-1 → В работе/);
});
await test('an unknown folder asks for its project and remembers the choice', async () => {
  spacesList[0].folder = 'C:\\DEV\\notes-app';
  const { view, cx } = await open();
  assert.equal(view.picking, true); assert.equal(view.project, null);
  view.input.text = 'mew'; view.query = 'mew';
  deq(view.rows().map((p) => p.key), ['MB']);
  view.input.events.submit({ secondary: false }, cx); await settle(cx);
  assert.equal(view.project.key, 'MB'); assert.equal(view.picking, false);
  deq(state.get('mewboard.projects.v1'), { 'c:/dev/notes-app': 'MB' });
  deq(view.rows().map((i) => i.identifier), ['MB-7']);
  const again = await open();
  assert.equal(again.view.project.key, 'MB'); assert.equal(again.view.match.how, 'saved');
});
await test('Tab shows all my tasks with their project', async () => {
  const { view, cx } = await open();
  view.switchMode(cx); await settle(cx); view.render(cx);
  assert.equal(view.mode, 'mine');
  deq(view.rows().map((i) => `${i.project_key}:${i.identifier}`), ['SS:SS-2', 'MB:MB-7', 'SS:SS-1']);
});
await test('a plain shell never gets a task: its lines would run as commands', async () => {
  agentsList = [];
  const { view, cx } = await open(); calls.length = 0;
  view.paste(view.rows()[0], cx); view.handOver(view.rows()[0], cx); await settle(cx);
  deq(calls, []); assert.match(notes.at(-1).title, /Здесь нет агента/);
  agentsList = [{ address: 't9', space: 's1' }];
});
await test('agent choice: focused agent, then the remembered one, then the only one; several ask', async () => {
  state.set('files.agents', { s1: 't4' });
  agentsList = [{ address: 't9', space: 's1' }, { address: 't4', space: 's1' }];
  let r = await open(); calls.length = 0; r.view.paste(r.view.rows()[0], r.cx);
  assert.equal(calls[0].args.terminal, 't9', 'the focused agent');
  focus = { space: 's1', terminal: 't2' };
  r = await open(); calls.length = 0; r.view.paste(r.view.rows()[0], r.cx);
  assert.equal(calls[0].args.terminal, 't4', 'the focused terminal is a shell: ProdAdvice remembers t4');
  state.delete('files.agents');
  r = await open(); calls.length = 0; r.view.paste(r.view.rows()[0], r.cx);
  deq(calls, []); assert.match(notes.at(-1).title, /Какому агенту/);
  agentsList = [{ address: 'vps/t7', space: 's1' }, { address: 't1', space: 'other' }];
  r = await open(); calls.length = 0; r.view.paste(r.view.rows()[0], r.cx);
  assert.equal(calls[0].args.terminal, 'vps/t7', 'the only agent of this space');
  focus = { space: 's1', terminal: 't9' }; agentsList = [{ address: 't9', space: 's1' }];
});
await test('Mewboard down: a plain explanation, no crash', async () => {
  down = true;
  const { view, cx } = await open();
  assert.match(view.error, /Mewboard не отвечает на http:\/\/127\.0\.0\.1:4800/);
  view.render(cx); down = false;
});
console.log(`${n} popup tests passed`);
