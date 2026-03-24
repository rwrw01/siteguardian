import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { sendScanReport } from '@/integration/email';
import {
	analyzeFromBrowserData,
	explainTrackers,
	explainTrackersPlaintext,
	generateExecutiveSummary,
	generateHtmlReport,
	harToBrowserData,
	parseHar,
	renderPdf,
} from '@/service/web-scanner';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const harRequestSchema = z.object({
	name: z.string().min(1).max(200),
	email: z.string().email().max(254),
	targetUrl: z
		.string()
		.url()
		.refine((u) => u.startsWith('https://'), 'Moet een HTTPS URL zijn'),
	includeSummary: z.preprocess(
		(v) => v === 'on' || v === true || v === 'true',
		z.boolean().default(true),
	),
});

// Max HAR file size: 50 MB
const MAX_HAR_SIZE = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Background HAR scan runner
// ---------------------------------------------------------------------------

function runHarScanInBackground(
	name: string,
	email: string,
	targetUrl: string,
	includeSummary: boolean,
	harJson: unknown,
) {
	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

	(async () => {
		try {
			console.log(`[har-scan] Start: ${domain} voor ${email.split('@')[1]}`);

			const parsed = parseHar(harJson);
			if (!parsed.ok) {
				console.error(`[har-scan] Ongeldig HAR: ${parsed.error}`);
				return;
			}

			const browserData = harToBrowserData(parsed.har, targetUrl);
			const result = analyzeFromBrowserData(targetUrl, browserData);
			const trackerContext = explainTrackersPlaintext(browserData);
			const summary = includeSummary
				? await generateExecutiveSummary(result, trackerContext)
				: null;
			const trackerHtml = explainTrackers(browserData);
			const htmlReport = generateHtmlReport(result, summary, trackerHtml);

			const pdfBuffer = await renderPdf(htmlReport);

			const allFindings = Object.values(result.categories).flatMap((c) => c.findings);
			let hoog = 0;
			let midden = 0;
			let laag = 0;
			for (const f of allFindings) {
				if (f.severity === 'critical' || f.severity === 'high') hoog++;
				else if (f.severity === 'medium') midden++;
				else laag++;
			}

			const subject = `Site Guardian rapport (HAR): ${domain} — ${hoog} hoog, ${midden} midden, ${laag} laag`;
			const filename = `siteguardian-${domain}-${new Date().toISOString().slice(0, 10)}.pdf`;

			const emailResult = await sendScanReport(email, name, subject, filename, pdfBuffer);
			if (emailResult.success) {
				console.log(
					`[har-scan] Klaar: ${domain} → ${email.split('@')[1]} (${allFindings.length} bevindingen)`,
				);
			} else {
				console.error(`[har-scan] Email mislukt voor ${domain}: ${emailResult.error}`);
			}
		} catch (err) {
			console.error(`[har-scan] Mislukt voor ${domain}:`, err);
		}
	})();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.includes('multipart/form-data')) {
		return NextResponse.json(
			{ error: 'Gebruik multipart/form-data met een HAR bestand' },
			{ status: 400 },
		);
	}

	const proto = request.headers.get('x-forwarded-proto') ?? 'https';
	const host =
		request.headers.get('x-forwarded-host') ??
		request.headers.get('host') ??
		'siteguardian.publicvibes.nl';
	const baseUrl = `${proto}://${host}`;

	const formData = await request.formData();
	const fields = Object.fromEntries(
		[...formData.entries()].filter(([, v]) => typeof v === 'string'),
	);

	const parsed = harRequestSchema.safeParse(fields);
	if (!parsed.success) {
		return NextResponse.redirect(new URL('/?error=validation', baseUrl));
	}

	const harFile = formData.get('harFile');
	if (!harFile || !(harFile instanceof File)) {
		return NextResponse.redirect(new URL('/?error=validation', baseUrl));
	}

	if (harFile.size > MAX_HAR_SIZE) {
		return NextResponse.redirect(new URL('/?error=har_too_large', baseUrl));
	}

	let harJson: unknown;
	try {
		const text = await harFile.text();
		harJson = JSON.parse(text);
	} catch {
		return NextResponse.redirect(new URL('/?error=har_invalid', baseUrl));
	}

	const { name, email, targetUrl, includeSummary } = parsed.data;
	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

	runHarScanInBackground(name, email, targetUrl, includeSummary, harJson);

	return NextResponse.redirect(
		new URL(
			`/?status=scan_complete&domain=${encodeURIComponent(domain)}&email=${encodeURIComponent(email)}`,
			baseUrl,
		),
	);
}
