// Internal module: rule-based analyzers for site scanning.
// Prefixed with _ to indicate internal helper (not for direct import outside service layer).

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
	title: string;
	description: string;
	severity: Severity;
	location?: string;
	recommendation: string;
	reference?: string;
}

export interface CategoryResult {
	score: number;
	rating: string;
	findings: Finding[];
	recommendations: string[];
}

export interface BrowserData {
	title: string;
	lang: string;
	headers: Record<string, string>;
	html: string;
	links: { href: string; text: string }[];
	images: { src: string; alt: string | null; role: string | null }[];
	headings: { level: number; text: string }[];
	forms: {
		action: string;
		method: string;
		inputs: { name: string; type: string; hasLabel: boolean; ariaLabel: string | null }[];
	}[];
	meta: Record<string, string>;
	cookies: { name: string; domain: string; secure: boolean; httpOnly: boolean; sameSite: string }[];
	scripts: {
		src: string;
		async: boolean;
		defer: boolean;
		integrity: string | null;
		crossorigin: string | null;
	}[];
	resources: { url: string; type: string; status: number; size: number }[];
	landmarks: { tag: string; role: string | null; ariaLabel: string | null }[];
	skipLinks: string[];
	focusableWithoutOutline: number;
	externalDomains: string[];
	targetDomain: string;
}

export interface ScanResult {
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

export function scoreToRating(score: number): string {
	if (score >= 90) return 'A';
	if (score >= 80) return 'B';
	if (score >= 70) return 'C';
	if (score >= 60) return 'D';
	if (score >= 50) return 'E';
	return 'F';
}

function calcScore(findings: Finding[]): number {
	return Math.max(
		0,
		100 -
			findings.reduce(
				(s, f) => s + { critical: 25, high: 15, medium: 8, low: 3, info: 0 }[f.severity],
				0,
			),
	);
}

export function analyzeSecurityHeaders(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];
	const h = data.headers;

	if (!h['strict-transport-security']) {
		findings.push({
			title: 'HSTS header ontbreekt',
			description:
				'Strict-Transport-Security header is niet ingesteld. Zonder HSTS kan een aanvaller via een downgrade-aanval HTTPS omzeilen.',
			severity: 'high',
			location: 'HTTP Response Headers',
			recommendation:
				'Voeg toe: Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
			reference: 'OWASP A05:2021 — Security Misconfiguration',
		});
	} else if (!h['strict-transport-security'].includes('includeSubDomains')) {
		findings.push({
			title: 'HSTS zonder includeSubDomains',
			description:
				'HSTS is ingesteld maar zonder includeSubDomains, waardoor subdomeinen kwetsbaar blijven.',
			severity: 'medium',
			location: `HSTS: ${h['strict-transport-security']}`,
			recommendation: 'Voeg includeSubDomains toe aan de HSTS header.',
			reference: 'RFC 6797',
		});
	}

	if (!h['content-security-policy']) {
		findings.push({
			title: 'Content-Security-Policy ontbreekt',
			description:
				'Geen CSP header gevonden. CSP voorkomt XSS-aanvallen door te beperken welke bronnen geladen mogen worden.',
			severity: 'high',
			location: 'HTTP Response Headers',
			recommendation:
				'Stel een Content-Security-Policy in die minimaal default-src, script-src en style-src definieert.',
			reference: 'OWASP A03:2021 — Injection / CWE-79',
		});
	}

	if (!h['x-content-type-options']?.includes('nosniff')) {
		findings.push({
			title: 'X-Content-Type-Options ontbreekt',
			description: 'Browser kan MIME-types raden (MIME-sniffing), wat tot XSS kan leiden.',
			severity: 'medium',
			location: 'HTTP Response Headers',
			recommendation: 'Voeg toe: X-Content-Type-Options: nosniff',
			reference: 'CWE-16',
		});
	}

	const xfo = h['x-frame-options']?.toLowerCase();
	if (!xfo || (xfo !== 'deny' && xfo !== 'sameorigin')) {
		findings.push({
			title: 'X-Frame-Options ontbreekt of ongeldig',
			description:
				'Zonder X-Frame-Options kan de website in een iframe geladen worden (clickjacking).',
			severity: 'medium',
			location: `X-Frame-Options: ${xfo ?? 'niet aanwezig'}`,
			recommendation: 'Voeg toe: X-Frame-Options: DENY of SAMEORIGIN',
			reference: 'CWE-1021 / OWASP Clickjacking',
		});
	}

