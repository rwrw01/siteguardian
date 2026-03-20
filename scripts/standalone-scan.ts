import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const INCLUDE_SUMMARY = !args.includes('--no-summary');
const TARGET_URL = args.find((a) => !a.startsWith('--')) ?? 'https://www.rijssen-holten.nl';
const OUTPUT_DIR = resolve(import.meta.dirname ?? '.', '..', 'scan-results');
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// ── Types ──

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface Finding {
	title: string;
	description: string;
	severity: Severity;
	location?: string;
	recommendation: string;
	reference?: string;
}

interface CategoryResult {
	score: number;
	rating: string;
	findings: Finding[];
	recommendations: string[];
}

interface BrowserData {
	title: string;
	lang: string;
	headers: Record<string, string>;
	html: string;
	links: { href: string; text: string }[];
	images: { src: string; alt: string | null; role: string | null }[];
	headings: { level: number; text: string }[];
	forms: { action: string; method: string; inputs: { name: string; type: string; hasLabel: boolean; ariaLabel: string | null }[] }[];
	meta: Record<string, string>;
	cookies: { name: string; domain: string; secure: boolean; httpOnly: boolean; sameSite: string }[];
	scripts: { src: string; async: boolean; defer: boolean; integrity: string | null; crossorigin: string | null }[];
	resources: { url: string; type: string; status: number; size: number }[];
	landmarks: { tag: string; role: string | null; ariaLabel: string | null }[];
	skipLinks: string[];
	focusableWithoutOutline: number;
	externalDomains: string[];
	targetDomain: string;
}

interface ScanResult {
	targetUrl: string;
	scannedAt: string;
	categories: {
		security: CategoryResult;
		wcag: CategoryResult;
		privacy: CategoryResult;
		performance: CategoryResult;
		standards: CategoryResult;
	};
	overallScore: number;
	overallRating: string;
}

