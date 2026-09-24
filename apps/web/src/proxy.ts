import { NextResponse, type NextRequest } from 'next/server';

/**
 * Server-side route guard: signed-out visitors are sent to /login before any workspace page
 * renders. This checks only that a session *appears* to exist (access cookie, or the session
 * hint cookie that lives as long as the refresh token) — real authentication and licence
 * checks happen in the API on every request.
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has('segue_at') || request.cookies.has('segue_signed_in');
  if (hasSession) return NextResponse.next();
  const login = new URL('/login', request.url);
  const from = request.nextUrl.pathname + request.nextUrl.search;
  if (from !== '/') login.searchParams.set('from', from);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the API proxy, sign-in, Next internals and static files.
  matcher: ['/((?!api|login|_next/static|_next/image|favicon\\.svg|.*\\.(?:png|jpg|svg|ico|webp)$).*)'],
};
