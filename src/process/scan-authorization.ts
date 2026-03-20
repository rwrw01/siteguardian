const SUPER_ADMIN_EMAILS = ['ralph@athide.nl'];

function extractEmailDomain(email: string): string {
	const parts = email.split('@');
	if (parts.length !== 2 || !parts[1]) {
		throw new Error('Ongeldig e-mailadres');
	}
	return parts[1].toLowerCase();
}

function extractTargetDomain(url: string): string {
	try {
		const parsed = new URL(url);

		// GitHub repos: https://github.com/org/repo — no domain match possible
		if (parsed.hostname === 'github.com') {
			const pathParts = parsed.pathname.split('/').filter(Boolean);
			// Use the org/owner name as a loose match hint, but
			// for GitHub we require the org name to contain the email domain
			// e.g. github.com/rijssen-holten/... matches @rijssen-holten.nl
			if (pathParts.length >= 1) {
				return pathParts[0].toLowerCase();
			}
			throw new Error('Ongeldige GitHub URL');
		}

		// Website URLs: strip www. prefix
		return parsed.hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		throw new Error('Ongeldige URL');
	}
}

function domainMatchesTarget(emailDomain: string, targetDomain: string): boolean {
	// Direct match: email @rijssen-holten.nl scans rijssen-holten.nl
	if (emailDomain === targetDomain) {
		return true;
	}

	// Subdomain match: email @sub.rijssen-holten.nl scans rijssen-holten.nl
	if (emailDomain.endsWith(`.${targetDomain}`)) {
		return true;
	}

	// GitHub org match: email @rijssen-holten.nl scans github.com/rijssen-holten/*
	// Compare domain without TLD against GitHub org name
	const domainWithoutTld = emailDomain.replace(/\.[^.]+$/, '');
	if (domainWithoutTld === targetDomain) {
		return true;
	}

	return false;
}

export interface AuthorizationResult {
	allowed: boolean;
	reason?: string;
}

export function authorizeScan(
	userEmail: string,
	targetUrl: string,
): AuthorizationResult {
	const email = userEmail.toLowerCase();

	// Super admin bypass
	if (SUPER_ADMIN_EMAILS.includes(email)) {
		return { allowed: true };
	}

	const emailDomain = extractEmailDomain(email);
	const targetDomain = extractTargetDomain(targetUrl);

	if (domainMatchesTarget(emailDomain, targetDomain)) {
		return { allowed: true };
	}

	return {
		allowed: false,
		reason:
			`Geen toegang: uw e-maildomein (${emailDomain}) komt niet overeen ` +
			`met het doeldomein (${targetDomain}). ` +
			`U kunt alleen websites/repositories scannen die behoren tot uw eigen organisatie.`,
	};
}
