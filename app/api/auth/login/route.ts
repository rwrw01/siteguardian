import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { generateMagicToken } from '@/process/auth';
import { sendMagicLink } from '@/integration/email';

const loginSchema = z.object({
	email: z.string().email().max(254),
});

export async function POST(request: NextRequest) {
	const body = await request.json();
	const parsed = loginSchema.safeParse(body);

	if (!parsed.success) {
		return NextResponse.json(
			{ type: 'about:blank', title: 'Validatiefout', status: 400, detail: 'Ongeldig e-mailadres.' },
			{ status: 400 },
		);
	}

	const { email } = parsed.data;

	// Always return 200 to prevent email enumeration
	const token = generateMagicToken(email);
	const baseUrl = process.env.NEXTAUTH_URL ?? `https://${request.headers.get('host')}`;
	const loginUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

	await sendMagicLink(email, loginUrl);

	return NextResponse.json({ message: 'Als dit e-mailadres bij ons bekend is, ontvangt u een inloglink.' });
}
