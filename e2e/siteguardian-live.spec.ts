import { test, expect } from '@playwright/test';

const BASE = 'https://siteguardian.publicvibes.nl';

test.describe('siteguardian.publicvibes.nl — live E2E', () => {

	test('homepage laadt met correct dark theme', async ({ page }) => {
		const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
		expect(resp?.status()).toBe(200);
		await expect(page).toHaveTitle(/Site Guardian/);

		// Dark background
		const bg = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundImage);
		expect(bg).toContain('gradient');

		// Green accent present
		const html = await page.content();
		expect(html).toContain('#2ea043');
	});

	test('HTTPS geldig TLS-certificaat', async ({ page }) => {
		const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
		expect(resp?.status()).toBe(200);
		expect(page.url()).toMatch(/^https:\/\//);
	});

	test('WCAG: lang attribuut, h1, landmarks, skip link', async ({ page }) => {
		await page.goto(BASE, { waitUntil: 'networkidle' });

		const lang = await page.locator('html').getAttribute('lang');
		expect(lang).toBe('nl');

		expect(await page.locator('h1').count()).toBeGreaterThanOrEqual(1);
		expect(await page.locator('main, [role="main"]').count()).toBeGreaterThanOrEqual(1);
		expect(await page.locator('nav, [role="navigation"]').count()).toBeGreaterThanOrEqual(1);
		expect(await page.locator('.skip-link').count()).toBeGreaterThanOrEqual(1);
	});

	test('scanformulier aanwezig met email en URL velden', async ({ page }) => {
		await page.goto(BASE, { waitUntil: 'networkidle' });

		const emailInput = page.locator('input[type="email"]');
		await expect(emailInput).toBeVisible();

		const urlInput = page.locator('input[type="url"]');
		await expect(urlInput).toBeVisible();

		const submitBtn = page.locator('button[type="submit"]');
		await expect(submitBtn).toBeVisible();
		await expect(submitBtn).toHaveText(/scan aanvragen/i);

		// Checkbox for summary
		const checkbox = page.locator('input[name="includeSummary"]');
		await expect(checkbox).toBeVisible();
	});

	test('uitleg pagina laadt met alle 5 categorieën', async ({ page }) => {
		await page.goto(`${BASE}/uitleg`, { waitUntil: 'networkidle' });

		await expect(page).toHaveTitle(/Wat scannen wij/);

		const headings = await page.locator('h2').allTextContents();
		expect(headings).toEqual(expect.arrayContaining([
			expect.stringContaining('Beveiliging'),
			expect.stringContaining('Toegankelijkheid'),
			expect.stringContaining('Privacy'),
			expect.stringContaining('Snelheid'),
			expect.stringContaining('Overheidsstandaarden'),
		]));
	});

	test('uitleg pagina bevat waarom-sectie', async ({ page }) => {
		await page.goto(`${BASE}/uitleg`, { waitUntil: 'networkidle' });
		const content = await page.textContent('body');
		expect(content).toContain('gratis');
		expect(content).toContain('Waarom');
	});

	test('health endpoint JSON response', async ({ page }) => {
		const resp = await page.goto(`${BASE}/api/health`);
		expect(resp?.status()).toBe(200);
		const body = await resp?.json();
		expect(body.status).toBe('ok');
		expect(body.timestamp).toBeTruthy();
	});

	test('security headers op response', async ({ page }) => {
		const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
		const headers = resp?.headers() ?? {};

		expect(headers['x-content-type-options']).toContain('nosniff');
		expect(headers['strict-transport-security']).toBeTruthy();
		expect(headers['content-security-policy']).toBeTruthy();
		expect(headers['x-frame-options']).toBeTruthy();
		expect(headers['referrer-policy']).toBeTruthy();
	});

	test('gratis scan boodschap zichtbaar', async ({ page }) => {
		await page.goto(BASE, { waitUntil: 'networkidle' });
		const content = await page.textContent('body');
		expect(content).toContain('gratis');
		expect(content).toContain('onethisch');
	});

	test('geen externe trackers geladen', async ({ page }) => {
		const trackerDomains = ['google-analytics.com', 'googletagmanager.com', 'facebook.net', 'hotjar.com'];
		const loadedDomains: string[] = [];

		page.on('response', (resp) => {
			try {
				const host = new URL(resp.url()).hostname;
				if (!host.includes('publicvibes.nl')) loadedDomains.push(host);
			} catch { /* ignore */ }
		});

		await page.goto(BASE, { waitUntil: 'networkidle' });

		for (const tracker of trackerDomains) {
			expect(loadedDomains.some((d) => d.includes(tracker))).toBe(false);
		}
	});
});
