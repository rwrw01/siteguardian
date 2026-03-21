// Standalone CLI wrapper for the Site Guardian scanner.
// All scan logic lives in src/service/web-scanner.ts — this script
// handles CLI arguments, .env loading, and file output only.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	explainTrackers,
	generateExecutiveSummary,
	generateHtmlReport,
	scanWebsite,
} from '../src/service/web-scanner';

const args = process.argv.slice(2);
const INCLUDE_SUMMARY = !args.includes('--no-summary');
const TARGET_URL = args.find((a) => !a.startsWith('--')) ?? 'https://www.rijssen-holten.nl';
const OUTPUT_DIR = resolve(import.meta.dirname ?? '.', '..', 'scan-results');

async function main() {
	console.log('=== Site Guardian — Standalone Scan ===');
	console.log(`Target: ${TARGET_URL}\n`);

	// Load .env if present
	try {
		const { readFileSync } = await import('node:fs');
		const envFile = readFileSync(resolve(import.meta.dirname ?? '.', '..', '.env'), 'utf-8');
		for (const line of envFile.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIdx = trimmed.indexOf('=');
			if (eqIdx > 0) {
				const key = trimmed.slice(0, eqIdx).trim();
				const val = trimmed.slice(eqIdx + 1).trim();
				if (!process.env[key]) process.env[key] = val;
			}
		}
	} catch {
		/* no .env file, that's fine */
	}

	const { result, browserData } = await scanWebsite(TARGET_URL);

	// Mistral executive summary (optional, only when requested)
	let executiveSummary: string | null = null;
	if (INCLUDE_SUMMARY) {
		const mistralKey = process.env.MISTRAL_API_KEY ?? '';
		if (mistralKey) {
			console.log('\nBestuurders-samenvatting genereren via Mistral...');
			executiveSummary = await generateExecutiveSummary(result);
			if (executiveSummary) console.log('  Samenvatting ontvangen');
		} else {
			console.log('\nBestuurders-samenvatting: geen API key, overgeslagen');
		}
	} else {
		console.log('\nBestuurders-samenvatting: uitgeschakeld (--no-summary)');
	}

	// Tracker explanation
	const trackerExplanation = explainTrackers(browserData);

	// Write reports
	mkdirSync(OUTPUT_DIR, { recursive: true });
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const domain = new URL(TARGET_URL).hostname.replace(/^www\./, '');
	const baseName = `${domain}_${timestamp}`;

	writeFileSync(resolve(OUTPUT_DIR, `${baseName}.json`), JSON.stringify(result, null, 2));
	writeFileSync(
		resolve(OUTPUT_DIR, `${baseName}.html`),
		generateHtmlReport(result, executiveSummary, trackerExplanation),
	);

	const allFindings = Object.values(result.categories).flatMap((c) => c.findings);
	const totals = { hoog: 0, midden: 0, laag: 0 };
	for (const f of allFindings) {
		if (f.severity === 'critical' || f.severity === 'high') totals.hoog++;
		else if (f.severity === 'medium') totals.midden++;
		else totals.laag++;
	}

	console.log('\n=== RESULTAAT ===');
	console.log(`Score: ${result.overallScore}/100`);
	console.log(
		`Bevindingen: ${allFindings.length} totaal (${totals.hoog} hoog, ${totals.midden} midden, ${totals.laag} laag)`,
	);
	console.log('---');
	for (const [key, cat] of Object.entries(result.categories)) {
		const c = { hoog: 0, midden: 0, laag: 0 };
		for (const f of cat.findings) {
			if (f.severity === 'critical' || f.severity === 'high') c.hoog++;
			else if (f.severity === 'medium') c.midden++;
			else c.laag++;
		}
		const name =
			{
				security: 'Beveiliging',
				wcag: 'Toegankelijk',
				privacy: 'Privacy',
				performance: 'Snelheid',
				standards: 'Standaarden',
			}[key] ?? key;
		console.log(
			`${name.padEnd(15)} ${String(cat.score).padStart(3)}/100  hoog:${c.hoog} midden:${c.midden} laag:${c.laag}`,
		);
	}
	if (executiveSummary) console.log('AI-samenvatting: ja (Mistral)');
	console.log(`\nRapport: scan-results/${baseName}.html`);
	console.log(`JSON:    scan-results/${baseName}.json`);
}

main().catch((err) => {
	console.error('Scan mislukt:', err);
	process.exit(1);
});
