import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { authorizeScan } from '@/process/scan-authorization';
import {
	explainTrackers,
	explainTrackersPlaintext,
	generateExecutiveSummary,
	generateHtmlReport,
	scanWebsite,
} from '@/service/web-scanner';

const scanRequestSchema = z.object({
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

	const { email, targetUrl, includeSummary } = parsed.data;

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
		const { result, browserData } = await scanWebsite(targetUrl);
		const trackerContext = explainTrackersPlaintext(browserData);
		const summary = includeSummary ? await generateExecutiveSummary(result, trackerContext) : null;
		const trackerHtml = explainTrackers(browserData);
		const htmlReport = generateHtmlReport(result, summary, trackerHtml);

		const filename = `siteguardian-${domain}-${new Date().toISOString().slice(0, 10)}.html`;

		return new NextResponse(htmlReport, {
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}"`,
			},
		});
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