// ── Browser data collection ──

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
	const lang = await page.locator('html').getAttribute('lang') ?? '';
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
			inputs: Array.from(form.querySelectorAll('input:not([type="hidden"]),select,textarea')).map((inp) => {
				const id = inp.getAttribute('id');
				const hasLabel = id ? form.ownerDocument.querySelector(`label[for="${id}"]`) !== null : false;
				return {
					name: inp.getAttribute('name') ?? '',
					type: inp.getAttribute('type') ?? 'text',
					hasLabel: hasLabel || !!inp.getAttribute('aria-label') || !!inp.getAttribute('aria-labelledby'),
					ariaLabel: inp.getAttribute('aria-label'),
				};
			}),
		})),
	);

	const meta: Record<string, string> = {};
	const metaEls = await page.locator('meta[name],meta[property],meta[http-equiv]').evaluateAll((els) =>
		els.map((el) => ({
			key: el.getAttribute('name') ?? el.getAttribute('property') ?? el.getAttribute('http-equiv') ?? '',
			value: el.getAttribute('content') ?? '',
		})),
	);
	for (const m of metaEls) { if (m.key) meta[m.key] = m.value; }

	const cookies = (await context.cookies()).map((c) => ({
		name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
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

	const landmarks = await page.locator('main,nav,header,footer,aside,section[aria-label],section[aria-labelledby],[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"]').evaluateAll((els) =>
		els.map((el) => ({
			tag: el.tagName.toLowerCase(),
			role: el.getAttribute('role'),
			ariaLabel: el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby'),
		})),
	);

	const skipLinks = await page.locator('a[href^="#"]').evaluateAll((els) =>
		els.filter((el) => {
			const text = el.textContent?.toLowerCase() ?? '';
			return text.includes('skip') || text.includes('hoofdinhoud') || text.includes('content') || text.includes('navigatie');
		}).map((el) => (el as HTMLAnchorElement).href),
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

	const externalDomains = [...new Set(
		resources.map((r) => { try { return new URL(r.url).hostname; } catch { return ''; } })
			.filter((d) => d && !d.includes(targetDomain)),
	)];

	await browser.close();
	console.log(`  ${images.length} afbeeldingen, ${links.length} links, ${headings.length} headings, ${cookies.length} cookies, ${scripts.length} scripts, ${landmarks.length} landmarks`);

	return { title, lang, headers, html, links, images, headings, forms, meta, cookies, scripts, resources, landmarks, skipLinks, focusableWithoutOutline, externalDomains, targetDomain };
}

// ── Rule-based analyzers ──

function analyzeSecurityHeaders(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];
	const h = data.headers;

	// HSTS
	if (!h['strict-transport-security']) {
		findings.push({ title: 'HSTS header ontbreekt', description: 'Strict-Transport-Security header is niet ingesteld. Zonder HSTS kan een aanvaller via een downgrade-aanval HTTPS omzeilen.', severity: 'high', location: 'HTTP Response Headers', recommendation: 'Voeg toe: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload', reference: 'OWASP A05:2021 — Security Misconfiguration' });
	} else if (!h['strict-transport-security'].includes('includeSubDomains')) {
		findings.push({ title: 'HSTS zonder includeSubDomains', description: 'HSTS is ingesteld maar zonder includeSubDomains, waardoor subdomeinen kwetsbaar blijven.', severity: 'medium', location: `HSTS: ${h['strict-transport-security']}`, recommendation: 'Voeg includeSubDomains toe aan de HSTS header.', reference: 'RFC 6797' });
	}

	// CSP
	if (!h['content-security-policy']) {
		findings.push({ title: 'Content-Security-Policy ontbreekt', description: 'Geen CSP header gevonden. CSP voorkomt XSS-aanvallen door te beperken welke bronnen geladen mogen worden.', severity: 'high', location: 'HTTP Response Headers', recommendation: 'Stel een Content-Security-Policy in die minimaal default-src, script-src en style-src definieert.', reference: 'OWASP A03:2021 — Injection / CWE-79' });
	}

	// X-Content-Type-Options
	if (!h['x-content-type-options']?.includes('nosniff')) {
		findings.push({ title: 'X-Content-Type-Options ontbreekt', description: 'Browser kan MIME-types raden (MIME-sniffing), wat tot XSS kan leiden.', severity: 'medium', location: 'HTTP Response Headers', recommendation: 'Voeg toe: X-Content-Type-Options: nosniff', reference: 'CWE-16' });
	}

	// X-Frame-Options
	const xfo = h['x-frame-options']?.toLowerCase();
	if (!xfo || (xfo !== 'deny' && xfo !== 'sameorigin')) {
		findings.push({ title: 'X-Frame-Options ontbreekt of ongeldig', description: 'Zonder X-Frame-Options kan de website in een iframe geladen worden (clickjacking).', severity: 'medium', location: `X-Frame-Options: ${xfo ?? 'niet aanwezig'}`, recommendation: 'Voeg toe: X-Frame-Options: DENY of SAMEORIGIN', reference: 'CWE-1021 / OWASP Clickjacking' });
	}

	// Referrer-Policy
	if (!h['referrer-policy']) {
		findings.push({ title: 'Referrer-Policy ontbreekt', description: 'Zonder Referrer-Policy kan gevoelige URL-informatie via de Referer header lekken.', severity: 'low', location: 'HTTP Response Headers', recommendation: 'Voeg toe: Referrer-Policy: strict-origin-when-cross-origin', reference: 'OWASP Security Headers' });
	}

	// Permissions-Policy
	if (!h['permissions-policy'] && !h['feature-policy']) {
		findings.push({ title: 'Permissions-Policy ontbreekt', description: 'Zonder Permissions-Policy kunnen third-party scripts toegang krijgen tot camera, microfoon en locatie.', severity: 'low', location: 'HTTP Response Headers', recommendation: 'Voeg toe: Permissions-Policy: camera=(), microphone=(), geolocation=()', reference: 'W3C Permissions Policy' });
	}

	// Server header
	if (h['server'] && h['server'] !== 'nginx' && h['server'] !== 'Apache') {
		if (/\d/.test(h['server'])) {
			findings.push({ title: 'Server versie zichtbaar', description: `De Server header toont versie-informatie: "${h['server']}". Dit helpt aanvallers bij het vinden van bekende kwetsbaarheden.`, severity: 'low', location: `Server: ${h['server']}`, recommendation: 'Verberg de versie in de Server header.', reference: 'CWE-200' });
		}
	}

	// X-Powered-By
	if (h['x-powered-by']) {
		findings.push({ title: 'X-Powered-By header zichtbaar', description: `De X-Powered-By header toont: "${h['x-powered-by']}". Dit onthult technologie-informatie.`, severity: 'low', location: `X-Powered-By: ${h['x-powered-by']}`, recommendation: 'Verwijder de X-Powered-By header.', reference: 'CWE-200' });
	}

	// Cookies without Secure/HttpOnly
	for (const cookie of data.cookies) {
		if (!cookie.secure) {
			findings.push({ title: `Cookie "${cookie.name}" zonder Secure flag`, description: 'Cookie wordt ook over onversleutelde HTTP verbindingen verstuurd.', severity: 'medium', location: `Cookie: ${cookie.name}`, recommendation: 'Zet de Secure flag op alle cookies.', reference: 'CWE-614' });
		}
		if (!cookie.httpOnly && !cookie.name.startsWith('_ga') && !cookie.name.startsWith('_gid')) {
			findings.push({ title: `Cookie "${cookie.name}" zonder HttpOnly flag`, description: 'Cookie is toegankelijk via JavaScript, wat het risico op XSS-diefstal vergroot.', severity: 'low', location: `Cookie: ${cookie.name}`, recommendation: 'Zet de HttpOnly flag tenzij JavaScript-toegang noodzakelijk is.', reference: 'CWE-1004' });
		}
		if (cookie.sameSite === 'None' || cookie.sameSite === '') {
			findings.push({ title: `Cookie "${cookie.name}" zonder SameSite`, description: 'Cookie wordt meegestuurd bij cross-site requests (CSRF-risico).', severity: 'medium', location: `Cookie: ${cookie.name}`, recommendation: 'Zet SameSite=Strict of SameSite=Lax.', reference: 'CWE-352' });
		}
	}

	// External scripts without SRI
	const extScriptsNoSri = data.scripts.filter((s) => {
		try { return new URL(s.src).hostname !== data.targetDomain && !s.integrity; } catch { return false; }
	});
	if (extScriptsNoSri.length > 0) {
		findings.push({ title: `${extScriptsNoSri.length} externe scripts zonder Subresource Integrity`, description: 'Externe scripts worden geladen zonder SRI hash. Als de externe bron gehackt wordt, kan kwaadaardige code worden geïnjecteerd.', severity: 'medium', location: extScriptsNoSri.map((s) => s.src).slice(0, 3).join(', '), recommendation: 'Voeg integrity en crossorigin attributen toe aan externe script tags.', reference: 'SRI / OWASP A08:2021' });
	}

	const score = Math.max(0, 100 - findings.reduce((s, f) => s + ({ critical: 25, high: 15, medium: 8, low: 3, info: 0 }[f.severity]), 0));
	return { score, rating: scoreToRating(score), findings, recommendations: findings.length > 0 ? ['Implementeer alle ontbrekende security headers via de webserver of reverse proxy (bijv. Traefik/nginx).', 'Gebruik securityheaders.com om de huidige configuratie te testen.'] : [] };
}

function analyzeWcag(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	// Lang attribute
	if (!data.lang) {
		findings.push({ title: 'HTML lang attribuut ontbreekt', description: 'Het lang attribuut op het html-element ontbreekt. Schermlezers weten hierdoor niet in welke taal de pagina is.', severity: 'high', location: '<html>', recommendation: 'Voeg lang="nl" toe aan het <html> element.', reference: 'WCAG 3.1.1 (Niveau A)' });
	} else if (!data.lang.startsWith('nl')) {
		findings.push({ title: 'HTML lang attribuut niet Nederlands', description: `Het lang attribuut is "${data.lang}" maar de website is Nederlandstalig.`, severity: 'medium', location: `<html lang="${data.lang}">`, recommendation: 'Zet lang="nl" op het <html> element.', reference: 'WCAG 3.1.1 (Niveau A)' });
	}

	// H1
	const h1s = data.headings.filter((h) => h.level === 1);
	if (h1s.length === 0) {
		findings.push({ title: 'Geen h1 heading gevonden', description: 'Elke pagina moet minimaal één h1 heading hebben voor schermlezers en SEO.', severity: 'high', location: 'Document', recommendation: 'Voeg een <h1> toe met de paginatitel.', reference: 'WCAG 1.3.1 (Niveau A)' });
	} else if (h1s.length > 1) {
		findings.push({ title: `Meerdere h1 headings (${h1s.length})`, description: 'Er zijn meerdere h1 elements gevonden. Eén h1 per pagina is best practice.', severity: 'low', location: h1s.map((h) => h.text).join(', '), recommendation: 'Gebruik slechts één <h1> per pagina.', reference: 'WCAG 1.3.1 (Niveau A) — best practice' });
	}

	// Heading hierarchy (skipped levels)
	for (let i = 1; i < data.headings.length; i++) {
		const prev = data.headings[i - 1].level;
		const curr = data.headings[i].level;
		if (curr > prev + 1) {
			findings.push({ title: `Heading niveau overgeslagen: h${prev} → h${curr}`, description: `Na een h${prev} ("${data.headings[i - 1].text}") volgt een h${curr} ("${data.headings[i].text}"). Heading-niveaus mogen niet worden overgeslagen.`, severity: 'medium', location: `h${curr}: ${data.headings[i].text}`, recommendation: `Gebruik h${prev + 1} in plaats van h${curr}, of herstructureer de heading-hiërarchie.`, reference: 'WCAG 1.3.1 (Niveau A)' });
			break; // Report only first skip
		}
	}

	// Images without alt
	const imagesNoAlt = data.images.filter((img) => img.alt === null && img.role !== 'presentation');
	if (imagesNoAlt.length > 0) {
		findings.push({ title: `${imagesNoAlt.length} afbeelding(en) zonder alt tekst`, description: 'Afbeeldingen zonder alt attribuut zijn ontoegankelijk voor schermlezers.', severity: imagesNoAlt.length > 5 ? 'high' : 'medium', location: imagesNoAlt.slice(0, 3).map((i) => i.src.split('/').pop()).join(', '), recommendation: 'Voeg beschrijvende alt tekst toe, of alt="" voor decoratieve afbeeldingen.', reference: 'WCAG 1.1.1 (Niveau A)' });
	}

	// Empty alt check (all empty = suspicious)
	const emptyAlts = data.images.filter((img) => img.alt === '');
	if (emptyAlts.length > data.images.length * 0.7 && data.images.length > 5) {
		findings.push({ title: 'Verdacht veel lege alt attributen', description: `${emptyAlts.length} van ${data.images.length} afbeeldingen hebben alt="". Niet alle afbeeldingen zijn decoratief.`, severity: 'medium', location: 'Afbeeldingen', recommendation: 'Controleer of afbeeldingen met inhoudelijke waarde een beschrijvende alt tekst krijgen.', reference: 'WCAG 1.1.1 (Niveau A)' });
	}

	// Landmarks
	const hasMain = data.landmarks.some((l) => l.tag === 'main' || l.role === 'main');
	const hasNav = data.landmarks.some((l) => l.tag === 'nav' || l.role === 'navigation');
	if (!hasMain) {
		findings.push({ title: 'Geen <main> landmark', description: 'Er is geen <main> element of role="main" gevonden. Schermlezers gebruiken landmarks om te navigeren.', severity: 'high', location: 'Document structuur', recommendation: 'Omsluit de hoofdinhoud met een <main> element.', reference: 'WCAG 1.3.1 (Niveau A)' });
	}
	if (!hasNav) {
		findings.push({ title: 'Geen <nav> landmark', description: 'Er is geen <nav> element of role="navigation" gevonden.', severity: 'medium', location: 'Document structuur', recommendation: 'Omsluit de hoofdnavigatie met een <nav> element.', reference: 'WCAG 1.3.1 (Niveau A)' });
	}

	// Skip links
	if (data.skipLinks.length === 0) {
		findings.push({ title: 'Geen skip link gevonden', description: 'Er is geen "Ga naar hoofdinhoud" link gevonden. Toetsenbordgebruikers moeten door alle navigatie-items tabben.', severity: 'medium', location: 'Document begin', recommendation: 'Voeg een skip link toe: <a href="#main-content" class="skip-link">Ga naar hoofdinhoud</a>', reference: 'WCAG 2.4.1 (Niveau A)' });
	}

	// Form labels
	for (const form of data.forms) {
		const unlabeled = form.inputs.filter((i) => !i.hasLabel && i.type !== 'submit' && i.type !== 'button');
		if (unlabeled.length > 0) {
			findings.push({ title: `${unlabeled.length} formulierveld(en) zonder label`, description: `In het formulier (${form.action}) missen labels op: ${unlabeled.map((i) => i.name || i.type).join(', ')}`, severity: 'high', location: `Formulier: ${form.action}`, recommendation: 'Koppel een <label for="id"> aan elk invoerveld, of gebruik aria-label.', reference: 'WCAG 1.3.1 / 4.1.2 (Niveau A)' });
		}
	}

	// Viewport meta
	if (!data.meta['viewport']) {
		findings.push({ title: 'Viewport meta tag ontbreekt', description: 'Zonder viewport meta tag wordt de pagina niet correct weergegeven op mobiele apparaten.', severity: 'medium', location: '<head>', recommendation: 'Voeg toe: <meta name="viewport" content="width=device-width, initial-scale=1">', reference: 'WCAG 1.4.10 (Niveau AA)' });
	} else if (data.meta['viewport'].includes('maximum-scale=1') || data.meta['viewport'].includes('user-scalable=no')) {
		findings.push({ title: 'Viewport voorkomt inzoomen', description: 'De viewport meta tag beperkt het zoomen, wat gebruikers met visuele beperkingen belemmert.', severity: 'high', location: `viewport: ${data.meta['viewport']}`, recommendation: 'Verwijder maximum-scale=1 en user-scalable=no uit de viewport meta tag.', reference: 'WCAG 1.4.4 (Niveau AA)' });
	}

	const score = Math.max(0, 100 - findings.reduce((s, f) => s + ({ critical: 25, high: 15, medium: 8, low: 3, info: 0 }[f.severity]), 0));
	return { score, rating: scoreToRating(score), findings, recommendations: findings.length > 0 ? ['Voer een volledige WCAG 2.2 AA audit uit met axe-core of Lighthouse.', 'Test met een schermlezer (NVDA of VoiceOver) en alleen-toetsenbord navigatie.'] : [] };
}

function analyzePrivacy(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	// Known trackers
	const trackerDomains: Record<string, string> = {
		'google-analytics.com': 'Google Analytics', 'www.google-analytics.com': 'Google Analytics',
		'googletagmanager.com': 'Google Tag Manager', 'www.googletagmanager.com': 'Google Tag Manager',
		'facebook.net': 'Facebook Pixel', 'connect.facebook.net': 'Facebook Pixel',
		'facebook.com': 'Facebook', 'www.facebook.com': 'Facebook',
		'doubleclick.net': 'Google DoubleClick', 'ad.doubleclick.net': 'Google DoubleClick',
		'hotjar.com': 'Hotjar', 'static.hotjar.com': 'Hotjar',
		'clarity.ms': 'Microsoft Clarity',
		'linkedin.com': 'LinkedIn Tracking', 'snap.licdn.com': 'LinkedIn Tracking',
		'twitter.com': 'Twitter/X Tracking', 'platform.twitter.com': 'Twitter/X Tracking',
		'tiktok.com': 'TikTok Pixel', 'analytics.tiktok.com': 'TikTok Pixel',
		'siteimproveanalytics.com': 'Siteimprove Analytics',
	};

	const foundTrackers: string[] = [];
	for (const domain of data.externalDomains) {
		for (const [trackerDomain, trackerName] of Object.entries(trackerDomains)) {
			if (domain.includes(trackerDomain) && !foundTrackers.includes(trackerName)) {
				foundTrackers.push(trackerName);
			}
		}
	}

	if (foundTrackers.length > 0) {
		findings.push({ title: `${foundTrackers.length} tracker(s) gedetecteerd`, description: `De volgende tracking-diensten worden geladen: ${foundTrackers.join(', ')}. Dit vereist voorafgaande toestemming onder de AVG.`, severity: 'high', location: foundTrackers.join(', '), recommendation: 'Laad tracking scripts pas NA expliciete toestemming van de bezoeker (opt-in). Gebruik geen cookie wall.', reference: 'AVG Art. 6 / ePrivacy Richtlijn Art. 5(3)' });
	}

	// Cookie consent check
	const consentIndicators = ['cookie', 'consent', 'gdpr', 'avg', 'privacy', 'toestemming'];
	const hasConsentBanner = data.html.toLowerCase().match(new RegExp(consentIndicators.map((i) => `(class|id|aria-label)="[^"]*${i}[^"]*"`).join('|')));
	if (!hasConsentBanner && data.cookies.length > 0) {
		findings.push({ title: 'Geen cookie consent banner gedetecteerd', description: 'Er worden cookies geplaatst maar er is geen zichtbaar toestemmingsmechanisme gevonden.', severity: foundTrackers.length > 0 ? 'high' : 'medium', location: 'Document', recommendation: 'Implementeer een cookie consent banner die toestemming vraagt VOORDAT niet-functionele cookies worden geplaatst.', reference: 'AVG Art. 7 / Telecommunicatiewet Art. 11.7a' });
	}

	// Third-party domains
	if (data.externalDomains.length > 10) {
		findings.push({ title: `${data.externalDomains.length} externe domeinen geladen`, description: `De pagina laadt resources van ${data.externalDomains.length} externe domeinen. Elk domein ontvangt potentieel IP-adres en browsgegevens van bezoekers.`, severity: 'medium', location: data.externalDomains.slice(0, 5).join(', ') + (data.externalDomains.length > 5 ? ` (+${data.externalDomains.length - 5} meer)` : ''), recommendation: 'Minimaliseer externe afhankelijkheden. Host fonts en scripts lokaal waar mogelijk.', reference: 'AVG Art. 5(1)(c) — Dataminimalisatie' });
	}

	// Privacy policy link
	const privacyLinks = data.links.filter((l) =>
		l.text.toLowerCase().match(/privacy|privacybeleid|privacyverklaring|gegevensbescherming/) ||
		l.href.toLowerCase().match(/privacy|privacybeleid/),
	);
	if (privacyLinks.length === 0) {
		findings.push({ title: 'Geen link naar privacyverklaring gevonden', description: 'Er is geen zichtbare link naar een privacybeleid/privacyverklaring op de homepage.', severity: 'high', location: 'Footer/navigatie', recommendation: 'Plaats een link naar de privacyverklaring in de footer van elke pagina.', reference: 'AVG Art. 13/14' });
	}

	// Analytics cookies without consent
	const analyticsCookies = data.cookies.filter((c) =>
		c.name.match(/^(_ga|_gid|_gat|_gcl|_fbp|_fbc|hjSession|_clck|_clsk)/),
	);
	if (analyticsCookies.length > 0) {
		findings.push({ title: `${analyticsCookies.length} analytics cookie(s) zonder aantoonbare toestemming`, description: `Cookies gedetecteerd: ${analyticsCookies.map((c) => c.name).join(', ')}. Deze worden direct bij het laden geplaatst.`, severity: 'high', location: analyticsCookies.map((c) => c.name).join(', '), recommendation: 'Plaats analytics cookies pas na expliciete opt-in. Gebruik cookieless analytics als alternatief.', reference: 'AP Normuitleg cookies / ePrivacy Art. 5(3)' });
	}

	const score = Math.max(0, 100 - findings.reduce((s, f) => s + ({ critical: 25, high: 15, medium: 8, low: 3, info: 0 }[f.severity]), 0));
	return { score, rating: scoreToRating(score), findings, recommendations: findings.length > 0 ? ['Voer een cookie-audit uit met CookieYes of vergelijkbare tool.', 'Controleer of de verwerkingsregister (AVG Art. 30) up-to-date is.', 'Overweeg cookieless analytics (bijv. Plausible, Fathom, of server-side Matomo).'] : [] };
}

function analyzePerformance(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	const totalResources = data.resources.length;
	if (totalResources > 100) {
		findings.push({ title: `Hoog aantal HTTP requests (${totalResources})`, description: `De pagina laadt ${totalResources} resources. Elk request voegt latentie toe.`, severity: totalResources > 200 ? 'high' : 'medium', location: `${totalResources} requests`, recommendation: 'Combineer en minimaliseer CSS/JS bestanden. Gebruik HTTP/2 multiplexing.', reference: 'Web Performance Best Practices' });
	}

	// External domains impact
	if (data.externalDomains.length > 5) {
		findings.push({ title: `${data.externalDomains.length} externe domeinen (DNS lookups)`, description: `Elke extern domein vereist een DNS lookup, TCP verbinding en TLS handshake.`, severity: data.externalDomains.length > 15 ? 'high' : 'medium', location: data.externalDomains.slice(0, 5).join(', '), recommendation: 'Minimaliseer externe domeinen. Host fonts en veelgebruikte scripts lokaal.', reference: 'Reduce DNS lookups' });
	}

	// Render-blocking scripts
	const blockingScripts = data.scripts.filter((s) => !s.async && !s.defer);
	if (blockingScripts.length > 0) {
		findings.push({ title: `${blockingScripts.length} render-blocking script(s)`, description: 'Scripts zonder async of defer blokkeren het renderen van de pagina.', severity: blockingScripts.length > 3 ? 'high' : 'medium', location: blockingScripts.slice(0, 3).map((s) => s.src.split('/').pop()).join(', '), recommendation: 'Voeg defer of async toe aan script tags die niet direct nodig zijn voor de eerste weergave.', reference: 'Eliminate render-blocking resources' });
	}

	// Compression check
	if (!data.headers['content-encoding']?.match(/gzip|br|deflate/)) {
		findings.push({ title: 'HTML niet gecomprimeerd', description: 'De HTML response is niet gecomprimeerd met gzip of brotli. Dit vergroot de laadtijd.', severity: 'medium', location: 'Content-Encoding header', recommendation: 'Activeer gzip of brotli compressie op de webserver.', reference: 'Enable compression' });
	}

	// Cache headers
	if (!data.headers['cache-control'] && !data.headers['etag']) {
		findings.push({ title: 'Geen caching headers', description: 'Zonder Cache-Control of ETag worden resources bij elk bezoek opnieuw geladen.', severity: 'medium', location: 'HTTP Response Headers', recommendation: 'Stel Cache-Control headers in voor statische assets (CSS, JS, afbeeldingen).', reference: 'HTTP caching' });
	}

	// Failed resources
	const failedResources = data.resources.filter((r) => r.status >= 400);
	if (failedResources.length > 0) {
		findings.push({ title: `${failedResources.length} mislukte resource(s)`, description: `Resources met HTTP foutcode: ${failedResources.slice(0, 5).map((r) => `${r.status} ${r.url.split('/').pop()}`).join(', ')}`, severity: failedResources.length > 3 ? 'medium' : 'low', location: `${failedResources.length} failed requests`, recommendation: 'Repareer of verwijder referenties naar niet-bestaande resources.', reference: 'Remove broken links/resources' });
	}

	const score = Math.max(0, 100 - findings.reduce((s, f) => s + ({ critical: 25, high: 15, medium: 8, low: 3, info: 0 }[f.severity]), 0));
	return { score, rating: scoreToRating(score), findings, recommendations: findings.length > 0 ? ['Gebruik Lighthouse (Chrome DevTools) voor een gedetailleerde performance audit.', 'Overweeg een CDN voor statische assets.'] : [] };
}

function analyzeStandards(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	// HTTPS
	if (!data.resources[0]?.url.startsWith('https')) {
		findings.push({ title: 'Website niet op HTTPS', description: 'De website wordt niet via HTTPS geserveerd. Dit is verplicht voor alle overheidswebsites.', severity: 'critical', location: 'Protocol', recommendation: 'Schakel HTTPS in met een geldig TLS certificaat.', reference: 'Forum Standaardisatie — HTTPS verplicht' });
	}

	// Accessibility statement
	const a11yLinks = data.links.filter((l) =>
		l.text.toLowerCase().match(/toegankelijkheid|accessibility|digitoegankelijk/) ||
		l.href.toLowerCase().match(/toegankelijkheid|accessibility/),
	);
	if (a11yLinks.length === 0) {
		findings.push({ title: 'Geen toegankelijkheidsverklaring gevonden', description: 'Nederlandse overheidswebsites zijn verplicht een toegankelijkheidsverklaring te publiceren.', severity: 'high', location: 'Footer/navigatie', recommendation: 'Publiceer een toegankelijkheidsverklaring via het Register van toegankelijkheidsverklaringen (registreren op toegankelijkheidsverklaring.nl).', reference: 'Besluit digitale toegankelijkheid overheid (Wdo)' });
	}

	// Responsief design
	if (!data.meta['viewport']) {
		findings.push({ title: 'Geen responsive viewport', description: 'Zonder viewport meta tag is de website niet mobiel-vriendelijk.', severity: 'medium', location: '<head>', recommendation: 'Voeg een viewport meta tag toe.', reference: 'WCAG 1.4.10' });
	}

	// Open Graph / social meta
	if (!data.meta['og:title'] && !data.meta['og:description']) {
		findings.push({ title: 'Open Graph metadata ontbreekt', description: 'Geen og:title of og:description gevonden. Dit beïnvloedt hoe de website wordt weergegeven bij delen op sociale media.', severity: 'info', location: '<head>', recommendation: 'Voeg Open Graph meta tags toe (og:title, og:description, og:image).', reference: 'Open Graph Protocol' });
	}

	// Check for NL Design System indicators
	const nldsIndicators = data.html.match(/nl-design-system|rijksoverheid|gemeentelijk|denhaag|utrecht|amsterdam/i);
	if (!nldsIndicators) {
		findings.push({ title: 'Geen NL Design System gebruik gedetecteerd', description: 'Er zijn geen indicatoren gevonden van NL Design System componenten. Voor overheidswebsites wordt dit sterk aanbevolen.', severity: 'info', location: 'HTML/CSS', recommendation: 'Overweeg NL Design System componenten voor een consistente overheidsuitstraling. Zie nldesignsystem.nl.', reference: 'NL Design System / Gebruiker Centraal' });
	}

	// Description meta
	if (!data.meta['description']) {
		findings.push({ title: 'Meta description ontbreekt', description: 'Geen meta description gevonden. Dit beïnvloedt zoekresultaten en vindbaarheid.', severity: 'low', location: '<head>', recommendation: 'Voeg een meta description toe die de pagina-inhoud samenvat.', reference: 'SEO best practice' });
	}

	// Charset
	if (!data.meta['charset'] && !data.html.match(/<meta charset/i)) {
		// Check via http-equiv
		if (!data.headers['content-type']?.includes('charset=utf-8') && !data.headers['content-type']?.includes('charset=UTF-8')) {
			findings.push({ title: 'Charset niet expliciet gedefinieerd', description: 'Geen <meta charset="utf-8"> of Content-Type charset gevonden.', severity: 'low', location: '<head>', recommendation: 'Voeg <meta charset="utf-8"> toe aan de <head>.', reference: 'HTML5 standaard' });
		}
	}

	const score = Math.max(0, 100 - findings.reduce((s, f) => s + ({ critical: 25, high: 15, medium: 8, low: 3, info: 0 }[f.severity]), 0));
	return { score, rating: scoreToRating(score), findings, recommendations: findings.length > 0 ? ['Controleer de verplichte standaardenlijst op forumstandaardisatie.nl.', 'Test DNS-instellingen (DNSSEC, DMARC, SPF, DKIM) via internet.nl.'] : [] };
}

// ── Helpers ──

function scoreToRating(score: number): string {
	if (score >= 90) return 'A';
	if (score >= 80) return 'B';
	if (score >= 70) return 'C';
	if (score >= 60) return 'D';
	if (score >= 50) return 'E';
	return 'F';
}

// ── DeepSeek bestuurders-samenvatting ──

async function generateExecutiveSummary(result: ScanResult): Promise<string | null> {
	if (!process.env.DEEPSEEK_API_KEY) {
		console.log('  DeepSeek API key niet gevonden — bestuurders-samenvatting overgeslagen');
		return null;
	}

	const allFindings = Object.entries(result.categories).flatMap(([cat, r]) =>
		r.findings.map((f) => `[${cat.toUpperCase()}] ${f.severity.toUpperCase()}: ${f.title} — ${f.description}`),
	);

	const prompt = `Je schrijft een kort, compact rapport voor een bestuurder in de Nederlandse publieke sector (wethouder, gemeentesecretaris, directeur).
Deze persoon is GEEN technicus. Gebruik geen jargon, geen afkortingen, geen Engelse termen.
Schrijf in platte tekst, GEEN markdown, GEEN sterretjes, GEEN opsommingstekens. Gewone lopende zinnen en alinea's.

Schrijf maximaal 200 woorden. Structuur:
1. Eén zin: wat is gescand en wat is het totaaloordeel
2. Wat gaat goed (max 2 zinnen)
3. Wat zijn de risico's voor de gemeente en haar inwoners (max 3 zinnen, concreet en begrijpelijk)
4. Wat moet er als eerste gebeuren (max 2 concrete acties)

Context: Uit recent onderzoek blijkt dat veel gemeentewebsites onbewust gegevens van inwoners delen met grote techbedrijven, zonder dat inwoners hiervoor toestemming hebben gegeven. Dit rapport helpt gemeenten dit zelf te controleren.

Website: ${result.targetUrl}
Totaalscore: ${result.overallScore}/100 (${result.overallRating})
Security: ${result.categories.security.score}/100
Toegankelijkheid: ${result.categories.wcag.score}/100
Privacy: ${result.categories.privacy.score}/100
Performance: ${result.categories.performance.score}/100
Overheidsstandaarden: ${result.categories.standards.score}/100

Bevindingen:
${allFindings.join('\n')}`;

	try {
		const resp = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
			},
			body: JSON.stringify({
				model: 'deepseek-reasoner',
				messages: [{ role: 'user', content: prompt }],
				max_tokens: 1024,
			}),
		});

		if (!resp.ok) {
			console.log(`  DeepSeek API fout: ${resp.status} ${resp.statusText}`);
			return null;
		}

		const data = await resp.json() as { choices: { message: { content: string } }[] };
		return data.choices?.[0]?.message?.content?.trim() ?? null;
	} catch (err) {
		console.log(`  DeepSeek niet bereikbaar: ${err}`);
		return null;
	}
}

