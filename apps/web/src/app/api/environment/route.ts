export function GET() {
  return Response.json({
    ok: true,
    service: 'eventdesk-web',
    version: process.env.DEPLOY_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'local',
    environment: process.env.PORTLESS_URL || process.env.VERCEL_URL || 'local',
  });
}
