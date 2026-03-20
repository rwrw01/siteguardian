import { describe, it, expect } from 'vitest';

import { authorizeScan } from './scan-authorization';

describe('authorizeScan', () => {
	it('should allow super admin ralph@athide.nl to scan anything', () => {
		expect(authorizeScan('ralph@athide.nl', 'https://rijssen-holten.nl')).toEqual({
			allowed: true,
		});
		expect(authorizeScan('ralph@athide.nl', 'https://github.com/any-org/any-repo')).toEqual({
			allowed: true,
		});
		expect(authorizeScan('Ralph@Athide.nl', 'https://example.com')).toEqual({
			allowed: true,
		});
	});

	it('should allow user to scan their own domain website', () => {
		expect(
			authorizeScan('jan@rijssen-holten.nl', 'https://rijssen-holten.nl'),
		).toEqual({ allowed: true });
	});

	it('should allow user to scan www subdomain of their domain', () => {
		expect(
			authorizeScan('jan@rijssen-holten.nl', 'https://www.rijssen-holten.nl'),
		).toEqual({ allowed: true });
	});

	it('should allow user with subdomain email to scan parent domain', () => {
		expect(
			authorizeScan('jan@ict.rijssen-holten.nl', 'https://rijssen-holten.nl'),
		).toEqual({ allowed: true });
	});

	it('should allow user to scan their GitHub org repos', () => {
		expect(
			authorizeScan('jan@rijssen-holten.nl', 'https://github.com/rijssen-holten/website'),
		).toEqual({ allowed: true });
	});

	it('should deny user scanning a different domain', () => {
		const result = authorizeScan('jan@rijssen-holten.nl', 'https://amsterdam.nl');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('rijssen-holten.nl');
		expect(result.reason).toContain('amsterdam.nl');
	});

	it('should deny user scanning a different GitHub org', () => {
		const result = authorizeScan(
			'jan@rijssen-holten.nl',
			'https://github.com/amsterdam/website',
		);
		expect(result.allowed).toBe(false);
	});

	it('should be case-insensitive for email', () => {
		expect(
			authorizeScan('Jan@Rijssen-Holten.NL', 'https://rijssen-holten.nl'),
		).toEqual({ allowed: true });
	});

	it('should reject invalid email', () => {
		expect(() => authorizeScan('invalid', 'https://example.com')).toThrow(
			'Ongeldig e-mailadres',
		);
	});

	it('should reject invalid URL', () => {
		expect(() => authorizeScan('jan@example.nl', 'not-a-url')).toThrow(
			'Ongeldige URL',
		);
	});
});
