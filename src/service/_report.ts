// Internal module: HTML report generation and tracker explanation for site scans.
// Prefixed with _ to indicate internal helper (not for direct import outside service layer).

import type { BrowserData, Finding, ScanResult } from './_analyzers';

const MISTRAL_BASE_URL = 'https://api.mistral.ai';

/**
 * Counts findings by severity bucket (hoog/midden/laag).
 * @param findings - Array of scan findings
 * @returns Object with hoog, midden, laag counts
 */
export function countSeverities(findings: Finding[]): {
	hoog: number;
	midden: number;
	laag: number;
} {
	let hoog = 0,
		midden = 0,
		laag = 0;
	for (const f of findings) {
		if (f.severity === 'critical' || f.severity === 'high') hoog++;
		else if (f.severity === 'medium') midden++;
		else laag++;
	}
	return { hoog, midden, laag };
}

/**
 * Generates a plain-language explanation of detected trackers for non-technical readers.
 * @param data - Browser data collected during scan
 * @returns HTML list items explaining each tracker, or empty string if none found
 */
export function explainTrackers(data: BrowserData): string {
	const trackerInfo: Record<string, string> = {
		'google-analytics.com':
			"Google Analytics volgt het surfgedrag van elke bezoeker: welke pagina's ze bekijken, hoe lang, waar ze vandaan komen. Deze gegevens worden opgeslagen op servers van Google (VS) en kunnen worden gekoppeld aan Google-profielen van inwoners.",
		'googletagmanager.com':
			'Google Tag Manager is een hulpmiddel waarmee andere tracking-scripts worden geladen. Het opent de deur voor het plaatsen van cookies en trackers zonder dat dit altijd zichtbaar is.',
		'doubleclick.net':
			'DoubleClick is het advertentienetwerk van Google. Als dit op een gemeentewebsite draait, worden inwoners gevolgd voor gerichte advertenties — ook op andere websites.',
		'facebook.net':
			'De Facebook Pixel volgt bezoekers en koppelt hun bezoek aan hun Facebook/Instagram profiel. Facebook kan hiermee gerichte advertenties tonen op basis van gemeentelijke diensten die een inwoner heeft bekeken.',
		'hotjar.com':
			'Hotjar neemt muisbewegingen, klikken en scrollgedrag op. In feite wordt het scherm van de bezoeker "opgenomen" — inclusief ingevulde formulieren.',
		'clarity.ms':
			'Microsoft Clarity neemt sessies op: elke klik, scroll en muisbeweging van bezoekers wordt vastgelegd en naar Microsoft gestuurd.',
		'linkedin.com':
			'LinkedIn tracking koppelt websitebezoeken aan LinkedIn-profielen van inwoners.',
		'siteimproveanalytics.com':
			'Siteimprove Analytics meet websitegebruik. Hoewel Europees, vereist het nog steeds toestemming als het niet strikt noodzakelijk is.',
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

/**
 * Generates an executive summary using Mistral AI for non-technical stakeholders.
 * Returns null if MISTRAL_API_KEY is not set or if the API call fails.
 * @param result - Full scan result
 * @returns Executive summary text or null
 */
export async function generateExecutiveSummary(result: ScanResult): Promise<string | null> {
	if (!process.env.MISTRAL_API_KEY) {
		console.log('  Mistral API key niet gevonden — bestuurders-samenvatting overgeslagen');
		return null;
	}

	const allFindings = Object.entries(result.categories).flatMap(([cat, r]) =>
		r.findings.map(
			(f) => `[${cat.toUpperCase()}] ${f.severity.toUpperCase()}: ${f.title} — ${f.description}`,
		),
	);

	const criticalCount = allFindings.filter((f) => f.includes('CRITICAL:')).length;
	const hoogCount = allFindings.filter((f) => f.includes('HIGH:')).length;
	const middenCount = allFindings.filter((f) => f.includes('MEDIUM:')).length;
	const laagCount = allFindings.filter((f) => f.includes('LOW:')).length;
	const highFindings = allFindings.filter((f) => f.includes('CRITICAL:') || f.includes('HIGH:'));
	const otherFindings = allFindings.filter((f) => !f.includes('CRITICAL:') && !f.includes('HIGH:'));

	const systemPrompt = `Je bent een communicatieadviseur voor Nederlandse gemeenten. Je schrijft heldere, begrijpelijke samenvattingen voor bestuurders (wethouders, gemeentesecretarissen, directeuren) die geen technische achtergrond hebben.

Regels:
- Schrijf in platte tekst. GEEN markdown, GEEN sterretjes, GEEN opsommingstekens, GEEN kopjes.
- Gewone lopende zinnen en alinea's.
- Gebruik geen jargon, geen afkortingen, geen Engelse termen. Als een technische term onvermijdelijk is, leg deze dan in dezelfde zin heel kort uit tussen haakjes, bijvoorbeeld "clickjacking (het onzichtbaar plaatsen van knoppen over een website zodat bezoekers onbedoeld ergens op klikken)".
- Schrijf UITSLUITEND over de bevindingen die je krijgt aangeleverd. Verzin geen extra informatie.
- Geef GEEN scores of punten. Geen "79 van de 100" of vergelijkbare beoordelingen.
- Iedere website heeft aandachtspunten — dat is normaal en verandert in de loop van de tijd. Stel de lezer gerust maar wees eerlijk over wat aandacht nodig heeft.
- Besteed de meeste aandacht aan hoge en kritieke risico's. De overige bevindingen vat je kort samen als risico-inventarisatie.
- Als er externe diensten van Amerikaanse bedrijven worden gebruikt (Google Analytics, Google Tag Manager, Google Fonts, Cloudflare, Facebook, Microsoft Clarity, etc.), benoem dit dan expliciet. Leg uit dat gegevens van inwoners daarmee naar servers buiten de EU worden gestuurd, wat onder de AVG een risico is.
- Negeer eventuele HTML of tracker-uitleg in de bevindingen — vat alleen de kern samen.
- Maximaal 250 woorden.`;

	const aantalIntro = [
		criticalCount > 0 ? `${criticalCount} kritiek` : '',
		hoogCount > 0 ? `${hoogCount} hoog-risico` : '',
		`${middenCount} midden-risico`,
		`${laagCount} laag-risico`,
	]
		.filter(Boolean)
		.join(', ');

	const userMessage = `Schrijf een bestuurderssamenvatting voor het scanrapport van de gemeentewebsite ${result.targetUrl}.

Begin met deze context: "Bij deze scan zijn ${aantalIntro} bevindingen vastgesteld. Iedere website heeft aandachtspunten — dat is normaal en verandert in de loop van de tijd. Hieronder leggen wij uit wat er is gevonden en wat uw aandacht verdient."

Structuur daarna:
1. Wat gaat goed (max 2 zinnen, stel de lezer gerust)
2. Hoge en kritieke risico's — beschrijf per stuk concreet wat het risico is voor de gemeente en haar inwoners, en wat er moet gebeuren (dit is het belangrijkste deel)
3. Korte risico-inventarisatie van de overige bevindingen (max 3 zinnen, geen opsomming, gewoon lopende tekst)

Sluit af met deze zin, letterlijk: "Deze samenvatting is opgesteld door Mistral, een Europese AI, op basis van de zuivere regel-gebaseerde scan-uitkomsten hierboven. De bevindingen zelf zijn vastgesteld zonder AI."

${
	highFindings.length > 0
		? `Hoge en kritieke bevindingen (besteed hier de meeste aandacht aan):
${highFindings.join('\n')}`
		: 'Er zijn geen hoge of kritieke bevindingen.'
}

Overige bevindingen (kort samenvatten):
${otherFindings.join('\n')}`;

	try {
		const resp = await fetch(`${MISTRAL_BASE_URL}/v1/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
			},
			body: JSON.stringify({
				model: 'mistral-small-latest',
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage },
				],
				max_tokens: 1024,
			}),
		});

		if (!resp.ok) {
			console.log(`  Mistral API fout: ${resp.status} ${resp.statusText}`);
			return null;
		}

		const data = (await resp.json()) as {
			choices: {
				message: {
					content:
						| string
						| Array<{
								type: string;
								text?: string;
								thinking?: Array<{ type: string; text: string }>;
						  }>;
				};
			}[];
		};
		const content = data.choices?.[0]?.message?.content;
		if (!content) return null;
		if (typeof content === 'string') return content.trim();
		// Magistral reasoning model: content is array with { type: "thinking" } and { type: "text" } parts
		const textPart = content.find((p) => p.type === 'text' && p.text);
		return textPart?.text?.trim() ?? null;
	} catch (err) {
		console.log(`  Mistral niet bereikbaar: ${err}`);
		return null;
	}
}

/**
 * Generates the full HTML report for a scan result.
 * @param result - Full scan result
 * @param executiveSummary - Optional AI-generated executive summary
 * @param trackerExplanation - HTML list items explaining trackers
 * @returns Complete HTML document as string
 */
export function generateHtmlReport(
	result: ScanResult,
	executiveSummary: string | null,
	trackerExplanation: string,
): string {
	const sevColor: Record<string, string> = {
		critical: '#d32f2f',
		high: '#f57c00',
		medium: '#fbc02d',
		low: '#388e3c',
		info: '#1976d2',
	};
	const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	const catNames: Record<string, string> = {
		security: 'Beveiliging',
		wcag: 'Toegankelijkheid',
		privacy: 'Privacy',
		performance: 'Snelheid',
		standards: 'Standaarden',
	};
	const catNamesTech: Record<string, string> = {
		security: 'Security Headers & Cookies',
		wcag: 'Toegankelijkheid (WCAG 2.2 AA)',
		privacy: 'Privacy & AVG',
		performance: 'Performance & Resources',
		standards: 'Overheidsstandaarden',
	};

	const totals = countSeverities(Object.values(result.categories).flatMap((c) => c.findings));
	const totalCount = totals.hoog + totals.midden + totals.laag;

	function mdToHtml(text: string): string {
		return text
			.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.*?)\*/g, '<em>$1</em>')
			.replace(/^#{1,3}\s+(.*)$/gm, '<strong>$1</strong>')
			.replace(/^[-*]\s+(.*)$/gm, '$1')
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.length > 0)
			.map((l) => `<p style="margin:0.5rem 0">${l}</p>`)
			.join('');
	}

	const aiSection = executiveSummary
		? `
		<section style="margin:2rem 0;padding:1.5rem;background:#fff3e0;border:2px solid #f57c00;border-radius:8px">
			<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
				<span style="background:#f57c00;color:#fff;padding:3px 10px;border-radius:4px;font-size:0.75rem;font-weight:700">AI-GEGENEREERD</span>
				<strong style="font-size:1.1rem">Samenvatting voor bestuurders</strong>
			</div>
			<div style="color:#333;line-height:1.8">${mdToHtml(executiveSummary)}</div>
			<p style="margin:0.75rem 0 0;font-size:0.8rem;color:#888;font-style:italic">Deze samenvatting is automatisch opgesteld door AI (Mistral) op basis van de scan-uitkomsten hieronder. De feitelijke bevindingen zijn regel-gebaseerd en onafhankelijk vastgesteld.</p>
		</section>`
		: '';

	const trackerSection = trackerExplanation
		? `
		<section style="margin:2rem 0;padding:1.5rem;background:#fce4ec;border:2px solid #d32f2f;border-radius:8px">
			<h2 style="margin:0 0 0.75rem;color:#d32f2f">Wat doen deze trackers met gegevens van uw inwoners?</h2>
			<p style="margin:0 0 1rem;color:#333">Op uw website zijn diensten gevonden die gegevens van bezoekers verzamelen en doorsturen naar externe bedrijven. Hieronder staat per dienst wat er precies gebeurt:</p>
			<ul style="margin:0;padding-left:1.25rem;color:#333">${trackerExplanation}</ul>
			<p style="margin:1rem 0 0;color:#333"><strong>Waarom is dit een probleem?</strong> Volgens de AVG en de Telecommunicatiewet mag dit alleen als bezoekers hier vooraf actief toestemming voor geven.</p>
		</section>`
		: '';

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

<!-- Page 1: Results -->

<header style="margin-bottom:1.5rem">
	<h1>Rapport scan gemeentewebsite ${domain}</h1>
	<p style="color:#888;font-size:0.9rem">Gescand op ${new Date(result.scannedAt).toLocaleString('nl-NL')} | ${totalCount} bevindingen</p>
</header>

<section style="background:#e8f5e9;border:2px solid #2e7d32;border-radius:8px;padding:1rem;margin-bottom:1.5rem">
	<p style="margin:0;font-size:0.9rem;color:#1b5e20"><strong>Dit is een gratis en onafhankelijke scan.</strong> Site Guardian is open source (EUPL-1.2) en vraagt geen geld voor rapporten. Elke gemeente verdient inzicht in de digitale veiligheid en privacy van haar website — zonder factuur.</p>
</section>

<!-- Summary table: totals -->
<h2>Overzicht</h2>
<table>
	<thead><tr><th>Ernst</th><th style="text-align:center">Aantal</th><th>Betekenis</th></tr></thead>
	<tbody>
		<tr${totals.hoog > 0 ? ' style="background:#ffebee"' : ''}><td><span class="badge b-hoog">HOOG</span></td><td style="text-align:center"><strong>${totals.hoog}</strong></td><td>Directe risico's voor privacy of veiligheid van inwoners. Zo snel mogelijk oplossen.</td></tr>
		<tr${totals.midden > 0 ? ' style="background:#fff8e1"' : ''}><td><span class="badge b-midden">MIDDEN</span></td><td style="text-align:center"><strong>${totals.midden}</strong></td><td>Verbeterpunten die de website veiliger en toegankelijker maken. Plan deze in.</td></tr>
		<tr><td><span class="badge b-laag">LAAG</span></td><td style="text-align:center"><strong>${totals.laag}</strong></td><td>Kleine verbeteringen. Neem mee bij regulier onderhoud.</td></tr>
	</tbody>
</table>

<!-- Summary table: per category -->
<table style="margin-top:0.5rem">
	<thead><tr><th>Onderdeel</th><th style="text-align:center">Hoog</th><th style="text-align:center">Midden</th><th style="text-align:center">Laag</th></tr></thead>
	<tbody>
		${Object.entries(result.categories)
			.map(([key, cat]) => {
				const c = countSeverities(cat.findings);
				return `<tr><td>${catNames[key]}</td><td style="text-align:center;${c.hoog > 0 ? 'color:#d32f2f;font-weight:700' : 'color:#888'}">${c.hoog}</td><td style="text-align:center;${c.midden > 0 ? 'color:#e65100;font-weight:700' : 'color:#888'}">${c.midden}</td><td style="text-align:center;color:#888">${c.laag}</td></tr>`;
			})
			.join('')}
	</tbody>
</table>

${aiSection}

${trackerSection}

<!-- Technical details per category -->
<h2 style="margin-top:2rem">Bevindingen per onderdeel</h2>
<p style="color:#666;font-size:0.9rem;margin-bottom:1rem">Vastgesteld door geautomatiseerde, regel-gebaseerde controles (geen AI). Gesorteerd van hoog naar laag.</p>

${Object.entries(result.categories)
	.map(([key, cat]) => {
		const c = countSeverities(cat.findings);
		const sorted = [...cat.findings].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
		const summaryBadges = [
			c.hoog > 0 ? `<span class="badge b-hoog">${c.hoog} hoog</span>` : '',
			c.midden > 0 ? `<span class="badge b-midden">${c.midden} midden</span>` : '',
			c.laag > 0 ? `<span class="badge b-laag">${c.laag} laag</span>` : '',
		]
			.filter(Boolean)
			.join(' ');

		return `
<details${c.hoog > 0 ? ' open' : ''}>
	<summary>${catNamesTech[key]} ${summaryBadges || '<span style="color:#388e3c;font-size:0.85rem">Geen bevindingen</span>'}</summary>
	<div style="padding:0.5rem 1rem 1rem">
		${
			sorted.length > 0
				? sorted
						.map(
							(f) => `
		<div style="border-left:4px solid ${sevColor[f.severity]};padding:0.5rem 0.75rem;margin:0.5rem 0;background:#f9f9f9;border-radius:0 4px 4px 0">
			<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem">
				<span class="badge" style="background:${sevColor[f.severity]};color:${f.severity === 'medium' ? '#1a1a2e' : '#fff'};font-size:0.7rem">${f.severity === 'critical' || f.severity === 'high' ? 'HOOG' : f.severity === 'medium' ? 'MIDDEN' : 'LAAG'}</span>
				<strong style="font-size:0.95rem">${f.title}</strong>
			</div>
			<p style="margin:0.25rem 0;color:#333;font-size:0.9rem">${f.description}</p>
			${f.location ? `<p style="margin:0.25rem 0;font-family:monospace;font-size:0.8rem;color:#666">${f.location}</p>` : ''}
			<p style="margin:0.25rem 0;color:#154273;font-size:0.9rem">${f.recommendation}</p>
			${f.reference ? `<p style="margin:0.25rem 0;font-size:0.75rem;color:#888">${f.reference}</p>` : ''}
		</div>`,
						)
						.join('')
				: '<p style="color:#388e3c">Geen bevindingen</p>'
		}
		${cat.recommendations.length > 0 ? `<div style="margin-top:0.75rem;padding:0.75rem;background:#e8f0fe;border-radius:4px;font-size:0.9rem"><strong>Aanbevelingen:</strong><ul style="margin:0.5rem 0 0 1.25rem">${cat.recommendations.map((r) => `<li>${r}</li>`).join('')}</ul></div>` : ''}
	</div>
</details>`;
	})
	.join('')}

<!-- Page 2: What we scan and why -->

<section class="page-break">
<h1>Wat scannen wij en waarom</h1>
<p style="color:#666;margin-bottom:1.5rem">Site Guardian controleert gemeentewebsites op vijf onderdelen. Hieronder leggen we per onderdeel uit waarom het belangrijk is.</p>

<h2 style="color:#154273">Beveiliging</h2>
<p>Gemeentewebsites verwerken persoonsgegevens van inwoners. Zonder goede beveiliging kunnen kwaadwillenden gegevens onderscheppen, de website misbruiken voor phishing, of bezoekers omleiden naar schadelijke pagina's. Wij controleren beveiligingsheaders, cookie-instellingen, HTTPS-configuratie en of de website technische details lekt die aanvallers kunnen misbruiken.</p>

<h2 style="color:#154273">Toegankelijkheid</h2>
<p>Nederlandse overheidswebsites zijn wettelijk verplicht om toegankelijk te zijn voor iedereen, inclusief mensen met een visuele, auditieve of motorische beperking (Besluit digitale toegankelijkheid overheid, WCAG 2.2 AA). Wij controleren taalinstelling, koppenstructuur, alternatieve tekst bij afbeeldingen, formulierlabels, toetsenbordnavigatie en zoombeperking.</p>

<h2 style="color:#154273">Privacy</h2>
<p>Gemeenten hebben een bijzondere verantwoordelijkheid richting hun inwoners. Inwoners moeten erop kunnen vertrouwen dat hun bezoek aan de gemeentewebsite niet wordt gevolgd door commerciele partijen. Wij controleren of er tracking-diensten actief zijn, of er een correct toestemmingsmechanisme is, hoeveel externe partijen gegevens ontvangen, en of er een privacyverklaring vindbaar is.</p>

<h2 style="color:#154273">Snelheid</h2>
<p>Een trage website is niet alleen vervelend, maar ook een toegankelijkheidsprobleem. Inwoners met een langzame internetverbinding of ouder apparaat worden buitengesloten. Wij controleren het aantal HTTP-verzoeken, externe afhankelijkheden, render-blocking scripts, compressie en caching.</p>

<h2 style="color:#154273">Overheidsstandaarden</h2>
<p>Nederlandse gemeenten moeten voldoen aan de verplichte standaarden van het Forum Standaardisatie. Dit borgt dat overheidswebsites betrouwbaar, vindbaar en interoperabel zijn. Wij controleren HTTPS, de aanwezigheid van een toegankelijkheidsverklaring, responsief ontwerp en correcte metadata.</p>

<h2 style="margin-top:2rem">Over dit rapport</h2>
<p>De technische bevindingen zijn vastgesteld door geautomatiseerde, regel-gebaseerde controles. Er wordt geen AI gebruikt voor de bevindingen zelf.${executiveSummary ? ' De bestuurders-samenvatting is opgesteld door AI (Mistral) en is in het rapport duidelijk als zodanig gemarkeerd.' : ''}</p>
<p>Site Guardian is open source (EUPL-1.2), volledig gratis, en heeft geen commercieel belang. Voor het scannen van broncode en repositories: <a href="https://gitguardian.publicvibes.nl">gitguardian.publicvibes.nl</a></p>

<hr style="border:none;border-top:1px solid #ddd;margin:2rem 0 1rem">
<p style="text-align:center;color:#888;font-size:0.85rem">Dit rapport is gratis ter beschikking gesteld vanuit <a href="https://publicvibes.nl">publicvibes.nl</a>, een open source initiatief van Ralph Wagter.</p>
</section>

</body>
</html>`;
}
