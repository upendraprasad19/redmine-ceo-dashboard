import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/forgot-password', '/api/auth/login', '/api/auth/logout', '/api/auth/forgot-password', '/api/telegram/webhook', '/api/slack/events', '/api/cron', '/api/sync'];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths through
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for session cookie
  const session = request.cookies.get('ceo_session');

  if (!session?.value) {
    // Redirect to login, preserve intended destination
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Basic JWT structure check (3 base64 parts separated by dots)
  // Full verification happens in API routes via getCurrentUser()
  const parts = session.value.split('.');
  if (parts.length !== 3) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
