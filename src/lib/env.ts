import { z } from 'zod';

const envSchema = z.object({
	DATABASE_URL: z.string().url(),
	REDIS_URL: z.string().url(),
	PORT: z.coerce.number().int().min(1).max(65535).default(8080),

	KEYCLOAK_CLIENT_ID: z.string().min(1),
	KEYCLOAK_CLIENT_SECRET: z.string().min(1),
	KEYCLOAK_ISSUER: z.string().url(),

	NEXTAUTH_URL: z.string().url(),
	NEXTAUTH_SECRET: z.string().min(32),

	ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
	GITHUB_TOKEN: z.string().min(1),

	RESEND_API_KEY: z.string().startsWith('re_').optional(),
	SCAN_EMAIL_FROM: z.string().email().optional(),

	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		const formatted = result.error.flatten().fieldErrors;
		const message = Object.entries(formatted)
			.map(([key, errors]) => `  ${key}: ${errors?.join(', ')}`)
			.join('\n');
		throw new Error(`Missing or invalid environment variables:\n${message}`);
	}
	return result.data;
}
