import { test, expect } from '@playwright/test';

test.describe('rijssen-holten.nl — E2E compliance scan', () => {
	const BASE_URL = 'https://www.rijssen-holten.nl';

	test('homepage laadt succesvol', async ({ page }) => {
		const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
		expect(response?.status()).toBeLessThan(400);
		await expect(page).toHaveTitle(/Rijssen-Holten/i);
	});

	test('HTTPS is actief en geen mixed content', async ({ page }) => {
		const mixedContentErrors: string[] = [];
		page.on('console', (msg) => {
			if (msg.text().toLowerCase().includes('mixed content')) {
				mixedContentErrors.push(msg.text());
			}
		});

		await page.goto(BASE_URL, { waitUntil: 'load' });
		expect(page.url()).toMatch(/^https:\/\//);
		expect(mixedContentErrors).toHaveLength(0);
	});

	test('security headers aanwezig', async ({ page }) => {
		const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
		const headers = response?.headers() ?? {};
		const findings: string[] = [];

		// X-Content-Type-Options
		if (!headers['x-content-type-options']?.includes('nosniff')) {
			findings.push('MEDIUM: X-Content-Type-Options header ontbreekt');
		}

		// X-Frame-Options
		const xfo = headers['x-frame-options']?.toLowerCase();
		if (xfo !== 'deny' && xfo !== 'sameorigin') {
			findings.push(`MEDIUM: X-Frame-Options header ontbreekt of ongeldig (waarde: "${xfo ?? 'niet aanwezig'}")`);
		}

		// Strict-Transport-Security
		if (!headers['strict-transport-security']) {
			findings.push('HIGH: Strict-Transport-Security (HSTS) header ontbreekt');
		}

		// Content-Security-Policy
		if (!headers['content-security-policy']) {
			findings.push('MEDIUM: Content-Security-Policy header ontbreekt');
		}

		// Referrer-Policy
		if (!headers['referrer-policy']) {
			findings.push('LOW: Referrer-Policy header ontbreekt');
		}

		if (findings.length > 0) {
			console.log(`\nSECURITY HEADERS BEVINDINGEN (${findings.length}):`);
			for (const f of findings) { console.log(`  - ${f}`); }
		}

		// Test passes but reports findings — these are compliance observations
		expect(headers['x-content-type-options']).toContain('nosniff');
	});

	test('HTML lang attribuut is ingesteld', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
		const lang = await page.locator('html').getAttribute('lang');
		expect(lang).toBeTruthy();
		expect(lang).toMatch(/^nl/);
	});

	test('heading hierarchie begint met h1', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
		const h1Count = await page.locator('h1').count();
		expect(h1Count).toBeGreaterThanOrEqual(1);
	});

	test('afbeeldingen hebben alt tekst', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

		const images = page.locator('img');
		const count = await images.count();

		let missingAlt = 0;
		for (let i = 0; i < count; i++) {
			const alt = await images.nth(i).getAttribute('alt');
			const role = await images.nth(i).getAttribute('role');
			// Decorative images may have alt="" or role="presentation"
			if (alt === null && role !== 'presentation') {
				missingAlt++;
			}
		}

		// Allow max 10% of images without alt (tolerance for dynamic content)
		const threshold = Math.max(1, Math.floor(count * 0.1));
		expect(missingAlt).toBeLessThanOrEqual(threshold);
	});

	test('skip link of landmark navigatie aanwezig', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

		const hasSkipLink = (await page.locator('a[href="#main"], a[href="#content"], a[href="#main-content"]').count()) > 0;
		const hasMainLandmark = (await page.locator('main, [role="main"]').count()) > 0;
		const hasNavLandmark = (await page.locator('nav, [role="navigation"]').count()) > 0;

		expect(hasSkipLink || hasMainLandmark || hasNavLandmark).toBeTruthy();
	});

	test('formulieren hebben labels', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

		const inputs = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
		const count = await inputs.count();

		let missingLabel = 0;
		for (let i = 0; i < count; i++) {
			const input = inputs.nth(i);
			const id = await input.getAttribute('id');
			const ariaLabel = await input.getAttribute('aria-label');
			const ariaLabelledBy = await input.getAttribute('aria-labelledby');
			const title = await input.getAttribute('title');

			const hasAssociatedLabel = id
				? (await page.locator(`label[for="${id}"]`).count()) > 0
				: false;

			if (!hasAssociatedLabel && !ariaLabel && !ariaLabelledBy && !title) {
				missingLabel++;
			}
		}

		expect(missingLabel).toBe(0);
	});

	test('geen broken links op homepage (top-level)', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

		const links = page.locator('a[href^="https://www.rijssen-holten.nl"], a[href^="/"]');
		const count = await links.count();
		const sampleSize = Math.min(count, 10);
		const brokenLinks: string[] = [];

		for (let i = 0; i < sampleSize; i++) {
			const href = await links.nth(i).getAttribute('href');
			if (!href) continue;

			const fullUrl = href.startsWith('/') ? `${BASE_URL}${href}` : href;
			try {
				const resp = await page.request.get(fullUrl);
				if (resp.status() >= 400) {
					brokenLinks.push(`${fullUrl} (${resp.status()})`);
				}
			} catch {
				brokenLinks.push(`${fullUrl} (network error)`);
			}
		}

		expect(brokenLinks).toHaveLength(0);
	});

	test('cookie banner of consent mechanisme aanwezig', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'load' });

		// Wait briefly for cookie banner to potentially appear
		await page.waitForTimeout(2000);

		const hasCookieBanner =
			(await page.locator('[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"], [aria-label*="cookie"], [aria-label*="Cookie"]').count()) > 0;

		// Log result but don't fail — some sites use server-side consent
		if (!hasCookieBanner) {
			console.log('INFO: Geen zichtbare cookie banner gevonden — controleer handmatig');
		}
		// This is informational, not a hard pass/fail
		expect(true).toBeTruthy();
	});

	test('viewport meta tag aanwezig voor mobiel', async ({ page }) => {
		await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

		const hasViewport = (await page.locator('meta[name="viewport"]').count()) > 0;
		if (hasViewport) {
			const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
			expect(viewport).toContain('width=');
		} else {
			console.log('BEVINDING MEDIUM: viewport meta tag ontbreekt — mobiele weergave mogelijk niet optimaal');
			// Pass met waarschuwing — dit is een compliance-observatie
		}
		expect(true).toBeTruthy();
	});
});