	if (!h['referrer-policy']) {
		findings.push({
			title: 'Referrer-Policy ontbreekt',
			description:
				'Zonder Referrer-Policy kan gevoelige URL-informatie via de Referer header lekken.',
			severity: 'low',
			location: 'HTTP Response Headers',
			recommendation: 'Voeg toe: Referrer-Policy: strict-origin-when-cross-origin',
			reference: 'OWASP Security Headers',
		});
	}

	if (!h['permissions-policy'] && !h['feature-policy']) {
		findings.push({
			title: 'Permissions-Policy ontbreekt',
			description:
				'Zonder Permissions-Policy kunnen third-party scripts toegang krijgen tot camera, microfoon en locatie.',
			severity: 'low',
			location: 'HTTP Response Headers',
			recommendation: 'Voeg toe: Permissions-Policy: camera=(), microphone=(), geolocation=()',
			reference: 'W3C Permissions Policy',
		});
	}

	if (h['server'] && h['server'] !== 'nginx' && h['server'] !== 'Apache') {
		if (/\d/.test(h['server'])) {
			findings.push({
				title: 'Server versie zichtbaar',
				description: `De Server header toont versie-informatie: "${h['server']}". Dit helpt aanvallers bij het vinden van bekende kwetsbaarheden.`,
				severity: 'low',
				location: `Server: ${h['server']}`,
				recommendation: 'Verberg de versie in de Server header.',
				reference: 'CWE-200',
			});
		}
	}

	if (h['x-powered-by']) {
		findings.push({
			title: 'X-Powered-By header zichtbaar',
			description: `De X-Powered-By header toont: "${h['x-powered-by']}". Dit onthult technologie-informatie.`,
			severity: 'low',
			location: `X-Powered-By: ${h['x-powered-by']}`,
			recommendation: 'Verwijder de X-Powered-By header.',
			reference: 'CWE-200',
		});
	}

	for (const cookie of data.cookies) {
		if (!cookie.secure) {
			findings.push({
				title: `Cookie "${cookie.name}" zonder Secure flag`,
				description: 'Cookie wordt ook over onversleutelde HTTP verbindingen verstuurd.',
				severity: 'medium',
				location: `Cookie: ${cookie.name}`,
				recommendation: 'Zet de Secure flag op alle cookies.',
				reference: 'CWE-614',
			});
		}
		if (!cookie.httpOnly && !cookie.name.startsWith('_ga') && !cookie.name.startsWith('_gid')) {
			findings.push({
				title: `Cookie "${cookie.name}" zonder HttpOnly flag`,
				description:
					'Cookie is toegankelijk via JavaScript, wat het risico op XSS-diefstal vergroot.',
				severity: 'low',
				location: `Cookie: ${cookie.name}`,
				recommendation: 'Zet de HttpOnly flag tenzij JavaScript-toegang noodzakelijk is.',
				reference: 'CWE-1004',
			});
		}
		if (cookie.sameSite === 'None' || cookie.sameSite === '') {
			findings.push({
				title: `Cookie "${cookie.name}" zonder SameSite`,
				description: 'Cookie wordt meegestuurd bij cross-site requests (CSRF-risico).',
				severity: 'medium',
				location: `Cookie: ${cookie.name}`,
				recommendation: 'Zet SameSite=Strict of SameSite=Lax.',
				reference: 'CWE-352',
			});
		}
	}

	const extScriptsNoSri = data.scripts.filter((s) => {
		try {
			return new URL(s.src).hostname !== data.targetDomain && !s.integrity;
		} catch {
			return false;
		}
	});
	if (extScriptsNoSri.length > 0) {
		findings.push({
			title: `${extScriptsNoSri.length} externe scripts zonder Subresource Integrity`,
			description:
				'Externe scripts worden geladen zonder SRI hash. Als de externe bron gehackt wordt, kan kwaadaardige code worden geïnjecteerd.',
			severity: 'medium',
			location: extScriptsNoSri
				.map((s) => s.src)
				.slice(0, 3)
				.join(', '),
			recommendation: 'Voeg integrity en crossorigin attributen toe aan externe script tags.',
			reference: 'SRI / OWASP A08:2021',
		});
	}

