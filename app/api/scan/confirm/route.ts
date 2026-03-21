import { createHash } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';

import { verifyScanToken } from '@/process/auth';
import { authorizeScan } from '@/process/scan-authorization';
import {
	explainTrackers,
	generateExecutiveSummary,
	generateHtmlReport,
	scanWebsite,
} from '@/service/web-scanner';

// One-time use tracking (in production, use database)
const usedTokens = new Set<string>();

export async function GET(request: NextRequest) {
	const token = request.nextUrl.searchParams.get('token');

	if (!token) {
		return NextResponse.redirect(new URL('/?error=missing_token', request.url));
	}

	// One-time use check
	const tokenHash = createHash('sha256').update(token).digest('hex');
	if (usedTokens.has(tokenHash)) {
		return NextResponse.redirect(new URL('/?error=token_used', request.url));
	}

	// Verify token
	const result = verifyScanToken(token);
	if (!result.valid || !result.payload) {
		return NextResponse.redirect(
			new URL(`/?error=${encodeURIComponent(result.error ?? 'invalid')}`, request.url),
		);
	}

	const { email, targetUrl, includeSummary } = result.payload;

	// Domain authorization (double check)
	const authResult = authorizeScan(email, targetUrl);
	if (!authResult.allowed) {
		return NextResponse.redirect(new URL('/?error=unauthorized', request.url));
	}

	// Mark token as used
	usedTokens.add(tokenHash);
	setTimeout(() => usedTokens.delete(tokenHash), 7 * 24 * 60 * 60 * 1000);

	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

	// Run scan
	try {
		const { result: scanResult, browserData } = await scanWebsite(targetUrl);
		const summary = includeSummary ? await generateExecutiveSummary(scanResult) : null;
		const trackerHtml = explainTrackers(browserData);
		const htmlReport = generateHtmlReport(scanResult, summary, trackerHtml);

		const filename = `siteguardian-${domain}-${new Date().toISOString().slice(0, 10)}.html`;

		// Return as downloadable HTML file
		return new NextResponse(htmlReport, {
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Disposition': `attachment; filename="${filename}"`,
			},
		});
	} catch (err) {
		console.error('[scan] Failed:', err);
		return NextResponse.redirect(
			new URL(`/?error=scan_failed&domain=${encodeURIComponent(domain)}`, request.url),
		);
	}
}