// ── Tracking uitleg voor bestuurders ──

function explainTrackers(data: BrowserData): string {
	const trackerInfo: Record<string, string> = {
		'google-analytics.com': 'Google Analytics volgt het surfgedrag van elke bezoeker: welke pagina\'s ze bekijken, hoe lang, waar ze vandaan komen. Deze gegevens worden opgeslagen op servers van Google (VS) en kunnen worden gekoppeld aan Google-profielen van inwoners.',
		'googletagmanager.com': 'Google Tag Manager is een hulpmiddel waarmee andere tracking-scripts worden geladen. Het opent de deur voor het plaatsen van cookies en trackers zonder dat dit altijd zichtbaar is.',
		'doubleclick.net': 'DoubleClick is het advertentienetwerk van Google. Als dit op een gemeentewebsite draait, worden inwoners gevolgd voor gerichte advertenties — ook op andere websites.',
		'facebook.net': 'De Facebook Pixel volgt bezoekers en koppelt hun bezoek aan hun Facebook/Instagram profiel. Facebook kan hiermee gerichte advertenties tonen op basis van gemeentelijke diensten die een inwoner heeft bekeken.',
		'hotjar.com': 'Hotjar neemt muisbewegingen, klikken en scrollgedrag op. In feite wordt het scherm van de bezoeker "opgenomen" — inclusief ingevulde formulieren.',
		'clarity.ms': 'Microsoft Clarity neemt sessies op: elke klik, scroll en muisbeweging van bezoekers wordt vastgelegd en naar Microsoft gestuurd.',
		'linkedin.com': 'LinkedIn tracking koppelt websitebezoeken aan LinkedIn-profielen van inwoners.',
		'siteimproveanalytics.com': 'Siteimprove Analytics meet websitegebruik. Hoewel Europees, vereist het nog steeds toestemming als het niet strikt noodzakelijk is.',
	};

	const found: string[] = [];
	for (const domain of data.externalDomains) {
		for (const [trackerDomain, explanation] of Object.entries(trackerInfo)) {
			if (domain.includes(trackerDomain) && !found.includes(explanation)) {
				found.push(explanation);
			}
		}
	}

	if (found.length === 0) return '';
	return found.map((e) => `<li style="margin-bottom:0.5rem">${e}</li>`).join('');
}