	const score = calcScore(findings);
	return {
		score,
		rating: scoreToRating(score),
		findings,
		recommendations:
			findings.length > 0
				? [
						'Implementeer alle ontbrekende security headers via de webserver of reverse proxy (bijv. Traefik/nginx).',
						'Gebruik securityheaders.com om de huidige configuratie te testen.',
					]
				: [],
	};
}

export function analyzeWcag(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	if (!data.lang) {
		findings.push({
			title: 'HTML lang attribuut ontbreekt',
			description:
				'Het lang attribuut op het html-element ontbreekt. Schermlezers weten hierdoor niet in welke taal de pagina is.',
			severity: 'high',
			location: '<html>',
			recommendation: 'Voeg lang="nl" toe aan het <html> element.',
			reference: 'WCAG 3.1.1 (Niveau A)',
		});
	} else if (!data.lang.startsWith('nl')) {
		findings.push({
			title: 'HTML lang attribuut niet Nederlands',
			description: `Het lang attribuut is "${data.lang}" maar de website is Nederlandstalig.`,
			severity: 'medium',
			location: `<html lang="${data.lang}">`,
			recommendation: 'Zet lang="nl" op het <html> element.',
			reference: 'WCAG 3.1.1 (Niveau A)',
		});
	}

	const h1s = data.headings.filter((h) => h.level === 1);
	if (h1s.length === 0) {
		findings.push({
			title: 'Geen h1 heading gevonden',
			description: 'Elke pagina moet minimaal een h1 heading hebben voor schermlezers en SEO.',
			severity: 'high',
			location: 'Document',
			recommendation: 'Voeg een <h1> toe met de paginatitel.',
			reference: 'WCAG 1.3.1 (Niveau A)',
		});
	} else if (h1s.length > 1) {
		findings.push({
			title: `Meerdere h1 headings (${h1s.length})`,
			description: 'Er zijn meerdere h1 elements gevonden. Een h1 per pagina is best practice.',
			severity: 'low',
			location: h1s.map((h) => h.text).join(', '),
			recommendation: 'Gebruik slechts een <h1> per pagina.',
			reference: 'WCAG 1.3.1 (Niveau A) — best practice',
		});
	}

	for (let i = 1; i < data.headings.length; i++) {
		const prev = data.headings[i - 1].level;
		const curr = data.headings[i].level;
		if (curr > prev + 1) {
			findings.push({
				title: `Heading niveau overgeslagen: h${prev} -> h${curr}`,
				description: `Na een h${prev} ("${data.headings[i - 1].text}") volgt een h${curr} ("${data.headings[i].text}"). Heading-niveaus mogen niet worden overgeslagen.`,
				severity: 'medium',
				location: `h${curr}: ${data.headings[i].text}`,
				recommendation: `Gebruik h${prev + 1} in plaats van h${curr}, of herstructureer de heading-hierarchie.`,
				reference: 'WCAG 1.3.1 (Niveau A)',
			});
			break;
		}
	}

	const imagesNoAlt = data.images.filter((img) => img.alt === null && img.role !== 'presentation');
	if (imagesNoAlt.length > 0) {
		findings.push({
			title: `${imagesNoAlt.length} afbeelding(en) zonder alt tekst`,
			description: 'Afbeeldingen zonder alt attribuut zijn ontoegankelijk voor schermlezers.',
			severity: imagesNoAlt.length > 5 ? 'high' : 'medium',
			location: imagesNoAlt
				.slice(0, 3)
				.map((i) => i.src.split('/').pop())
				.join(', '),
			recommendation: 'Voeg beschrijvende alt tekst toe, of alt="" voor decoratieve afbeeldingen.',
			reference: 'WCAG 1.1.1 (Niveau A)',
		});
	}

	const emptyAlts = data.images.filter((img) => img.alt === '');
	if (emptyAlts.length > data.images.length * 0.7 && data.images.length > 5) {
		findings.push({
			title: 'Verdacht veel lege alt attributen',
			description: `${emptyAlts.length} van ${data.images.length} afbeeldingen hebben alt="". Niet alle afbeeldingen zijn decoratief.`,
			severity: 'medium',
			location: 'Afbeeldingen',
			recommendation:
				'Controleer of afbeeldingen met inhoudelijke waarde een beschrijvende alt tekst krijgen.',
			reference: 'WCAG 1.1.1 (Niveau A)',
		});
	}

	const hasMain = data.landmarks.some((l) => l.tag === 'main' || l.role === 'main');
	const hasNav = data.landmarks.some((l) => l.tag === 'nav' || l.role === 'navigation');
	if (!hasMain) {
		findings.push({
			title: 'Geen <main> landmark',
			description:
				'Er is geen <main> element of role="main" gevonden. Schermlezers gebruiken landmarks om te navigeren.',
			severity: 'high',
			location: 'Document structuur',
			recommendation: 'Omsluit de hoofdinhoud met een <main> element.',
			reference: 'WCAG 1.3.1 (Niveau A)',
		});
	}
	if (!hasNav) {
		findings.push({
			title: 'Geen <nav> landmark',
			description: 'Er is geen <nav> element of role="navigation" gevonden.',
			severity: 'medium',
			location: 'Document structuur',
			recommendation: 'Omsluit de hoofdnavigatie met een <nav> element.',
			reference: 'WCAG 1.3.1 (Niveau A)',
		});
	}

	if (data.skipLinks.length === 0) {
		findings.push({
			title: 'Geen skip link gevonden',
			description:
				'Er is geen "Ga naar hoofdinhoud" link gevonden. Toetsenbordgebruikers moeten door alle navigatie-items tabben.',
			severity: 'medium',
			location: 'Document begin',
			recommendation:
				'Voeg een skip link toe: <a href="#main-content" class="skip-link">Ga naar hoofdinhoud</a>',
			reference: 'WCAG 2.4.1 (Niveau A)',
		});
	}

	for (const form of data.forms) {
		const unlabeled = form.inputs.filter(
			(i) => !i.hasLabel && i.type !== 'submit' && i.type !== 'button',
		);
		if (unlabeled.length > 0) {
			findings.push({
				title: `${unlabeled.length} formulierveld(en) zonder label`,
				description: `In het formulier (${form.action}) missen labels op: ${unlabeled.map((i) => i.name || i.type).join(', ')}`,
				severity: 'high',
				location: `Formulier: ${form.action}`,
				recommendation: 'Koppel een <label for="id"> aan elk invoerveld, of gebruik aria-label.',
				reference: 'WCAG 1.3.1 / 4.1.2 (Niveau A)',
			});
		}
	}

	if (!data.meta['viewport']) {
		findings.push({
			title: 'Viewport meta tag ontbreekt',
			description:
				'Zonder viewport meta tag wordt de pagina niet correct weergegeven op mobiele apparaten.',
			severity: 'medium',
			location: '<head>',
			recommendation:
				'Voeg toe: <meta name="viewport" content="width=device-width, initial-scale=1">',
			reference: 'WCAG 1.4.10 (Niveau AA)',
		});
	} else if (
		data.meta['viewport'].includes('maximum-scale=1') ||
		data.meta['viewport'].includes('user-scalable=no')
	) {
		findings.push({
			title: 'Viewport voorkomt inzoomen',
			description:
				'De viewport meta tag beperkt het zoomen, wat gebruikers met visuele beperkingen belemmert.',
			severity: 'high',
			location: `viewport: ${data.meta['viewport']}`,
			recommendation: 'Verwijder maximum-scale=1 en user-scalable=no uit de viewport meta tag.',
			reference: 'WCAG 1.4.4 (Niveau AA)',
		});
	}

	const score = calcScore(findings);
	return {
		score,
		rating: scoreToRating(score),
		findings,
		recommendations:
			findings.length > 0
				? [
						'Voer een volledige WCAG 2.2 AA audit uit met axe-core of Lighthouse.',
						'Test met een schermlezer (NVDA of VoiceOver) en alleen-toetsenbord navigatie.',
					]
				: [],
	};
}

