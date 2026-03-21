import { type NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { verifyScanToken } from '@/process/auth';
import { authorizeScan } from '@/process/scan-authorization';
import { scanWebsite } from '@/service/web-scanner';
// Email disabled — report is served as direct download

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
		return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(result.error ?? 'invalid')}`, request.url));
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
		const scanResult = await scanWebsite(targetUrl);
		const htmlReport = buildEmailReport(scanResult);
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
		return NextResponse.redirect(new URL(`/?error=scan_failed&domain=${encodeURIComponent(domain)}`, request.url));
	}
}

function buildEmailReport(result: { targetUrl: string; scannedAt: string; categories: Record<string, { findings: { title: string; description: string; severity: string; recommendation: string }[]; recommendations: string[] }>; totals: { hoog: number; midden: number; laag: number } }): string {
	const domain = new URL(result.targetUrl).hostname;
	const allFindings = Object.values(result.categories).flatMap((c) => c.findings);
	const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
	const sorted = [...allFindings].sort((a, b) => (sevOrder[a.severity] ?? 5) - (sevOrder[b.severity] ?? 5));
	const catNames: Record<string, string> = { security: 'Beveiliging', wcag: 'Toegankelijkheid', privacy: 'Privacy' };

	const findingsHtml = sorted.map((f) => {
		const label = f.severity === 'critical' || f.severity === 'high' ? 'HOOG' : f.severity === 'medium' ? 'MIDDEN' : 'LAAG';
		const color = f.severity === 'critical' || f.severity === 'high' ? '#d32f2f' : f.severity === 'medium' ? '#f57c00' : '#388e3c';
		return `<tr><td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top"><span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:700">${label}</span></td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${f.title}</strong><br><span style="color:#666;font-size:13px">${f.description}</span><br><span style="color:#154273;font-size:13px">${f.recommendation}</span></td></tr>`;
	}).join('');

	const catRows = Object.entries(result.categories).map(([key, cat]) => {
		const c = { hoog: 0, midden: 0, laag: 0 };
		for (const f of cat.findings) {
			if (f.severity === 'critical' || f.severity === 'high') c.hoog++;
			else if (f.severity === 'medium') c.midden++;
			else c.laag++;
		}
		return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${catNames[key] ?? key}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;${c.hoog > 0 ? 'color:#d32f2f;font-weight:700' : 'color:#888'}">${c.hoog}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;${c.midden > 0 ? 'color:#e65100;font-weight:700' : 'color:#888'}">${c.midden}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;color:#888">${c.laag}</td></tr>`;
	}).join('');

	return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;max-width:640px;margin:0 auto;padding:24px;line-height:1.6">

<h1 style="font-size:20px;margin-bottom:4px">Rapport scan gemeentewebsite ${domain}</h1>
<p style="color:#888;font-size:14px;margin-bottom:20px">Gescand op ${new Date(result.scannedAt).toLocaleString('nl-NL')}</p>

<table style="width:100%;border-collapse:collapse;margin-bottom:8px">
<tr><td style="padding:10px;background:#d32f2f;color:#fff;text-align:center;font-weight:700;border-radius:4px 0 0 4px;font-size:15px">${result.totals.hoog} hoog</td><td style="padding:10px;background:#fbc02d;color:#1a1a2e;text-align:center;font-weight:700;font-size:15px">${result.totals.midden} midden</td><td style="padding:10px;background:#388e3c;color:#fff;text-align:center;font-weight:700;border-radius:0 4px 4px 0;font-size:15px">${result.totals.laag} laag</td></tr>
</table>

<table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
<tr style="background:#f5f5f5"><th style="padding:6px 8px;text-align:left">Onderdeel</th><th style="padding:6px 8px;text-align:center">Hoog</th><th style="padding:6px 8px;text-align:center">Midden</th><th style="padding:6px 8px;text-align:center">Laag</th></tr>
${catRows}
</table>

<h2 style="font-size:16px;margin:20px 0 8px">Bevindingen</h2>
<table style="width:100%;border-collapse:collapse">${findingsHtml}</table>

<p style="margin-top:20px;font-size:13px;color:#666">De bevindingen zijn vastgesteld door geautomatiseerde, regel-gebaseerde controles (geen AI). Meer informatie over wat wij scannen en waarom: <a href="https://siteguardian.publicvibes.nl/uitleg" style="color:#154273">siteguardian.publicvibes.nl/uitleg</a></p>

<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<p style="font-size:12px;color:#888;text-align:center">Dit rapport is gratis ter beschikking gesteld vanuit <a href="https://publicvibes.nl" style="color:#888">publicvibes.nl</a>, een open source initiatief van Ralph Wagter.</p>

</body></html>`;
}
