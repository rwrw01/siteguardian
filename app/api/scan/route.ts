import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { generateScanToken } from '@/process/auth';
import { authorizeScan } from '@/process/scan-authorization';
import { sendScanConfirmation } from '@/integration/email';

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

	// Generate scan token (7 days, HMAC-signed, contains email + url + summary flag)
	const token = generateScanToken({ email, targetUrl, includeSummary });
	const baseUrl = process.env.NEXTAUTH_URL ?? `https://${request.headers.get('host')}`;
	const confirmUrl = `${baseUrl}/api/scan/confirm?token=${encodeURIComponent(token)}`;

	const domain = new URL(targetUrl).hostname.replace(/^www\./, '');

	// Send confirmation email
	const emailResult = await sendScanConfirmation(email, domain, confirmUrl);
	if (!emailResult.success) {
		return NextResponse.json(
			{
				type: 'about:blank',
				title: 'E-mail mislukt',
				status: 500,
				detail: `Kon bevestigingsmail niet versturen: ${emailResult.error}`,
			},
			{ status: 500 },
		);
	}

	// Redirect to confirmation page
	return NextResponse.redirect(
		new URL(
			`/?status=email_sent&domain=${encodeURIComponent(domain)}&email=${encodeURIComponent(email)}`,
			request.url,
		),
	);
}
