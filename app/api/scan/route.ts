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

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, no personal data stored)
// ---------------------------------------------------------------------------

// Track by IP: max 3 scans per hour
const ipRequests = new Map<string, number[]>();
// Track by domain: max 2 scans per hour per target domain
const domainRequests = new Map<string, number[]>();

const MAX_PER_IP = 3;
const MAX_PER_DOMAIN = 2;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(key: string, store: Map<string, number[]>, max: number): boolean {
	const now = Date.now();
	const timestamps = (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
	if (timestamps.length >= max) return true;
	timestamps.push(now);
	store.set(key, timestamps);
	return false;
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
	const now = Date.now();
	for (const [key, timestamps] of ipRequests) {
		const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
		if (fresh.length === 0) ipRequests.delete(key);
		else ipRequests.set(key, fresh);
	}
	for (const [key, timestamps] of domainRequests) {
		const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
		if (fresh.length === 0) domainRequests.delete(key);
		else domainRequests.set(key, fresh);
	}
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

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
	// Honeypot: invisible field, must be empty
	website: z.string().max(0).optional(),
});

// ---------------------------------------------------------------------------
// Background scan runner (fire-and-forget)
// ---------------------------------------------------------------------------

function runScanInBackground(
	name: string,
	email: string,
	targetUrl: string,
	includeSummary: boolean,
) {
	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

	// Run async, don't await
	(async () => {
		try {
			console.log(`[scan] Start: ${domain} voor ${email.split('@')[1]}`);

			const { result, browserData } = await scanWebsite(targetUrl);
			const trackerContext = explainTrackersPlaintext(browserData);
			const summary = includeSummary ? await generateExecutiveSummary(result, trackerContext) : null;
			const trackerHtml = explainTrackers(browserData);
			const htmlReport = generateHtmlReport(result, summary, trackerHtml);

			const pdfBuffer = await renderPdf(htmlReport);

			const allFindings = Object.values(result.categories).flatMap((c) => c.findings);
			let hoog = 0, midden = 0, laag = 0;
			for (const f of allFindings) {
				if (f.severity === 'critical' || f.severity === 'high') hoog++;
				else if (f.severity === 'medium') midden++;
				else laag++;
			}

			const subject = `Site Guardian rapport: ${domain} — ${hoog} hoog, ${midden} midden, ${laag} laag`;
			const filename = `siteguardian-${domain}-${new Date().toISOString().slice(0, 10)}.pdf`;

			const emailResult = await sendScanReport(email, name, subject, filename, pdfBuffer);
			if (emailResult.success) {
				console.log(`[scan] Klaar: ${domain} → ${email.split('@')[1]} (${allFindings.length} bevindingen)`);
			} else {
				console.error(`[scan] Email mislukt voor ${domain}: ${emailResult.error}`);
			}
		} catch (err) {
			console.error(`[scan] Mislukt voor ${domain}:`, err);
		}
	})();
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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

	// Determine public base URL (behind Traefik, request.url is internal)
	const proto = request.headers.get('x-forwarded-proto') ?? 'https';
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'siteguardian.publicvibes.nl';
	const baseUrl = `${proto}://${host}`;

	const parsed = scanRequestSchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.redirect(new URL('/?error=validation', baseUrl));
	}

	const { name, email, targetUrl, includeSummary } = parsed.data;

	// Honeypot check — bots fill in the hidden "website" field
	if (parsed.data.website) {
		const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
		return NextResponse.redirect(
			new URL(`/?status=scan_complete&domain=${encodeURIComponent(domain)}&email=${encodeURIComponent(email)}`, baseUrl),
		);
	}

	// Domain authorization check
	const authResult = authorizeScan(email, targetUrl);
	if (!authResult.allowed) {
		return NextResponse.redirect(
			new URL(`/?error=unauthorized`, baseUrl),
		);
	}

	// Rate limiting by IP
	const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
		?? request.headers.get('x-real-ip')
		?? 'unknown';
	if (isRateLimited(ip, ipRequests, MAX_PER_IP)) {
		return NextResponse.redirect(new URL('/?error=rate_limit', baseUrl));
	}

	// Rate limiting by target domain
	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
	if (isRateLimited(domain, domainRequests, MAX_PER_DOMAIN)) {
		return NextResponse.redirect(
			new URL(`/?error=rate_limit&domain=${encodeURIComponent(domain)}`, baseUrl),
		);
	}

	// Fire scan in background, respond immediately
	runScanInBackground(name, email, targetUrl, includeSummary);

	return NextResponse.redirect(
		new URL(
			`/?status=scan_complete&domain=${encodeURIComponent(domain)}&email=${encodeURIComponent(email)}`,
			baseUrl,
		),
	);
}
