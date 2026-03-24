// Web scanner service: Playwright-based site scanner that collects browser data
// and runs all rule-based analyzers. This is the single source of truth for scanning
// logic, used by both the API route and the standalone CLI script.

import { chromium } from 'playwright';

import type { BrowserData, ScanResult } from './_analyzers';
import {
	analyzePerformance,
	analyzePrivacy,
	analyzeSecurityHeaders,
	analyzeStandards,
	analyzeWcag,
	scoreToRating,
} from './_analyzers';

// Re-export types and functions that consumers need
export type { BrowserData, CategoryResult, Finding, ScanResult, Severity } from './_analyzers';
export { scoreToRating } from './_analyzers';
export { parseHar, harToBrowserData } from './har-parser';
export {
	countSeverities,
	explainTrackers,
	explainTrackersPlaintext,
	generateExecutiveSummary,
	generateHtmlReport,
} from './_report';

/**
 * Collects comprehensive browser data from a URL using Playwright.
 * Launches a headless Chromium instance, navigates to the page, and extracts
 * all relevant data for analysis (headers, DOM structure, cookies, resources, etc.).
 * @param url - The target URL to scan
 * @returns Full browser data for analysis
 */
async function collectBrowserData(url: string): Promise<BrowserData> {
	console.log(`\nBrowser openen voor ${url}...`);
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext();
	const page = await context.newPage();

	const resources: BrowserData['resources'] = [];
	page.on('response', (resp) => {
		resources.push({
			url: resp.url(),
			type: resp.request().resourceType(),
			status: resp.status(),
			size: Number(resp.headers()['content-length'] ?? 0),
		});
	});

	const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
	const headers = response?.headers() ?? {};
	const title = await page.title();
	const lang = (await page.locator('html').getAttribute('lang')) ?? '';
	const html = await page.content();
	const targetDomain = new URL(url).hostname.replace(/^www\./, '');

	const images = await page.locator('img').evaluateAll((els) =>
		els.map((el) => ({
			src: (el as HTMLImageElement).src,
			alt: el.getAttribute('alt'),
			role: el.getAttribute('role'),
		})),
	);

	const headings = await page.locator('h1,h2,h3,h4,h5,h6').evaluateAll((els) =>
		els.map((el) => ({
			level: Number.parseInt(el.tagName.replace('H', ''), 10),
			text: el.textContent?.trim().slice(0, 120) ?? '',
		})),
	);

	const links = await page.locator('a[href]').evaluateAll((els) =>
		els.slice(0, 200).map((el) => ({
			href: (el as HTMLAnchorElement).href,
			text: el.textContent?.trim().slice(0, 80) ?? '',
		})),
	);

	const forms = await page.locator('form').evaluateAll((els) =>
		els.map((form) => ({
			action: (form as HTMLFormElement).action,
			method: (form as HTMLFormElement).method || 'get',
			inputs: Array.from(form.querySelectorAll('input:not([type="hidden"]),select,textarea')).map(
				(inp) => {
					const id = inp.getAttribute('id');
					const hasLabel = id
						? form.ownerDocument.querySelector(`label[for="${id}"]`) !== null
						: false;
					return {
						name: inp.getAttribute('name') ?? '',
						type: inp.getAttribute('type') ?? 'text',
						hasLabel:
							hasLabel || !!inp.getAttribute('aria-label') || !!inp.getAttribute('aria-labelledby'),
						ariaLabel: inp.getAttribute('aria-label'),
					};
				},
			),
		})),
	);

	const meta: Record<string, string> = {};
	const metaEls = await page
		.locator('meta[name],meta[property],meta[http-equiv]')
		.evaluateAll((els) =>
			els.map((el) => ({
				key:
					el.getAttribute('name') ??
					el.getAttribute('property') ??
					el.getAttribute('http-equiv') ??
					'',
				value: el.getAttribute('content') ?? '',
			})),
		);
	for (const m of metaEls) {
		if (m.key) meta[m.key] = m.value;
	}

	const cookies = (await context.cookies()).map((c) => ({
		name: c.name,
		domain: c.domain,
		secure: c.secure,
		httpOnly: c.httpOnly,
		sameSite: c.sameSite,
	}));

	const scripts = await page.locator('script[src]').evaluateAll((els) =>
		els.map((el) => ({
			src: (el as HTMLScriptElement).src,
			async: (el as HTMLScriptElement).async,
			defer: (el as HTMLScriptElement).defer,
			integrity: el.getAttribute('integrity'),
			crossorigin: el.getAttribute('crossorigin'),
		})),
	);

	const landmarks = await page
		.locator(
			'main,nav,header,footer,aside,section[aria-label],section[aria-labelledby],[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"]',
		)
		.evaluateAll((els) =>
			els.map((el) => ({
				tag: el.tagName.toLowerCase(),
				role: el.getAttribute('role'),
				ariaLabel: el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby'),
			})),
		);

	const skipLinks = await page.locator('a[href^="#"]').evaluateAll((els) =>
		els
			.filter((el) => {
				const text = el.textContent?.toLowerCase() ?? '';
				return (
					text.includes('skip') ||
					text.includes('hoofdinhoud') ||
					text.includes('content') ||
					text.includes('navigatie')
				);
			})
			.map((el) => (el as HTMLAnchorElement).href),
	);

	const focusableWithoutOutline = await page.evaluate(() => {
		const focusable = document.querySelectorAll('a,button,input,select,textarea,[tabindex]');
		let count = 0;
		for (const el of focusable) {
			const style = window.getComputedStyle(el);
			if (style.outlineStyle === 'none' && style.boxShadow === 'none') count++;
		}
		return count;
	});

	const externalDomains = [
		...new Set(
			resources
				.map((r) => {
					try {
						return new URL(r.url).hostname;
					} catch {
						return '';
					}
				})
				.filter((d) => d && !d.includes(targetDomain)),
		),
	];

	await browser.close();
	console.log(
		`  ${images.length} afbeeldingen, ${links.length} links, ${headings.length} headings, ${cookies.length} cookies, ${scripts.length} scripts, ${landmarks.length} landmarks`,
	);

	return {
		title,
		lang,
		headers,
		html,
		links,
		images,
		headings,
		forms,
		meta,
		cookies,
		scripts,
		resources,
		landmarks,
		skipLinks,
		focusableWithoutOutline,
		externalDomains,
		targetDomain,
	};
}

