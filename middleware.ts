import { type NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
	const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
	const isDev = process.env.NODE_ENV === 'development';

	const cspHeader = `
		default-src 'self';
		script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''};
		style-src 'self' 'unsafe-inline';
		img-src 'self' data:;
		font-src 'self';
		connect-src 'self';
		object-src 'none';
		base-uri 'self';
		form-action 'self';
		frame-ancestors 'none';
		upgrade-insecure-requests;
	`.replace(/\s{2,}/g, ' ').trim();

	const requestHeaders = new Headers(request.headers);
	requestHeaders.set('x-nonce', nonce);
	requestHeaders.set('Content-Security-Policy', cspHeader);

	const response = NextResponse.next({
		request: { headers: requestHeaders },
	});

	response.headers.set('Content-Security-Policy', cspHeader);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('X-XSS-Protection', '0');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
	response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

	return response;
}

export const config = {
	matcher: [
		'/((?!_next/static|_next/image|favicon.ico).*)',
	],
};
