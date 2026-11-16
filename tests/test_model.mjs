// The pure part of the mod: project matching, ordering, filters, agent text, API calls.
import assert from 'node:assert/strict';
import { matchProject, folderKey, sortIssues, filterIssues, filterProjects, agentText, issueUrl, client, OPEN } from '../mods/mewboard/model.js';

let n = 0;
const test = async (name, fn) => { await fn(); console.log(`ok ${++n} - ${name}`); };
const projects = [
  { id: 'p1', key: 'SS', name: 'StreetSushi' },
  { id: 'p2', key: 'BN', name: 'BookNova / BookFort' },
  { id: 'p3', key: 'KDP', name: 'kdpbot' },
  { id: 'p4', key: 'KDPS', name: 'kdpbot sites', parent_id: 'p3' },
  { id: 'p5', key: 'MB', name: 'Mewboard' },
  { id: 'p6', key: 'OLD', name: 'Old shop', deleted_at: '2026-01-01' },
];

await test('folder keys: Windows paths ignore case and separators, Unix paths keep case', () => {
  assert.equal(folderKey('C:\\Users\\X\\DEV\\Shop\\'), 'c:/users/x/dev/shop');
  assert.equal(folderKey('c:/users/x/dev/shop'), 'c:/users/x/dev/shop');
  assert.equal(folderKey('/Users/x/Shop/'), '/Users/x/Shop');
});
await test('a saved choice wins over the folder name', () => {
  const m = matchProject('C:\\DEV\\streetsushi', projects, { 'c:/dev/streetsushi': 'MB' });
  assert.deepEqual([m.project.key, m.how], ['MB', 'saved']);
});
await test('exact names match; a parent and its sub-project count once', () => {
  assert.equal(matchProject('C:\\DEV\\streetsushi', projects).project.key, 'SS');
  assert.equal(matchProject('/home/x/kdpbot', projects).project.key, 'KDP');
  assert.equal(matchProject('C:\\DEV\\kdpbot-sites-redesign', projects).project.key, 'KDP');
});
await test('prefix names match only when unambiguous; unknown folders ask', () => {
  assert.equal(matchProject('C:\\DEV\\booknova', projects).project.key, 'BN');
  const m = matchProject('C:\\DEV\\notes-app', projects);
  assert.equal(m.project, null); assert.equal(m.how, 'none');
  assert.equal(matchProject('C:\\DEV\\old-shop', projects).project, null, 'deleted projects are skipped');
});
await test('a saved project that no longer exists is reported, not replaced by a guess', () => {
  const m = matchProject('C:\\DEV\\streetsushi', projects, { 'c:/dev/streetsushi': 'GONE' });
  assert.deepEqual([m.project, m.how, m.key], [null, 'missing', 'GONE']);
});
await test('work in progress first, then priority, then the latest', () => {
  const sorted = sortIssues([
    { identifier: 'A', status: 'backlog', priority: 'urgent' },
    { identifier: 'B', status: 'in_progress', priority: 'low', updated_at: '2026-01-02' },
    { identifier: 'C', status: 'in_progress', priority: 'high' },
    { identifier: 'D', status: 'in_progress', priority: 'low', updated_at: '2026-01-03' },
    { identifier: 'E', status: 'in_review', priority: 'none' },
  ]);
  assert.deepEqual(sorted.map((i) => i.identifier), ['C', 'D', 'B', 'E', 'A']);
});
await test('filters: every word, in key, title, status or project', () => {
  const issues = [{ identifier: 'SS-1', title: 'Корзина на сайте', status_name: 'В работе', project_key: 'SS' }, { identifier: 'BN-2', title: 'Обложки', project_key: 'BN' }];
  assert.deepEqual(filterIssues(issues, 'корзина ss').map((i) => i.identifier), ['SS-1']);
  assert.equal(filterIssues(issues, '').length, 2);
  assert.deepEqual(filterProjects(projects, 'kdp').map((p) => p.key), ['KDP', 'KDPS']);
  assert.ok(!filterProjects(projects, '').some((p) => p.key === 'OLD'));
});
await test('the agent gets the task, its bounded description and its link', () => {
  const text = agentText({ identifier: 'SS-1', title: 'Корзина', description: 'x'.repeat(5000) }, 'http://127.0.0.1:4800/');
  assert.ok(text.startsWith('Задача SS-1: Корзина\n\n'));
  assert.ok(text.endsWith('Mewboard: http://127.0.0.1:4800/#/i/SS-1'));
  assert.ok(text.length < 4200);
  assert.equal(agentText({ identifier: 'SS-2', title: 'T' }, 'http://h', false), 'Task SS-2: T\n\nMewboard: http://h/#/i/SS-2');
  assert.equal(issueUrl('https://mb.example/', 'A B-1'), 'https://mb.example/#/i/A%20B-1');
});
await test('API calls: the same routes as Mewboard MCP, token only when set, errors surface', async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, ...init }); return { ok: !url.includes('BAD'), status: url.includes('BAD') ? 404 : 200, text: async () => url.includes('BAD') ? '{"error":"Issue not found"}' : '[]' }; };
  const api = client({ base: 'http://127.0.0.1:4800/', fetch: fake });
  await api.myIssues(); await api.projectIssues('SS'); await api.setStatus('SS-1', 'done');
  assert.equal(calls[0].url, `http://127.0.0.1:4800/api/issues?assignee=me&status=${OPEN.join(',')}&limit=300`);
  assert.ok(calls[1].url.includes('project=SS&include_subprojects=true'));
  assert.deepEqual([calls[2].method, calls[2].url, JSON.parse(calls[2].body)], ['PATCH', 'http://127.0.0.1:4800/api/issues/SS-1', { status: 'done' }]);
  assert.ok(!('Authorization' in calls[0].headers));
  await client({ token: 'mb_x', fetch: fake }).projects();
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer mb_x');
  await assert.rejects(client({ fetch: fake }).setStatus('BAD', 'done'), /Issue not found/);
});
console.log(`${n} model tests passed`);
