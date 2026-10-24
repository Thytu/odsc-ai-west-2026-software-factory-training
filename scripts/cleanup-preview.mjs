const token = process.env.VERCEL_PREVIEW_CLEANUP_TOKEN;
const project = process.env.VERCEL_PROJECT_ID;
const team = process.env.VERCEL_TEAM_ID;
const branch = process.env.PREVIEW_BRANCH;
if (!token || !project || !team || !branch || ['main', 'workshop-start'].includes(branch)) throw new Error('Expected a project, team, token, and non-production branch.');

async function api(path, method = 'GET') {
  const url = new URL(path, 'https://api.vercel.com');
  url.searchParams.set('teamId', team);
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (response.status === 404 && method === 'DELETE') return;
  if (!response.ok) throw new Error(`Vercel ${method} request failed (${response.status}).`);
  return response.status === 204 ? undefined : response.json();
}

const deployments = [];
let until;
do {
  const query = new URLSearchParams({ projectId: project, limit: '100' });
  if (until) query.set('until', String(until));
  const page = await api(`/v6/deployments?${query}`);
  for (const deployment of page.deployments) {
    if (deployment.target !== 'production' && deployment.meta?.githubCommitRef === branch) deployments.push(deployment.uid);
  }
  until = page.pagination?.next;
} while (until);
for (const id of deployments) {
  await api(`/v13/deployments/${encodeURIComponent(id)}`, 'DELETE');
  const url = new URL(`/v13/deployments/${encodeURIComponent(id)}`, 'https://api.vercel.com');
  url.searchParams.set('teamId', team);
  const removed = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
  if (removed.status !== 404) throw new Error(`Preview deletion could not be verified (${removed.status}).`);
  console.log(`Removed preview deployment ${id}.`);
}
console.log(`Removed ${deployments.length} deployment(s) for ${branch}. Neon removes its branch after the final deployment is deleted.`);