export function analyzePrivacy(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	const trackerDomains: Record<string, string> = {
		'google-analytics.com': 'Google Analytics',
		'www.google-analytics.com': 'Google Analytics',
		'googletagmanager.com': 'Google Tag Manager',
		'www.googletagmanager.com': 'Google Tag Manager',
		'facebook.net': 'Facebook Pixel',
		'connect.facebook.net': 'Facebook Pixel',
		'facebook.com': 'Facebook',
		'www.facebook.com': 'Facebook',
		'doubleclick.net': 'Google DoubleClick',
		'ad.doubleclick.net': 'Google DoubleClick',
		'hotjar.com': 'Hotjar',
		'static.hotjar.com': 'Hotjar',
		'clarity.ms': 'Microsoft Clarity',
		'linkedin.com': 'LinkedIn Tracking',
		'snap.licdn.com': 'LinkedIn Tracking',
		'twitter.com': 'Twitter/X Tracking',
		'platform.twitter.com': 'Twitter/X Tracking',
		'tiktok.com': 'TikTok Pixel',
		'analytics.tiktok.com': 'TikTok Pixel',
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
		findings.push({
			title: `${foundTrackers.length} tracker(s) gedetecteerd`,
			description: `De volgende tracking-diensten worden geladen: ${foundTrackers.join(', ')}. Dit vereist voorafgaande toestemming onder de AVG.`,
			severity: 'high',
			location: foundTrackers.join(', '),
			recommendation:
				'Laad tracking scripts pas NA expliciete toestemming van de bezoeker (opt-in). Gebruik geen cookie wall.',
			reference: 'AVG Art. 6 / ePrivacy Richtlijn Art. 5(3)',
		});
	}

	const consentIndicators = ['cookie', 'consent', 'gdpr', 'avg', 'privacy', 'toestemming'];
	const hasConsentBanner = data.html
		.toLowerCase()
		.match(
			new RegExp(consentIndicators.map((i) => `(class|id|aria-label)="[^"]*${i}[^"]*"`).join('|')),
		);
	if (!hasConsentBanner && data.cookies.length > 0) {
		findings.push({
			title: 'Geen cookie consent banner gedetecteerd',
			description:
				'Er worden cookies geplaatst maar er is geen zichtbaar toestemmingsmechanisme gevonden.',
			severity: foundTrackers.length > 0 ? 'high' : 'medium',
			location: 'Document',
			recommendation:
				'Implementeer een cookie consent banner die toestemming vraagt VOORDAT niet-functionele cookies worden geplaatst.',
			reference: 'AVG Art. 7 / Telecommunicatiewet Art. 11.7a',
		});
	}

	if (data.externalDomains.length > 10) {
		findings.push({
			title: `${data.externalDomains.length} externe domeinen geladen`,
			description: `De pagina laadt resources van ${data.externalDomains.length} externe domeinen. Elk domein ontvangt potentieel IP-adres en browsgegevens van bezoekers.`,
			severity: 'medium',
			location:
				data.externalDomains.slice(0, 5).join(', ') +
				(data.externalDomains.length > 5 ? ` (+${data.externalDomains.length - 5} meer)` : ''),
			recommendation:
				'Minimaliseer externe afhankelijkheden. Host fonts en scripts lokaal waar mogelijk.',
			reference: 'AVG Art. 5(1)(c) — Dataminimalisatie',
		});
	}

	const privacyLinks = data.links.filter(
		(l) =>
			l.text.toLowerCase().match(/privacy|privacybeleid|privacyverklaring|gegevensbescherming/) ||
			l.href.toLowerCase().match(/privacy|privacybeleid/),
	);
	if (privacyLinks.length === 0) {
		findings.push({
			title: 'Geen link naar privacyverklaring gevonden',
			description:
				'Er is geen zichtbare link naar een privacybeleid/privacyverklaring op de homepage.',
			severity: 'high',
			location: 'Footer/navigatie',
			recommendation: 'Plaats een link naar de privacyverklaring in de footer van elke pagina.',
			reference: 'AVG Art. 13/14',
		});
	}

	const analyticsCookies = data.cookies.filter((c) =>
		c.name.match(/^(_ga|_gid|_gat|_gcl|_fbp|_fbc|hjSession|_clck|_clsk)/),
	);
	if (analyticsCookies.length > 0) {
		findings.push({
			title: `${analyticsCookies.length} analytics cookie(s) zonder aantoonbare toestemming`,
			description: `Cookies gedetecteerd: ${analyticsCookies.map((c) => c.name).join(', ')}. Deze worden direct bij het laden geplaatst.`,
			severity: 'high',
			location: analyticsCookies.map((c) => c.name).join(', '),
			recommendation:
				'Plaats analytics cookies pas na expliciete opt-in. Gebruik cookieless analytics als alternatief.',
			reference: 'AP Normuitleg cookies / ePrivacy Art. 5(3)',
		});
	}

	const score = calcScore(findings);
	return {
		score,
		rating: scoreToRating(score),
		findings,
		recommendations:
			findings.length > 0
				? [
						'Voer een cookie-audit uit met CookieYes of vergelijkbare tool.',
						'Controleer of de verwerkingsregister (AVG Art. 30) up-to-date is.',
						'Overweeg cookieless analytics (bijv. Plausible, Fathom, of server-side Matomo).',
					]
				: [],
	};
}

