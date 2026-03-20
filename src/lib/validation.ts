import { z } from 'zod';

export const targetUrlSchema = z
	.string()
	.url()
	.refine(
		(url) => {
			try {
				const parsed = new URL(url);
				return parsed.protocol === 'https:';
			} catch {
				return false;
			}
		},
		'Moet een geldige HTTPS URL zijn',
	);

export const repoUrlSchema = z
	.string()
	.url()
	.regex(
		/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/,
		'Moet een geldige GitHub repository URL zijn (https://github.com/owner/repo)',
	);

export const scanRequestSchema = z.object({
	targetUrl: targetUrlSchema,
});

export type ScanRequest = z.infer<typeof scanRequestSchema>;

export const scanIdSchema = z.string().cuid();

export const paginationSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});
