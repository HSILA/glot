
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

function isSafeNext(value: string | null | undefined): value is string {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  // Reject protocol-relative ("//evil.com") and backslash tricks ("/\evil.com").
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value.includes("\\")) return false;
  return true;
}

/**
 * Returns the redirect target for an authenticated user hitting an auth page.
 * Exported for unit testing; not part of the middleware public API.
 */
export function resolveAuthPageRedirect(searchParams: URLSearchParams): string {
  const next = searchParams.get("next");
  return isSafeNext(next) ? next : "/";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check for access_token cookie
  const accessToken = request.cookies.get('access_token')?.value

  // Public paths: /login and /register
  // If user is logged in (has token), they shouldn't see these pages
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/register')

  if (isAuthPage && accessToken) {
    // Honor a safe `next` param so /login?next=/decks → /decks, not /.
    const target = resolveAuthPageRedirect(request.nextUrl.searchParams)
    return NextResponse.redirect(new URL(target, request.url))
  }

  // Optional: Protect other routes
  // If we wanted to force login for dashboard routes here, we could:
  // const isPublicPath = isAuthPage || pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname === '/favicon.ico'
  // if (!accessToken && !isPublicPath) {
  //   return NextResponse.redirect(new URL('/login', request.url))
  // }

  return NextResponse.next()
}

// Configure paths to run middleware on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