export function analyzePerformance(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	const totalResources = data.resources.length;
	if (totalResources > 100) {
		findings.push({
			title: `Hoog aantal HTTP requests (${totalResources})`,
			description: `De pagina laadt ${totalResources} resources. Elk request voegt latentie toe.`,
			severity: totalResources > 200 ? 'high' : 'medium',
			location: `${totalResources} requests`,
			recommendation: 'Combineer en minimaliseer CSS/JS bestanden. Gebruik HTTP/2 multiplexing.',
			reference: 'Web Performance Best Practices',
		});
	}

	if (data.externalDomains.length > 5) {
		findings.push({
			title: `${data.externalDomains.length} externe domeinen (DNS lookups)`,
			description: 'Elke extern domein vereist een DNS lookup, TCP verbinding en TLS handshake.',
			severity: data.externalDomains.length > 15 ? 'high' : 'medium',
			location: data.externalDomains.slice(0, 5).join(', '),
			recommendation: 'Minimaliseer externe domeinen. Host fonts en veelgebruikte scripts lokaal.',
			reference: 'Reduce DNS lookups',
		});
	}

	const blockingScripts = data.scripts.filter((s) => !s.async && !s.defer);
	if (blockingScripts.length > 0) {
		findings.push({
			title: `${blockingScripts.length} render-blocking script(s)`,
			description: 'Scripts zonder async of defer blokkeren het renderen van de pagina.',
			severity: blockingScripts.length > 3 ? 'high' : 'medium',
			location: blockingScripts
				.slice(0, 3)
				.map((s) => s.src.split('/').pop())
				.join(', '),
			recommendation:
				'Voeg defer of async toe aan script tags die niet direct nodig zijn voor de eerste weergave.',
			reference: 'Eliminate render-blocking resources',
		});
	}

	if (!data.headers['content-encoding']?.match(/gzip|br|deflate/)) {
		findings.push({
			title: 'HTML niet gecomprimeerd',
			description:
				'De HTML response is niet gecomprimeerd met gzip of brotli. Dit vergroot de laadtijd.',
			severity: 'medium',
			location: 'Content-Encoding header',
			recommendation: 'Activeer gzip of brotli compressie op de webserver.',
			reference: 'Enable compression',
		});
	}

	if (!data.headers['cache-control'] && !data.headers['etag']) {
		findings.push({
			title: 'Geen caching headers',
			description: 'Zonder Cache-Control of ETag worden resources bij elk bezoek opnieuw geladen.',
			severity: 'medium',
			location: 'HTTP Response Headers',
			recommendation:
				'Stel Cache-Control headers in voor statische assets (CSS, JS, afbeeldingen).',
			reference: 'HTTP caching',
		});
	}

	const failedResources = data.resources.filter((r) => r.status >= 400);
	if (failedResources.length > 0) {
		findings.push({
			title: `${failedResources.length} mislukte resource(s)`,
			description: `Resources met HTTP foutcode: ${failedResources
				.slice(0, 5)
				.map((r) => `${r.status} ${r.url.split('/').pop()}`)
				.join(', ')}`,
			severity: failedResources.length > 3 ? 'medium' : 'low',
			location: `${failedResources.length} failed requests`,
			recommendation: 'Repareer of verwijder referenties naar niet-bestaande resources.',
			reference: 'Remove broken links/resources',
		});
	}

	const score = calcScore(findings);
	return {
		score,
		rating: scoreToRating(score),
		findings,
		recommendations:
			findings.length > 0
				? [
						'Gebruik Lighthouse (Chrome DevTools) voor een gedetailleerde performance audit.',
						'Overweeg een CDN voor statische assets.',
					]
				: [],
	};
}

