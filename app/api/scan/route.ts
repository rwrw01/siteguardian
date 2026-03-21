import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authorizeScan } from '@/process/scan-authorization';
import { sendScanReport } from '@/integration/email';
import {
	explainTrackers,
	explainTrackersPlaintext,
	generateExecutiveSummary,
	generateHtmlReport,
	renderPdf,
	scanWebsite,
} from '@/service/web-scanner';

const scanRequestSchema = z.object({
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

export async function POST(request: NextRequest) {
	let body: Record<string, unknown>;
	const contentType = request.headers.get('content-type') ?? '';
	if (
		contentType.includes('application/x-www-form-urlencoded') ||
		contentType.includes('multipart/form-data')
	) {
		const formData = await request.formData();
		body = Object.fromEntries(formData.entries());
	} else {
		body = await request.json();
	}

	const parsed = scanRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json(
			{
				type: 'about:blank',
				title: 'Validatiefout',
				status: 400,
				detail: parsed.error.issues.map((i) => i.message).join('; '),
			},
			{ status: 400 },
		);
	}

	const { name, email, targetUrl, includeSummary } = parsed.data;

	// Domain authorization check
	const authResult = authorizeScan(email, targetUrl);
	if (!authResult.allowed) {
		return NextResponse.json(
			{ type: 'about:blank', title: 'Geen toegang', status: 403, detail: authResult.reason },
			{ status: 403 },
		);
	}

	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

	try {
		// Run scan
		const { result, browserData } = await scanWebsite(targetUrl);
		const trackerContext = explainTrackersPlaintext(browserData);
		const summary = includeSummary ? await generateExecutiveSummary(result, trackerContext) : null;
		const trackerHtml = explainTrackers(browserData);
		const htmlReport = generateHtmlReport(result, summary, trackerHtml);

		// Render to PDF
		const pdfBuffer = await renderPdf(htmlReport);

		// Count findings for subject line
		const allFindings = Object.values(result.categories).flatMap((c) => c.findings);
		let hoog = 0, midden = 0, laag = 0;
		for (const f of allFindings) {
			if (f.severity === 'critical' || f.severity === 'high') hoog++;
			else if (f.severity === 'medium') midden++;
			else laag++;
		}

		const subject = `Site Guardian rapport: ${domain} — ${hoog} hoog, ${midden} midden, ${laag} laag`;
		const filename = `siteguardian-${domain}-${new Date().toISOString().slice(0, 10)}.pdf`;

		// Send email with PDF attachment
		const emailResult = await sendScanReport(email, name, subject, filename, pdfBuffer);
		if (!emailResult.success) {
			console.error('[scan] Email failed:', emailResult.error);
			return NextResponse.json(
				{
					type: 'about:blank',
					title: 'E-mail mislukt',
					status: 500,
					detail: `Scan is uitgevoerd maar het rapport kon niet worden verstuurd: ${emailResult.error}`,
				},
				{ status: 500 },
			);
		}

		// Redirect to success page
		return NextResponse.redirect(
			new URL(
				`/?status=scan_complete&domain=${encodeURIComponent(domain)}&email=${encodeURIComponent(email)}`,
				request.url,
			),
		);
	} catch (err) {
		console.error('[scan] Failed:', err);
		return NextResponse.json(
			{
				type: 'about:blank',
				title: 'Scan mislukt',
				status: 500,
				detail: `De scan van ${domain} is mislukt.`,
			},
			{ status: 500 },
		);
	}
}
