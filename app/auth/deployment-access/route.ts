// Vercel Deployment Protection runs before this route. This is NOT an auth bypass.
// Existing workers exclude /auth/ from interception, so a deliberate navigation
// can display the deployment login instead of returning a cached offline shell.
export function GET() {
  return new Response(null, {
    status: 303,
    headers: { Location: "/", "Cache-Control": "no-store, max-age=0" },
  });
}
