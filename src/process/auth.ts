import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { readSecret } from '@/lib/secrets';

const SCAN_TOKEN_TTL = 604800; // 7 days

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

// ── Scan Token ──
// Encodes: email, targetUrl, includeSummary, nonce, expiresAt, signature

export interface ScanTokenPayload {
	email: string;
	targetUrl: string;
	includeSummary: boolean;
}

export function generateScanToken(payload: ScanTokenPayload): string {
	const nonce = randomBytes(16).toString('hex');
	const expiresAt = Math.floor(Date.now() / 1000) + SCAN_TOKEN_TTL;
	const summary = payload.includeSummary ? '1' : '0';
	const data = `${payload.email}|${payload.targetUrl}|${summary}|${nonce}|${expiresAt}`;
	const signature = hmacSign(data);
	return Buffer.from(`${data}|${signature}`).toString('base64url');
}

export function verifyScanToken(token: string): { valid: boolean; payload?: ScanTokenPayload; error?: string } {
	try {
		const decoded = Buffer.from(token, 'base64url').toString();
		const parts = decoded.split('|');
		if (parts.length !== 6) return { valid: false, error: 'Ongeldig token formaat' };

		const [email, targetUrl, summary, nonce, expiresAtStr, signature] = parts;
		const expiresAt = Number.parseInt(expiresAtStr, 10);
		const now = Math.floor(Date.now() / 1000);

		if (now > expiresAt) return { valid: false, error: 'Link verlopen' };

		const data = `${email}|${targetUrl}|${summary}|${nonce}|${expiresAt}`;
		if (!hmacVerify(data, signature)) {
			return { valid: false, error: 'Ongeldige link' };
		}

		return {
			valid: true,
			payload: {
				email,
				targetUrl,
				includeSummary: summary === '1',
			},
		};
	} catch {
		return { valid: false, error: 'Link kon niet worden gelezen' };
	}
}
