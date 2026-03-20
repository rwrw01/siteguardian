import { Resend } from 'resend';

import { readSecret } from '@/lib/secrets';

let resendClient: Resend | null = null;

function getResend(): Resend {
	if (!resendClient) {
		const apiKey = readSecret('resend_api_key', 'RESEND_API_KEY');
		if (!apiKey) throw new Error('RESEND_API_KEY niet geconfigureerd');
		resendClient = new Resend(apiKey);
	}
	return resendClient;
}

function getSenderEmail(): string {
	return readSecret('scan_email_from', 'SCAN_EMAIL_FROM') || 'scan@publicvibes.nl';
}

export async function sendScanConfirmation(
	to: string,
	domain: string,
	confirmUrl: string,
): Promise<{ success: boolean; error?: string }> {
	const html = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;max-width:520px;margin:0 auto;padding:32px;line-height:1.7">

<h2 style="font-size:20px;margin-bottom:4px">Bevestig uw scan van ${domain}</h2>
<p style="color:#888;font-size:14px;margin-bottom:20px">Site Guardian — gratis website compliance scanner</p>

<p>U heeft een scan aangevraagd van <strong>${domain}</strong>. Klik op onderstaande knop om de scan te starten. Hiermee bevestigt u dat u gemachtigd bent om deze website te laten scannen.</p>

<div style="text-align:center;margin:28px 0">
	<a href="${confirmUrl}" style="display:inline-block;padding:14px 36px;background:#2ea043;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">Scan starten</a>
</div>

<p>Na afloop ontvangt u het rapport op dit e-mailadres.</p>

<p style="color:#888;font-size:13px;margin-top:24px">Deze link is 7 dagen geldig en kan maar één keer gebruikt worden. Niet aangevraagd? U kunt deze e-mail negeren.</p>

<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<p style="font-size:12px;color:#888;text-align:center">Gratis ter beschikking gesteld vanuit <a href="https://publicvibes.nl" style="color:#888">publicvibes.nl</a>, een open source initiatief van Ralph Wagter.</p>

</body>
</html>`;

	try {
		const resend = getResend();
		const { error } = await resend.emails.send({
			from: `Site Guardian <${getSenderEmail()}>`,
			to: [to],
			subject: `Bevestig uw scan van ${domain}`,
			html,
		});

		if (error) {
			console.error('[email] Resend error:', JSON.stringify(error));
			return { success: false, error: error.message };
		}

		console.log(`[email] Bevestigingsmail verstuurd naar ${to} voor ${domain}`);
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Onbekende fout';
		console.error('[email] Send failed:', message);
		return { success: false, error: message };
	}
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
