// HAR file parser: converts a HAR (HTTP Archive) file into BrowserData
// so that the same analyzers can run on user-uploaded recordings.

import * as cheerio from 'cheerio';
import { z } from 'zod';

import type { BrowserData } from './_analyzers';

// ---------------------------------------------------------------------------
// Minimal HAR schema (only the fields we need)
// ---------------------------------------------------------------------------

const harHeaderSchema = z.object({
	name: z.string(),
	value: z.string(),
});

const harCookieSchema = z.object({
	name: z.string(),
	domain: z.string().optional().default(''),
	secure: z.boolean().optional().default(false),
	httpOnly: z.boolean().optional().default(false),
	sameSite: z.string().optional().default(''),
});

const harEntrySchema = z.object({
	request: z.object({
		url: z.string(),
		method: z.string(),
	}),
	response: z.object({
		status: z.number(),
		headers: z.array(harHeaderSchema),
		cookies: z.array(harCookieSchema).optional().default([]),
		content: z.object({
			size: z.number().optional().default(0),
			mimeType: z.string().optional().default(''),
			text: z.string().optional().default(''),
		}),
	}),
	_resourceType: z.string().optional(),
});

const harSchema = z.object({
	log: z.object({
		entries: z.array(harEntrySchema).min(1, 'HAR bestand bevat geen requests'),
	}),
});

export type HarFile = z.infer<typeof harSchema>;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates and parses a raw HAR JSON object.
 * @returns The parsed HAR or an error message.
 */
export function parseHar(raw: unknown): { ok: true; har: HarFile } | { ok: false; error: string } {
	const result = harSchema.safeParse(raw);
	if (!result.success) {
		return {
			ok: false,
			error: `Ongeldig HAR bestand: ${result.error.issues[0]?.message ?? 'onbekende fout'}`,
		};
	}
	return { ok: true, har: result.data };
}

/**
 * Converts a parsed HAR file into BrowserData that can be fed to the analyzers.
 * @param har - Validated HAR object
 * @param targetUrl - The primary URL that was recorded (first document request)
 */
