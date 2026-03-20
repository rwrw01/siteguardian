import { z } from 'zod';

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
	findings: Finding[];
	recommendations: string[];
}

interface ScanResult {
	targetUrl: string;
	scannedAt: string;
	categories: {
		security: CategoryResult;
		wcag: CategoryResult;
		privacy: CategoryResult;
	};
	totals: { hoog: number; midden: number; laag: number };
}

function countSev(findings: Finding[]) {
	let hoog = 0, midden = 0, laag = 0;
	for (const f of findings) {
		if (f.severity === 'critical' || f.severity === 'high') hoog++;
		else if (f.severity === 'medium') midden++;
		else laag++;
	}
	return { hoog, midden, laag };
}

/**
 * Server-side scan using fetch (no Playwright needed).
 * Checks HTTP headers, HTML meta tags, and basic structure.
 */
export async function scanWebsite(targetUrl: string): Promise<ScanResult> {
	const resp = await fetch(targetUrl, {
		headers: { 'User-Agent': 'SiteGuardian/1.0 (compliance scanner)' },
		redirect: 'follow',
	});
	const headers = Object.fromEntries(resp.headers.entries());
	const html = await resp.text();

	const security = analyzeHeaders(headers);
	const wcag = analyzeHtml(html);
	const privacy = analyzePrivacy(html, headers);

	const allFindings = [...security.findings, ...wcag.findings, ...privacy.findings];

	return {
		targetUrl,
		scannedAt: new Date().toISOString(),
		categories: { security, wcag, privacy },
		totals: countSev(allFindings),
	};
}

function analyzeHeaders(h: Record<string, string>): CategoryResult {
	const findings: Finding[] = [];

	if (!h['strict-transport-security']) {
		findings.push({ title: 'HSTS header ontbreekt', description: 'Zonder HSTS kan een aanvaller HTTPS omzeilen via een downgrade-aanval.', severity: 'high', location: 'HTTP headers', recommendation: 'Voeg Strict-Transport-Security toe met een lange max-age.', reference: 'OWASP A05:2021' });
	}
	if (!h['content-security-policy']) {
		findings.push({ title: 'Content-Security-Policy ontbreekt', description: 'Zonder CSP is de website kwetsbaarder voor cross-site scripting (XSS).', severity: 'high', location: 'HTTP headers', recommendation: 'Stel een Content-Security-Policy in.', reference: 'OWASP A03:2021' });
	}
	if (!h['x-content-type-options']?.includes('nosniff')) {
		findings.push({ title: 'X-Content-Type-Options ontbreekt', description: 'Browser kan bestandstypen raden, wat tot beveiligingsproblemen kan leiden.', severity: 'medium', location: 'HTTP headers', recommendation: 'Voeg X-Content-Type-Options: nosniff toe.', reference: 'CWE-16' });
	}
	const xfo = h['x-frame-options']?.toLowerCase();
	if (!xfo || (xfo !== 'deny' && xfo !== 'sameorigin')) {
		findings.push({ title: 'X-Frame-Options ontbreekt', description: 'De website kan in een iframe geladen worden (clickjacking).', severity: 'medium', location: 'HTTP headers', recommendation: 'Voeg X-Frame-Options: DENY toe.', reference: 'CWE-1021' });
	}
	if (!h['referrer-policy']) {
		findings.push({ title: 'Referrer-Policy ontbreekt', description: 'Gevoelige URL-informatie kan lekken naar externe websites.', severity: 'low', location: 'HTTP headers', recommendation: 'Voeg Referrer-Policy: strict-origin-when-cross-origin toe.', reference: 'OWASP Security Headers' });
	}

	return { findings, recommendations: findings.length > 0 ? ['Implementeer ontbrekende security headers via de webserver of reverse proxy.'] : [] };
}

function analyzeHtml(html: string): CategoryResult {
	const findings: Finding[] = [];

	if (!html.match(/<html[^>]*\slang=/i)) {
		findings.push({ title: 'HTML lang attribuut ontbreekt', description: 'Schermlezers weten niet in welke taal de pagina is.', severity: 'high', location: '<html>', recommendation: 'Voeg lang="nl" toe aan het <html> element.', reference: 'WCAG 3.1.1' });
	}
	if (!html.match(/<h1[\s>]/i)) {
		findings.push({ title: 'Geen h1 heading gevonden', description: 'Elke pagina moet minimaal één h1 heading hebben.', severity: 'medium', location: 'Document', recommendation: 'Voeg een <h1> toe.', reference: 'WCAG 1.3.1' });
	}
	if (!html.match(/<main[\s>]/i) && !html.match(/role=["']main["']/i)) {
		findings.push({ title: 'Geen main landmark', description: 'Schermlezers kunnen de hoofdinhoud niet vinden.', severity: 'medium', location: 'Document', recommendation: 'Omsluit de hoofdinhoud met <main>.', reference: 'WCAG 1.3.1' });
	}
	if (!html.match(/<meta[^>]*name=["']viewport["']/i)) {
		findings.push({ title: 'Viewport meta ontbreekt', description: 'Website wordt niet correct weergegeven op mobiel.', severity: 'medium', location: '<head>', recommendation: 'Voeg viewport meta tag toe.', reference: 'WCAG 1.4.10' });
	}

	const imgNoAlt = html.match(/<img(?![^>]*alt=)[^>]*>/gi);
	if (imgNoAlt && imgNoAlt.length > 0) {
		findings.push({ title: `${imgNoAlt.length} afbeelding(en) zonder alt tekst`, description: 'Afbeeldingen zonder alt zijn ontoegankelijk voor schermlezers.', severity: imgNoAlt.length > 5 ? 'high' : 'medium', location: 'Afbeeldingen', recommendation: 'Voeg beschrijvende alt tekst toe.', reference: 'WCAG 1.1.1' });
	}

	return { findings, recommendations: findings.length > 0 ? ['Voer een volledige WCAG 2.2 AA audit uit.'] : [] };
}

function analyzePrivacy(html: string, headers: Record<string, string>): CategoryResult {
	const findings: Finding[] = [];

	const trackers = ['google-analytics.com', 'googletagmanager.com', 'facebook.net', 'hotjar.com', 'clarity.ms', 'doubleclick.net'];
	const found = trackers.filter((t) => html.includes(t));
	if (found.length > 0) {
		findings.push({ title: `${found.length} tracker(s) gedetecteerd`, description: `Tracking-diensten gevonden: ${found.join(', ')}. Dit vereist voorafgaande toestemming.`, severity: 'high', location: found.join(', '), recommendation: 'Laad tracking scripts pas na expliciete toestemming (opt-in).', reference: 'AVG Art. 6 / ePrivacy Art. 5(3)' });
	}

	if (!html.match(/privacy|privacybeleid|privacyverklaring/i)) {
		findings.push({ title: 'Geen link naar privacyverklaring', description: 'Er is geen zichtbare link naar een privacybeleid.', severity: 'high', location: 'Footer', recommendation: 'Plaats een link naar de privacyverklaring.', reference: 'AVG Art. 13/14' });
	}

	if (!html.match(/toegankelijkheid|accessibility|digitoegankelijk/i)) {
		findings.push({ title: 'Geen toegankelijkheidsverklaring', description: 'Overheidswebsites zijn verplicht een toegankelijkheidsverklaring te publiceren.', severity: 'medium', location: 'Footer', recommendation: 'Publiceer een toegankelijkheidsverklaring.', reference: 'Wdo' });
	}

	return { findings, recommendations: findings.length > 0 ? ['Voer een cookie-audit uit en controleer het verwerkingsregister.'] : [] };
}
