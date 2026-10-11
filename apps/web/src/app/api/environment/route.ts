export function GET() {
  return Response.json({
    ok: true,
    service: 'eventdesk-web',
    version: process.env.DEPLOY_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    environment: process.env.PORTLESS_URL ?? process.env.VERCEL_URL ?? 'local',
  });
}