export function analyzeStandards(data: BrowserData): CategoryResult {
	const findings: Finding[] = [];

	if (!data.resources[0]?.url.startsWith('https')) {
		findings.push({
			title: 'Website niet op HTTPS',
			description:
				'De website wordt niet via HTTPS geserveerd. Dit is verplicht voor alle overheidswebsites.',
			severity: 'critical',
			location: 'Protocol',
			recommendation: 'Schakel HTTPS in met een geldig TLS certificaat.',
			reference: 'Forum Standaardisatie — HTTPS verplicht',
		});
	}

	const a11yLinks = data.links.filter(
		(l) =>
			l.text.toLowerCase().match(/toegankelijkheid|accessibility|digitoegankelijk/) ||
			l.href.toLowerCase().match(/toegankelijkheid|accessibility/),
	);
	if (a11yLinks.length === 0) {
		findings.push({
			title: 'Geen toegankelijkheidsverklaring gevonden',
			description:
				'Nederlandse overheidswebsites zijn verplicht een toegankelijkheidsverklaring te publiceren.',
			severity: 'high',
			location: 'Footer/navigatie',
			recommendation:
				'Publiceer een toegankelijkheidsverklaring via het Register van toegankelijkheidsverklaringen (registreren op toegankelijkheidsverklaring.nl).',
			reference: 'Besluit digitale toegankelijkheid overheid (Wdo)',
		});
	}

	if (!data.meta['viewport']) {
		findings.push({
			title: 'Geen responsive viewport',
			description: 'Zonder viewport meta tag is de website niet mobiel-vriendelijk.',
			severity: 'medium',
			location: '<head>',
			recommendation: 'Voeg een viewport meta tag toe.',
			reference: 'WCAG 1.4.10',
		});
	}

	if (!data.meta['og:title'] && !data.meta['og:description']) {
		findings.push({
			title: 'Open Graph metadata ontbreekt',
			description:
				'Geen og:title of og:description gevonden. Dit beinvloedt hoe de website wordt weergegeven bij delen op sociale media.',
			severity: 'info',
			location: '<head>',
			recommendation: 'Voeg Open Graph meta tags toe (og:title, og:description, og:image).',
			reference: 'Open Graph Protocol',
		});
	}

	const nldsIndicators = data.html.match(
		/nl-design-system|rijksoverheid|gemeentelijk|denhaag|utrecht|amsterdam/i,
	);
	if (!nldsIndicators) {
		findings.push({
			title: 'Geen NL Design System gebruik gedetecteerd',
			description:
				'Er zijn geen indicatoren gevonden van NL Design System componenten. Voor overheidswebsites wordt dit sterk aanbevolen.',
			severity: 'info',
			location: 'HTML/CSS',
			recommendation:
				'Overweeg NL Design System componenten voor een consistente overheidsuitstraling. Zie nldesignsystem.nl.',
			reference: 'NL Design System / Gebruiker Centraal',
		});
	}

	if (!data.meta['description']) {
		findings.push({
			title: 'Meta description ontbreekt',
			description: 'Geen meta description gevonden. Dit beinvloedt zoekresultaten en vindbaarheid.',
			severity: 'low',
			location: '<head>',
			recommendation: 'Voeg een meta description toe die de pagina-inhoud samenvat.',
			reference: 'SEO best practice',
		});
	}

	if (!data.meta['charset'] && !data.html.match(/<meta charset/i)) {
		if (
			!data.headers['content-type']?.includes('charset=utf-8') &&
			!data.headers['content-type']?.includes('charset=UTF-8')
		) {
			findings.push({
				title: 'Charset niet expliciet gedefinieerd',
				description: 'Geen <meta charset="utf-8"> of Content-Type charset gevonden.',
				severity: 'low',
				location: '<head>',
				recommendation: 'Voeg <meta charset="utf-8"> toe aan de <head>.',
				reference: 'HTML5 standaard',
			});
		}
	}

	const score = calcScore(findings);
	return {
		score,
		rating: scoreToRating(score),
		findings,
		recommendations:
			findings.length > 0
				? [
						'Controleer de verplichte standaardenlijst op forumstandaardisatie.nl.',
						'Test DNS-instellingen (DNSSEC, DMARC, SPF, DKIM) via internet.nl.',
					]
				: [],
	};
}
