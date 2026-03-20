import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { readSecret } from '@/lib/secrets';

const MAGIC_LINK_TTL = 600; // 10 minutes
const SESSION_MAX_AGE = 28800; // 8 hours

function getAuthSecret(): string {
	const secret = readSecret('auth_secret', 'AUTH_SECRET');
	if (!secret) throw new Error('AUTH_SECRET niet geconfigureerd');
	return secret;
}

function hmacSign(data: string): string {
	return createHmac('sha256', getAuthSecret()).update(data).digest('hex');
}

function hmacVerify(data: string, signature: string): boolean {
	const expected = hmacSign(data);
	if (expected.length !== signature.length) return false;
	return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// ── Magic Link Tokens ──

export function generateMagicToken(email: string): string {
	const nonce = randomBytes(16).toString('hex');
	const expiresAt = Math.floor(Date.now() / 1000) + MAGIC_LINK_TTL;
	const payload = `${email}:${nonce}:${expiresAt}`;
	const signature = hmacSign(payload);
	return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

export function verifyMagicToken(token: string): { valid: boolean; email?: string; error?: string } {
	try {
		const decoded = Buffer.from(token, 'base64url').toString();
		const parts = decoded.split(':');
		if (parts.length !== 4) return { valid: false, error: 'Ongeldig token formaat' };

		const [email, nonce, expiresAtStr, signature] = parts;
		const expiresAt = Number.parseInt(expiresAtStr, 10);
		const now = Math.floor(Date.now() / 1000);

		if (now > expiresAt) return { valid: false, error: 'Token verlopen' };
		if (!hmacVerify(`${email}:${nonce}:${expiresAtStr}`, signature)) {
			return { valid: false, error: 'Ongeldige handtekening' };
		}

		return { valid: true, email };
	} catch {
		return { valid: false, error: 'Token kon niet worden gelezen' };
	}
}

// ── Session Cookies ──

export function createSessionCookie(email: string): { value: string; maxAge: number } {
	const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
	const payload = `${email}:${expiresAt}`;
	const signature = hmacSign(payload);
	const value = Buffer.from(`${payload}:${signature}`).toString('base64url');
	return { value, maxAge: SESSION_MAX_AGE };
}

export function verifySession(cookieValue: string): { valid: boolean; email?: string } {
	try {
		const decoded = Buffer.from(cookieValue, 'base64url').toString();
		const parts = decoded.split(':');
		if (parts.length !== 3) return { valid: false };

		const [email, expiresAtStr, signature] = parts;
		const expiresAt = Number.parseInt(expiresAtStr, 10);
		const now = Math.floor(Date.now() / 1000);

		if (now > expiresAt) return { valid: false };
		if (!hmacVerify(`${email}:${expiresAtStr}`, signature)) return { valid: false };

		return { valid: true, email };
	} catch {
		return { valid: false };
	}
}
