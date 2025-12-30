
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Check for access_token cookie
  const accessToken = request.cookies.get('access_token')?.value

  // Public paths: /login and /register
  // If user is logged in (has token), they shouldn't see these pages
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/register')

  if (isAuthPage && accessToken) {
    // Redirect to dashboard
    return NextResponse.redirect(new URL('/', request.url))
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
