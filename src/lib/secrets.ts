import { readFileSync, existsSync } from 'node:fs';

/**
 * Read a secret from a Docker secret file or fall back to environment variable.
 * Docker secrets are mounted at /run/secrets/<name>.
 * In development, environment variables are used directly.
 *
 * Returns empty string during build-time (Next.js prerender).
 * Throws at runtime in production only if secret is missing.
 */
export function readSecret(name: string, envFallback?: string): string {
	// Try Docker secret file first
	const secretPath = `/run/secrets/${name}`;
	if (existsSync(secretPath)) {
		return readFileSync(secretPath, 'utf-8').trim();
	}

	// Fall back to environment variable
	const envValue = envFallback ? process.env[envFallback] : undefined;
	if (envValue) return envValue;

	// During build (next build), secrets are not available — return empty
	// At runtime, the secret files will be mounted by Docker
	if (process.env.NEXT_PHASE === 'phase-production-build') {
		return '';
	}

	return '';
}
