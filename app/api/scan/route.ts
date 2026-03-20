import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifySession } from '@/process/auth';
import { authorizeScan } from '@/process/scan-authorization';
import { scanWebsite } from '@/service/web-scanner';
import { sendScanReport } from '@/integration/email';

const scanSchema = z.object({
	email: z.string().email().max(254),
	targetUrl: z.string().url().refine((u) => u.startsWith('https://'), 'Moet een HTTPS URL zijn'),
	includeSummary: z.preprocess((v) => v === 'on' || v === true || v === 'true', z.boolean().default(true)),
});

export async function POST(request: NextRequest) {
	// Parse form data or JSON
	let body: Record<string, unknown>;
	const contentType = request.headers.get('content-type') ?? '';
	if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
		const formData = await request.formData();
		body = Object.fromEntries(formData.entries());
	} else {
		body = await request.json();
	}

	const parsed = scanSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json(
			{ type: 'about:blank', title: 'Validatiefout', status: 400, detail: parsed.error.issues.map((i) => i.message).join('; ') },
			{ status: 400 },
		);
	}

	const { email, targetUrl, includeSummary } = parsed.data;

	// Session check (magic link)
	const session = request.cookies.get('sg_session');
	if (!session?.value) {
		return NextResponse.json(
			{ type: 'about:blank', title: 'Niet ingelogd', status: 401, detail: 'Log eerst in via de inlogpagina.' },
			{ status: 401 },
		);
	}

	const sessionResult = verifySession(session.value);
	if (!sessionResult.valid || !sessionResult.email) {
		return NextResponse.json(
			{ type: 'about:blank', title: 'Sessie verlopen', status: 401, detail: 'Uw sessie is verlopen. Log opnieuw in.' },
			{ status: 401 },
		);
	}

	// Domain authorization
	const authResult = authorizeScan(sessionResult.email, targetUrl);
	if (!authResult.allowed) {
		return NextResponse.json(
			{ type: 'about:blank', title: 'Geen toegang', status: 403, detail: authResult.reason },
			{ status: 403 },
		);
	}

	// Run scan
	try {
		const result = await scanWebsite(targetUrl);

		// Generate simple email report
		const domain = new URL(targetUrl).hostname;
		const subject = `Site Guardian rapport: ${domain} — ${result.totals.hoog} hoog, ${result.totals.midden} midden, ${result.totals.laag} laag`;

		const htmlReport = buildEmailReport(result);

		await sendScanReport(email, subject, htmlReport);

		// Redirect to success page
		return NextResponse.redirect(new URL(`/?scan=success&domain=${encodeURIComponent(domain)}`, request.url));
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Onbekende fout';
		console.error('[scan] Failed:', message);
		return NextResponse.json(
			{ type: 'about:blank', title: 'Scan mislukt', status: 500, detail: `De scan kon niet worden uitgevoerd: ${message}` },
			{ status: 500 },
		);
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
		return `<tr><td style="padding:8px;border-bottom:1px solid #eee"><span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:700">${label}</span></td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${f.title}</strong><br><span style="color:#666;font-size:13px">${f.description}</span><br><span style="color:#154273;font-size:13px">${f.recommendation}</span></td></tr>`;
	}).join('');

	return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"></head><body style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;max-width:640px;margin:0 auto;padding:20px;line-height:1.6">
<h1 style="font-size:20px;margin-bottom:4px">Rapport scan gemeentewebsite ${domain}</h1>
<p style="color:#888;font-size:14px;margin-bottom:16px">Gescand op ${new Date(result.scannedAt).toLocaleString('nl-NL')}</p>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr><td style="padding:8px;background:#d32f2f;color:#fff;text-align:center;font-weight:700;border-radius:4px 0 0 4px">${result.totals.hoog} hoog</td><td style="padding:8px;background:#fbc02d;color:#1a1a2e;text-align:center;font-weight:700">${result.totals.midden} midden</td><td style="padding:8px;background:#388e3c;color:#fff;text-align:center;font-weight:700;border-radius:0 4px 4px 0">${result.totals.laag} laag</td></tr></table>
${Object.entries(result.categories).map(([key, cat]) => {
	const c = { hoog: 0, midden: 0, laag: 0 };
	for (const f of cat.findings) { if (f.severity === 'critical' || f.severity === 'high') c.hoog++; else if (f.severity === 'medium') c.midden++; else c.laag++; }
	return `<p style="margin:4px 0;font-size:14px"><strong>${catNames[key] ?? key}:</strong> ${c.hoog} hoog, ${c.midden} midden, ${c.laag} laag</p>`;
}).join('')}
<h2 style="font-size:16px;margin:20px 0 8px">Bevindingen (gesorteerd van hoog naar laag)</h2>
<table style="width:100%;border-collapse:collapse">${findingsHtml}</table>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:12px;color:#888;text-align:center">Dit rapport is gratis ter beschikking gesteld vanuit <a href="https://publicvibes.nl" style="color:#888">publicvibes.nl</a>, een open source initiatief van Ralph Wagter.<br>Site Guardian is open source (EUPL-1.2) | <a href="https://siteguardian.publicvibes.nl/uitleg" style="color:#888">Wat scannen wij en waarom</a></p>
</body></html>`;
}
