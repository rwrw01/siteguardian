import { type NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { verifyMagicToken, createSessionCookie } from '@/process/auth';

// Simple in-memory set for one-time use tokens (in production, use Redis)
const usedTokens = new Set<string>();

export async function GET(request: NextRequest) {
	const token = request.nextUrl.searchParams.get('token');

	if (!token) {
		return NextResponse.redirect(new URL('/login?error=missing_token', request.url));
	}

	// One-time use check
	const tokenHash = createHash('sha256').update(token).digest('hex');
	if (usedTokens.has(tokenHash)) {
		return NextResponse.redirect(new URL('/login?error=token_used', request.url));
	}

	const result = verifyMagicToken(token);
	if (!result.valid || !result.email) {
		return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(result.error ?? 'invalid')}`, request.url));
	}

	// Mark as used
	usedTokens.add(tokenHash);
	// Clean up old tokens after 15 minutes
	setTimeout(() => usedTokens.delete(tokenHash), 900_000);

	// Create session
	const session = createSessionCookie(result.email);
	const response = NextResponse.redirect(new URL('/', request.url));
	response.cookies.set('sg_session', session.value, {
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		path: '/',
		maxAge: session.maxAge,
	});

	return response;
}
