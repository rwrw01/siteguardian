import { Resend } from 'resend';

import { readSecret } from '@/lib/secrets';

let resendClient: Resend | null = null;

function getResend(): Resend {
	if (!resendClient) {
		const apiKey = readSecret('resend_api_key', 'RESEND_API_KEY');
		if (!apiKey) {
			throw new Error('RESEND_API_KEY niet geconfigureerd');
		}
		resendClient = new Resend(apiKey);
	}
	return resendClient;
}

function getSenderEmail(): string {
	return readSecret('scan_email_from', 'SCAN_EMAIL_FROM') || 'scan@publicvibes.nl';
}

export async function sendScanReport(
	to: string,
	subject: string,
	htmlContent: string,
): Promise<{ success: boolean; error?: string }> {
	try {
		const resend = getResend();
		const { error } = await resend.emails.send({
			from: `Site Guardian <${getSenderEmail()}>`,
			to: [to],
			subject,
			html: htmlContent,
		});

		if (error) {
			console.error('[email] Resend error:', JSON.stringify(error));
			return { success: false, error: error.message };
		}

		console.log(`[email] Rapport verstuurd naar ${to}`);
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Onbekende fout';
		console.error('[email] Send failed:', message);
		return { success: false, error: message };
	}
}

export async function sendMagicLink(
	to: string,
	loginUrl: string,
): Promise<{ success: boolean; error?: string }> {
	const html = `
		<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px">
			<h2 style="color:#1a1a2e;margin-bottom:16px">Inloggen bij Site Guardian</h2>
			<p style="color:#333;line-height:1.6;margin-bottom:24px">
				Klik op de knop hieronder om in te loggen. Deze link is 10 minuten geldig en kan maar één keer gebruikt worden.
			</p>
			<a href="${loginUrl}" style="display:inline-block;padding:12px 32px;background:#2ea043;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">
				Inloggen
			</a>
			<p style="color:#6b7280;font-size:13px;margin-top:24px;line-height:1.5">
				Als u deze aanvraag niet heeft gedaan, kunt u deze e-mail negeren.
				De link verloopt automatisch na 10 minuten.
			</p>
		</div>`;

	try {
		const resend = getResend();
		const { error } = await resend.emails.send({
			from: `Site Guardian <${getSenderEmail()}>`,
			to: [to],
			subject: 'Inloggen bij Site Guardian',
			html,
		});

		if (error) {
			console.error('[email] Magic link send error:', JSON.stringify(error));
			return { success: false, error: error.message };
		}

		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Onbekende fout';
		return { success: false, error: message };
	}
}