// ── HTML report ──

function countSeverities(findings: Finding[]): { hoog: number; midden: number; laag: number } {
	let hoog = 0, midden = 0, laag = 0;
	for (const f of findings) {
		if (f.severity === 'critical' || f.severity === 'high') hoog++;
		else if (f.severity === 'medium') midden++;
		else laag++;
	}
	return { hoog, midden, laag };
}

function generateHtmlReport(result: ScanResult, executiveSummary: string | null, trackerExplanation: string): string {
	const sevColor: Record<string, string> = { critical: '#d32f2f', high: '#f57c00', medium: '#fbc02d', low: '#388e3c', info: '#1976d2' };
	const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	const catNames: Record<string, string> = {
		security: 'Beveiliging', wcag: 'Toegankelijkheid', privacy: 'Privacy',
		performance: 'Snelheid', standards: 'Standaarden',
	};
	const catNamesTech: Record<string, string> = {
		security: 'Security Headers & Cookies', wcag: 'Toegankelijkheid (WCAG 2.2 AA)', privacy: 'Privacy & AVG',
		performance: 'Performance & Resources', standards: 'Overheidsstandaarden',
	};

	const totals = countSeverities(Object.values(result.categories).flatMap((c) => c.findings));
	const totalCount = totals.hoog + totals.midden + totals.laag;

	function mdToHtml(text: string): string {
		return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/^#{1,3}\s+(.*)$/gm, '<strong>$1</strong>').replace(/^[-*]\s+(.*)$/gm, '$1')
			.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
			.map((l) => `<p style="margin:0.5rem 0">${l}</p>`).join('');
	}

	const aiSection = executiveSummary ? `
		<section style="margin:2rem 0;padding:1.5rem;background:#fff3e0;border:2px solid #f57c00;border-radius:8px">
			<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
				<span style="background:#f57c00;color:#fff;padding:3px 10px;border-radius:4px;font-size:0.75rem;font-weight:700">AI-GEGENEREERD</span>
				<strong style="font-size:1.1rem">Samenvatting voor bestuurders</strong>
			</div>
			<div style="color:#333;line-height:1.8">${mdToHtml(executiveSummary)}</div>
			<p style="margin:0.75rem 0 0;font-size:0.8rem;color:#888;font-style:italic">Deze samenvatting is automatisch opgesteld door AI (DeepSeek) op basis van de scan-uitkomsten hieronder. De feitelijke bevindingen zijn regel-gebaseerd en onafhankelijk vastgesteld.</p>
		</section>` : '';

	const trackerSection = trackerExplanation ? `
		<section style="margin:2rem 0;padding:1.5rem;background:#fce4ec;border:2px solid #d32f2f;border-radius:8px">
			<h2 style="margin:0 0 0.75rem;color:#d32f2f">Wat doen deze trackers met gegevens van uw inwoners?</h2>
			<p style="margin:0 0 1rem;color:#333">Op uw website zijn diensten gevonden die gegevens van bezoekers verzamelen en doorsturen naar externe bedrijven. Hieronder staat per dienst wat er precies gebeurt:</p>
			<ul style="margin:0;padding-left:1.25rem;color:#333">${trackerExplanation}</ul>
			<p style="margin:1rem 0 0;color:#333"><strong>Waarom is dit een probleem?</strong> Volgens de AVG en de Telecommunicatiewet mag dit alleen als bezoekers hier vooraf actief toestemming voor geven.</p>
		</section>` : '';

	const domain = new URL(result.targetUrl).hostname;

	return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Guardian Rapport — ${domain}</title>
<style>
	body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1a1a2e;max-width:960px;margin:0 auto;padding:2rem 1rem;line-height:1.6}
	h1{font-size:1.75rem}h2{font-size:1.25rem}h3{font-size:1.1rem}
	a{color:#154273}
	table{width:100%;border-collapse:collapse;margin:1rem 0}
	th,td{padding:0.6rem 0.75rem;text-align:left;border-bottom:1px solid #ddd}
	th{background:#f5f5f5;font-weight:700;font-size:0.9rem}
	td{font-size:0.9rem}
	.badge{display:inline-block;padding:2px 10px;border-radius:3px;font-weight:700;font-size:0.8rem}
	.b-hoog{background:#d32f2f;color:#fff}.b-midden{background:#fbc02d;color:#1a1a2e}.b-laag{background:#388e3c;color:#fff}
	details{margin:0.5rem 0;border:1px solid #ddd;border-radius:4px}
	details summary{cursor:pointer;font-weight:600;padding:0.75rem 1rem;font-size:0.95rem}
	details summary:hover{background:#f9f9f9}
	@media print{body{padding:0.5rem}section,details{break-inside:avoid}details[open]{break-inside:auto}}
	.page-break{page-break-before:always;margin-top:2rem}
</style>
</head>
<body>

<!-- ════════════════════════════════════════ -->
<!-- PAGINA 1: RESULTATEN                     -->
<!-- ════════════════════════════════════════ -->

<header style="margin-bottom:1.5rem">
	<h1>Rapport scan gemeentewebsite ${domain}</h1>
	<p style="color:#888;font-size:0.9rem">Gescand op ${new Date(result.scannedAt).toLocaleString('nl-NL')} | ${totalCount} bevindingen</p>
</header>

<section style="background:#e8f5e9;border:2px solid #2e7d32;border-radius:8px;padding:1rem;margin-bottom:1.5rem">
	<p style="margin:0;font-size:0.9rem;color:#1b5e20"><strong>Dit is een gratis en onafhankelijke scan.</strong> Site Guardian is open source (EUPL-1.2) en vraagt geen geld voor rapporten. Elke gemeente verdient inzicht in de digitale veiligheid en privacy van haar website — zonder factuur.</p>
</section>

<!-- Overzichtstabel: totalen -->
<h2>Overzicht</h2>
<table>
	<thead><tr><th>Ernst</th><th style="text-align:center">Aantal</th><th>Betekenis</th></tr></thead>
	<tbody>
		<tr${totals.hoog > 0 ? ' style="background:#ffebee"' : ''}><td><span class="badge b-hoog">HOOG</span></td><td style="text-align:center"><strong>${totals.hoog}</strong></td><td>Directe risico's voor privacy of veiligheid van inwoners. Zo snel mogelijk oplossen.</td></tr>
		<tr${totals.midden > 0 ? ' style="background:#fff8e1"' : ''}><td><span class="badge b-midden">MIDDEN</span></td><td style="text-align:center"><strong>${totals.midden}</strong></td><td>Verbeterpunten die de website veiliger en toegankelijker maken. Plan deze in.</td></tr>
		<tr><td><span class="badge b-laag">LAAG</span></td><td style="text-align:center"><strong>${totals.laag}</strong></td><td>Kleine verbeteringen. Neem mee bij regulier onderhoud.</td></tr>
	</tbody>
</table>

<!-- Overzichtstabel: per categorie -->
<table style="margin-top:0.5rem">
	<thead><tr><th>Onderdeel</th><th style="text-align:center">Hoog</th><th style="text-align:center">Midden</th><th style="text-align:center">Laag</th></tr></thead>
	<tbody>
		${Object.entries(result.categories).map(([key, cat]) => {
			const c = countSeverities(cat.findings);
			return `<tr><td>${catNames[key]}</td><td style="text-align:center;${c.hoog > 0 ? 'color:#d32f2f;font-weight:700' : 'color:#888'}">${c.hoog}</td><td style="text-align:center;${c.midden > 0 ? 'color:#e65100;font-weight:700' : 'color:#888'}">${c.midden}</td><td style="text-align:center;color:#888">${c.laag}</td></tr>`;
		}).join('')}
	</tbody>
</table>

${aiSection}

${trackerSection}

<!-- Technische details per categorie -->
<h2 style="margin-top:2rem">Bevindingen per onderdeel</h2>
<p style="color:#666;font-size:0.9rem;margin-bottom:1rem">Vastgesteld door geautomatiseerde, regel-gebaseerde controles (geen AI). Gesorteerd van hoog naar laag.</p>

${Object.entries(result.categories).map(([key, cat]) => {
	const c = countSeverities(cat.findings);
	const sorted = [...cat.findings].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
	const summaryBadges = [
		c.hoog > 0 ? `<span class="badge b-hoog">${c.hoog} hoog</span>` : '',
		c.midden > 0 ? `<span class="badge b-midden">${c.midden} midden</span>` : '',
		c.laag > 0 ? `<span class="badge b-laag">${c.laag} laag</span>` : '',
	].filter(Boolean).join(' ');

	return `
<details${c.hoog > 0 ? ' open' : ''}>
	<summary>${catNamesTech[key]} ${summaryBadges || '<span style="color:#388e3c;font-size:0.85rem">Geen bevindingen</span>'}</summary>
	<div style="padding:0.5rem 1rem 1rem">
		${sorted.length > 0 ? sorted.map((f) => `
		<div style="border-left:4px solid ${sevColor[f.severity]};padding:0.5rem 0.75rem;margin:0.5rem 0;background:#f9f9f9;border-radius:0 4px 4px 0">
			<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem">
				<span class="badge" style="background:${sevColor[f.severity]};color:${f.severity === 'medium' ? '#1a1a2e' : '#fff'};font-size:0.7rem">${f.severity === 'critical' || f.severity === 'high' ? 'HOOG' : f.severity === 'medium' ? 'MIDDEN' : 'LAAG'}</span>
				<strong style="font-size:0.95rem">${f.title}</strong>
			</div>
			<p style="margin:0.25rem 0;color:#333;font-size:0.9rem">${f.description}</p>
			${f.location ? `<p style="margin:0.25rem 0;font-family:monospace;font-size:0.8rem;color:#666">${f.location}</p>` : ''}
			<p style="margin:0.25rem 0;color:#154273;font-size:0.9rem">${f.recommendation}</p>
			${f.reference ? `<p style="margin:0.25rem 0;font-size:0.75rem;color:#888">${f.reference}</p>` : ''}
		</div>`).join('') : '<p style="color:#388e3c">Geen bevindingen</p>'}
		${cat.recommendations.length > 0 ? `<div style="margin-top:0.75rem;padding:0.75rem;background:#e8f0fe;border-radius:4px;font-size:0.9rem"><strong>Aanbevelingen:</strong><ul style="margin:0.5rem 0 0 1.25rem">${cat.recommendations.map((r) => `<li>${r}</li>`).join('')}</ul></div>` : ''}
	</div>
</details>`;
}).join('')}

<!-- ════════════════════════════════════════ -->
<!-- PAGINA 2: WAT SCANNEN WIJ EN WAAROM     -->
<!-- ════════════════════════════════════════ -->

<section class="page-break">
<h1>Wat scannen wij en waarom</h1>
<p style="color:#666;margin-bottom:1.5rem">Site Guardian controleert gemeentewebsites op vijf onderdelen. Hieronder leggen we per onderdeel uit waarom het belangrijk is.</p>

<h2 style="color:#154273">Beveiliging</h2>
<p>Gemeentewebsites verwerken persoonsgegevens van inwoners. Zonder goede beveiliging kunnen kwaadwillenden gegevens onderscheppen, de website misbruiken voor phishing, of bezoekers omleiden naar schadelijke pagina's. Wij controleren beveiligingsheaders, cookie-instellingen, HTTPS-configuratie en of de website technische details lekt die aanvallers kunnen misbruiken.</p>

<h2 style="color:#154273">Toegankelijkheid</h2>
<p>Nederlandse overheidswebsites zijn wettelijk verplicht om toegankelijk te zijn voor iedereen, inclusief mensen met een visuele, auditieve of motorische beperking (Besluit digitale toegankelijkheid overheid, WCAG 2.2 AA). Wij controleren taalinstelling, koppenstructuur, alternatieve tekst bij afbeeldingen, formulierlabels, toetsenbordnavigatie en zoombeperking.</p>

<h2 style="color:#154273">Privacy</h2>
<p>Gemeenten hebben een bijzondere verantwoordelijkheid richting hun inwoners. Inwoners moeten erop kunnen vertrouwen dat hun bezoek aan de gemeentewebsite niet wordt gevolgd door commerciële partijen. Wij controleren of er tracking-diensten actief zijn, of er een correct toestemmingsmechanisme is, hoeveel externe partijen gegevens ontvangen, en of er een privacyverklaring vindbaar is.</p>

<h2 style="color:#154273">Snelheid</h2>
<p>Een trage website is niet alleen vervelend, maar ook een toegankelijkheidsprobleem. Inwoners met een langzame internetverbinding of ouder apparaat worden buitengesloten. Wij controleren het aantal HTTP-verzoeken, externe afhankelijkheden, render-blocking scripts, compressie en caching.</p>

<h2 style="color:#154273">Overheidsstandaarden</h2>
<p>Nederlandse gemeenten moeten voldoen aan de verplichte standaarden van het Forum Standaardisatie. Dit borgt dat overheidswebsites betrouwbaar, vindbaar en interoperabel zijn. Wij controleren HTTPS, de aanwezigheid van een toegankelijkheidsverklaring, responsief ontwerp en correcte metadata.</p>

<h2 style="margin-top:2rem">Over dit rapport</h2>
<p>De technische bevindingen zijn vastgesteld door geautomatiseerde, regel-gebaseerde controles. Er wordt geen AI gebruikt voor de bevindingen zelf.${executiveSummary ? ' De bestuurders-samenvatting is opgesteld door AI (DeepSeek) en is in het rapport duidelijk als zodanig gemarkeerd.' : ''}</p>
<p>Site Guardian is open source (EUPL-1.2), volledig gratis, en heeft geen commercieel belang. Voor het scannen van broncode en repositories: <a href="https://gitguardian.publicvibes.nl">gitguardian.publicvibes.nl</a></p>

<hr style="border:none;border-top:1px solid #ddd;margin:2rem 0 1rem">
<p style="text-align:center;color:#888;font-size:0.85rem">Dit rapport is gratis ter beschikking gesteld vanuit <a href="https://publicvibes.nl">publicvibes.nl</a>, een open source initiatief van Ralph Wagter.</p>
</section>

</body>
</html>`;
}

// ── Main ──

async function main() {
	console.log('=== Site Guardian — Standalone Scan ===');
	console.log(`Target: ${TARGET_URL}\n`);

	// Load .env if present
	try {
		const { readFileSync } = await import('node:fs');
		const envFile = readFileSync(resolve(import.meta.dirname ?? '.', '..', '.env'), 'utf-8');
		for (const line of envFile.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx > 0) {
				const key = trimmed.slice(0, eqIdx).trim();
				const val = trimmed.slice(eqIdx + 1).trim();
				if (!process.env[key]) process.env[key] = val;
			}
		}
	} catch { /* no .env file, that's fine */ }

	const browserData = await collectBrowserData(TARGET_URL);

	console.log('\nAnalyse uitvoeren (regel-gebaseerd)...');
	const security = analyzeSecurityHeaders(browserData);
	const wcag = analyzeWcag(browserData);
	const privacy = analyzePrivacy(browserData);
	const performance = analyzePerformance(browserData);
	const standards = analyzeStandards(browserData);

	const weights = { security: 0.25, wcag: 0.25, privacy: 0.20, performance: 0.15, standards: 0.15 };
	const overallScore = Math.round(
		security.score * weights.security + wcag.score * weights.wcag +
		privacy.score * weights.privacy + performance.score * weights.performance +
		standards.score * weights.standards,
	);

	const result: ScanResult = {
		targetUrl: TARGET_URL,
		scannedAt: new Date().toISOString(),
		categories: { security, wcag, privacy, performance, standards },
		overallScore,
		overallRating: scoreToRating(overallScore),
	};

	// DeepSeek executive summary (optional, only when requested)
	let executiveSummary: string | null = null;
	if (INCLUDE_SUMMARY) {
		const deepseekKey = process.env.DEEPSEEK_API_KEY ?? '';
		if (deepseekKey) {
			console.log('\nBestuurders-samenvatting genereren via DeepSeek...');
			executiveSummary = await generateExecutiveSummary(result);
			if (executiveSummary) console.log('  Samenvatting ontvangen');
		} else {
			console.log('\nBestuurders-samenvatting: geen API key, overgeslagen');
		}
	} else {
		console.log('\nBestuurders-samenvatting: uitgeschakeld (--no-summary)');
	}

	// Tracker explanation
	const trackerExplanation = explainTrackers(browserData);

	// Write reports
	mkdirSync(OUTPUT_DIR, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const domain = new URL(TARGET_URL).hostname.replace(/^www\./, '');
	const baseName = `${domain}_${timestamp}`;

	writeFileSync(resolve(OUTPUT_DIR, `${baseName}.json`), JSON.stringify(result, null, 2));
	writeFileSync(resolve(OUTPUT_DIR, `${baseName}.html`), generateHtmlReport(result, executiveSummary, trackerExplanation));

	const allFindings = Object.values(result.categories).flatMap((c) => c.findings);
	const totals = { hoog: 0, midden: 0, laag: 0 };
	for (const f of allFindings) {
		if (f.severity === 'critical' || f.severity === 'high') totals.hoog++;
		else if (f.severity === 'medium') totals.midden++;
		else totals.laag++;
	}

	console.log('\n=== RESULTAAT ===');
	console.log(`Score: ${result.overallScore}/100`);
	console.log(`Bevindingen: ${allFindings.length} totaal (${totals.hoog} hoog, ${totals.midden} midden, ${totals.laag} laag)`);
	console.log('---');
	for (const [key, cat] of Object.entries(result.categories)) {
		const c = { hoog: 0, midden: 0, laag: 0 };
		for (const f of cat.findings) {
			if (f.severity === 'critical' || f.severity === 'high') c.hoog++;
			else if (f.severity === 'medium') c.midden++;
			else c.laag++;
		}
		const name = { security: 'Beveiliging', wcag: 'Toegankelijk', privacy: 'Privacy', performance: 'Snelheid', standards: 'Standaarden' }[key] ?? key;
		console.log(`${name.padEnd(15)} ${String(cat.score).padStart(3)}/100  hoog:${c.hoog} midden:${c.midden} laag:${c.laag}`);
	}
	if (executiveSummary) console.log('AI-samenvatting: ja (DeepSeek)');
	console.log(`\nRapport: scan-results/${baseName}.html`);
	console.log(`JSON:    scan-results/${baseName}.json`);
}

main().catch((err) => {
	console.error('Scan mislukt:', err);
	process.exit(1);
});