/**
 * Runs the 5 analyzers on pre-collected BrowserData.
 * Shared between live Playwright scans and HAR-based scans.
 */
export function analyzeFromBrowserData(targetUrl: string, browserData: BrowserData): ScanResult {
	console.log('\nAnalyse uitvoeren (regel-gebaseerd)...');
	const security = analyzeSecurityHeaders(browserData);
	const wcag = analyzeWcag(browserData);
	const privacy = analyzePrivacy(browserData);
	const performance = analyzePerformance(browserData);
	const standards = analyzeStandards(browserData);

	const weights = { security: 0.25, wcag: 0.25, privacy: 0.2, performance: 0.15, standards: 0.15 };
	const overallScore = Math.round(
		security.score * weights.security +
			wcag.score * weights.wcag +
			privacy.score * weights.privacy +
			performance.score * weights.performance +
			standards.score * weights.standards,
	);

	return {
		targetUrl,
		scannedAt: new Date().toISOString(),
		categories: { security, wcag, privacy, performance, standards },
		overallScore,
		overallRating: scoreToRating(overallScore),
	};
}

/**
 * Runs a full Playwright-based scan of the target URL.
 * Launches a browser, collects all page data, and runs the 5 analyzers
 * (security, wcag, privacy, performance, standards).
 * @param targetUrl - The HTTPS URL to scan
 * @returns Object containing the full ScanResult and raw BrowserData
 */
export async function scanWebsite(
	targetUrl: string,
): Promise<{ result: ScanResult; browserData: BrowserData }> {
	const browserData = await collectBrowserData(targetUrl);
	const result = analyzeFromBrowserData(targetUrl, browserData);
	return { result, browserData };
}

/**
 * Renders an HTML string to a PDF buffer using Playwright.
 * @param html - Full HTML document string
 * @returns PDF as Buffer
 */
/**
 * Renders an HTML string to a PDF buffer using Playwright.
 * Injects print-optimized CSS for clean A4 pagination.
 * @param html - Full HTML document string
 * @returns PDF as Buffer
 */
export async function renderPdf(html: string): Promise<Buffer> {
	// Inject PDF pagination CSS before </head>
	const pdfCss = `<style>
		@page { size: A4; margin: 20mm 15mm; }
		body { font-size: 11pt; }
		section, details, .finding-card { page-break-inside: avoid; }
		details[open] { page-break-inside: auto; }
		details[open] > div > div { page-break-inside: avoid; }
		h1, h2, h3 { page-break-after: avoid; }
		table { page-break-inside: avoid; }
		tr { page-break-inside: avoid; }
		.page-break { page-break-before: always; }
	</style>`;
	const pdfHtml = html.replace('</head>', `${pdfCss}</head>`);

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	await page.setContent(pdfHtml, { waitUntil: 'networkidle' });
	const pdf = await page.pdf({
		format: 'A4',
		margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
		printBackground: true,
		displayHeaderFooter: true,
		headerTemplate: '<span></span>',
		footerTemplate:
			'<div style="font-size:8pt;color:#888;width:100%;text-align:center;padding:0 15mm">Site Guardian — publicvibes.nl &nbsp;|&nbsp; Pagina <span class="pageNumber"></span> van <span class="totalPages"></span></div>',
	});
	await browser.close();
	return Buffer.from(pdf);
}
