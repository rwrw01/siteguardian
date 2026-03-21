import { createTransport } from 'nodemailer';

import { readSecret } from '@/lib/secrets';

let transporter: ReturnType<typeof createTransport> | null = null;

function getTransporter() {
	if (!transporter) {
		const host = '89.167.107.143';
		const port = 465;
		const user = readSecret('smtp_username', 'SMTP_USERNAME');
		const pass = readSecret('smtp_password', 'SMTP_PASSWORD');

		transporter = createTransport({
			host,
			port,
			secure: true,
			auth: { user, pass },
			tls: {
				// Mox's cert is for mail.publicvibes.nl, maar we verbinden via IP
				// In productie: gebruik de hostname als de DNS klopt
				servername: 'mail.publicvibes.nl',
			},
		});
	}
	return transporter;
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
		await getTransporter().sendMail({
			from: 'Site Guardian <info@publicvibes.nl>',
			to,
			subject: `Bevestig uw scan van ${domain}`,
			html,
		});
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
	name: string,
	subject: string,
	filename: string,
	pdfBuffer: Buffer,
): Promise<{ success: boolean; error?: string }> {
	const html = `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;max-width:520px;margin:0 auto;padding:32px;line-height:1.7">

<h2 style="font-size:20px;margin-bottom:4px">Uw Site Guardian rapport</h2>

<p>Beste ${name},</p>

<p>U heeft een scan aangevraagd over mogelijke aandachtspunten van uw website. In de bijlage vindt u het rapport als PDF met bevindingen op het gebied van beveiliging, toegankelijkheid, privacy, snelheid en overheidsstandaarden.</p>

<p>Heeft u deze scan niet aangevraagd? Dan kunt u deze e-mail negeren.</p>

<p style="color:#888;font-size:13px;margin-top:24px">Deze scan is gratis en wordt aangeboden door <a href="https://publicvibes.nl" style="color:#154273">Public Vibes</a>, een open initiatief van Ralph Wagter om ervoor te zorgen dat publiek Nederland een stukje digitaal veiliger wordt. Meer informatie vindt u op <a href="https://publicvibes.nl" style="color:#154273">publicvibes.nl</a>.</p>

</body>
</html>`;

	try {
		await getTransporter().sendMail({
			from: 'Site Guardian <info@publicvibes.nl>',
			to,
			subject,
			html,
			attachments: [
				{
					filename,
					content: pdfBuffer,
					contentType: 'application/pdf',
				},
			],
		});
		console.log(`[email] Rapport (PDF) verstuurd naar ${to}`);
		return { success: true };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Onbekende fout';
		console.error('[email] Send failed:', message);
		return { success: false, error: message };
	}
}
