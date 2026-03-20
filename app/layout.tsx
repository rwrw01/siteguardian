import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import './globals.css';

export const metadata: Metadata = {
	title: {
		default: 'Site Guardian',
		template: '%s | Site Guardian',
	},
	description: 'Gratis website compliance scanner voor Nederlandse publieke instellingen',
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	const nonce = (await headers()).get('x-nonce') ?? '';

	return (
		<html lang="nl">
			<body>
				<a href="#main-content" className="skip-link">
					Ga naar hoofdinhoud
				</a>

				<header style={{
					padding: '16px 20px',
					borderBottom: '1px solid rgba(255,255,255,0.1)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					maxWidth: 960,
					margin: '0 auto',
				}}>
					<a href="/" style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem', textDecoration: 'none' }}>
						<span style={{ color: '#2ea043' }}>Site</span> Guardian
					</a>
					<nav aria-label="Hoofdnavigatie" style={{ display: 'flex', gap: '1.5rem', fontSize: '0.9rem' }}>
						<a href="/" style={{ color: '#9ca3af' }}>Scan</a>
						<a href="/uitleg" style={{ color: '#9ca3af' }}>Uitleg</a>
					</nav>
				</header>

				<main id="main-content" role="main" tabIndex={-1} style={{ maxWidth: 960, margin: '0 auto', padding: '0 20px' }}>
					{children}
				</main>

				<footer style={{
					borderTop: '1px solid rgba(255,255,255,0.1)',
					padding: '24px 20px',
					textAlign: 'center',
					fontSize: '0.8rem',
					color: '#6b7280',
					maxWidth: 960,
					margin: '3rem auto 0',
				}}>
					<p>Site Guardian — gratis en onafhankelijke website scanner</p>
					<p style={{ marginTop: 4 }}>
						Open source (<a href="https://eupl.eu" style={{ color: '#6b7280' }}>EUPL-1.2</a>)
						{' | '}
						Repository scanning: <a href="https://gitguardian.publicvibes.nl">Git Guardian</a>
					</p>
				</footer>
			</body>
		</html>
	);
}