export function harToBrowserData(har: HarFile, targetUrl?: string): BrowserData {
	const entries = har.log.entries;

	// Find the main document entry (first HTML response)
	const docEntry =
		entries.find(
			(e) =>
				e.response.content.mimeType.includes('text/html') &&
				e.response.status >= 200 &&
				e.response.status < 400,
		) ?? entries[0];

	const resolvedUrl = targetUrl ?? docEntry.request.url;
	const targetDomain = new URL(resolvedUrl).hostname.replace(/^www\./, '');

	// Response headers from main document
	const headers: Record<string, string> = {};
	for (const h of docEntry.response.headers) {
		headers[h.name.toLowerCase()] = h.value;
	}

	// HTML content
	const html = docEntry.response.content.text ?? '';

	// Parse DOM with cheerio
	const $ = cheerio.load(html);

	const title = $('title').first().text() ?? '';
	const lang = $('html').attr('lang') ?? '';

	// Images
	const images: BrowserData['images'] = [];
	$('img').each((_i, el) => {
		const $el = $(el);
		images.push({
			src: $el.attr('src') ?? '',
			alt: $el.attr('alt') ?? null,
			role: $el.attr('role') ?? null,
		});
	});

	// Headings
	const headings: BrowserData['headings'] = [];
	$('h1,h2,h3,h4,h5,h6').each((_i, el) => {
		const $el = $(el);
		const tagName = 'tagName' in el ? (el.tagName as string) : '';
		headings.push({
			level: Number.parseInt(tagName.replace('h', ''), 10),
			text: $el.text().trim().slice(0, 120),
		});
	});

	// Links
	const links: BrowserData['links'] = [];
	$('a[href]').each((_i, el) => {
		const $el = $(el);
		if (links.length < 200) {
			links.push({
				href: $el.attr('href') ?? '',
				text: $el.text().trim().slice(0, 80),
			});
		}
	});

	// Forms
	const forms: BrowserData['forms'] = [];
	$('form').each((_i, formEl) => {
		const $form = $(formEl);
		const inputs: BrowserData['forms'][0]['inputs'] = [];
		$form.find('input:not([type="hidden"]),select,textarea').each((_j, inp) => {
			const $inp = $(inp);
			const id = $inp.attr('id');
			const hasLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
			inputs.push({
				name: $inp.attr('name') ?? '',
				type: $inp.attr('type') ?? 'text',
				hasLabel: hasLabel || !!$inp.attr('aria-label') || !!$inp.attr('aria-labelledby'),
				ariaLabel: $inp.attr('aria-label') ?? null,
			});
		});
		forms.push({
			action: $form.attr('action') ?? '',
			method: $form.attr('method') ?? 'get',
			inputs,
		});
	});

	// Meta tags
	const meta: Record<string, string> = {};
	$('meta[name],meta[property],meta[http-equiv]').each((_i, el) => {
		const $el = $(el);
		const key = $el.attr('name') ?? $el.attr('property') ?? $el.attr('http-equiv') ?? '';
		const value = $el.attr('content') ?? '';
		if (key) meta[key] = value;
	});

	// Scripts
	const scripts: BrowserData['scripts'] = [];
	$('script[src]').each((_i, el) => {
		const $el = $(el);
		scripts.push({
			src: $el.attr('src') ?? '',
			async: $el.attr('async') !== undefined,
			defer: $el.attr('defer') !== undefined,
			integrity: $el.attr('integrity') ?? null,
			crossorigin: $el.attr('crossorigin') ?? null,
		});
	});

	// Landmarks
	const landmarkSelector =
		'main,nav,header,footer,aside,section[aria-label],section[aria-labelledby],' +
		'[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"]';
	const landmarks: BrowserData['landmarks'] = [];
	$(landmarkSelector).each((_i, el) => {
		const $el = $(el);
		const tagName = 'tagName' in el ? (el.tagName as string) : '';
		landmarks.push({
			tag: tagName.toLowerCase(),
			role: $el.attr('role') ?? null,
			ariaLabel: $el.attr('aria-label') ?? $el.attr('aria-labelledby') ?? null,
		});
	});

	// Skip links
	const skipLinks: string[] = [];
	$('a[href^="#"]').each((_i, el) => {
		const text = $(el).text().toLowerCase();
		if (
			text.includes('skip') ||
			text.includes('hoofdinhoud') ||
			text.includes('content') ||
			text.includes('navigatie')
		) {
			skipLinks.push($(el).attr('href') ?? '');
		}
	});

	// Cookies (merge from all entries)
	const cookieMap = new Map<string, BrowserData['cookies'][0]>();
	for (const entry of entries) {
		for (const c of entry.response.cookies ?? []) {
			if (!cookieMap.has(c.name)) {
				cookieMap.set(c.name, {
					name: c.name,
					domain: c.domain,
					secure: c.secure,
					httpOnly: c.httpOnly,
					sameSite: c.sameSite,
				});
			}
		}
	}
	const cookies = [...cookieMap.values()];

	// Resources from all HAR entries
	const resources: BrowserData['resources'] = entries.map((e) => ({
		url: e.request.url,
		type: e._resourceType ?? guessResourceType(e.response.content.mimeType, e.request.url),
		status: e.response.status,
		size: e.response.content.size,
	}));

	// External domains
	const externalDomains = [
		...new Set(
			resources
				.map((r) => {
					try {
						return new URL(r.url).hostname;
					} catch {
						return '';
					}
				})
				.filter((d) => d && !d.includes(targetDomain)),
		),
	];

	return {
		title,
		lang,
		headers,
		html,
		links,
		images,
		headings,
		forms,
		meta,
		cookies,
		scripts,
		resources,
		landmarks,
		skipLinks,
		focusableWithoutOutline: 0, // Cannot determine from HAR (requires runtime CSS)
		externalDomains,
		targetDomain,
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessResourceType(mimeType: string, url: string): string {
	if (mimeType.includes('html')) return 'document';
	if (mimeType.includes('javascript') || url.endsWith('.js')) return 'script';
	if (mimeType.includes('css') || url.endsWith('.css')) return 'stylesheet';
	if (mimeType.includes('image')) return 'image';
	if (mimeType.includes('font') || url.match(/\.(woff2?|ttf|otf|eot)(\?|$)/)) return 'font';
	if (mimeType.includes('json')) return 'fetch';
	return 'other';
}
