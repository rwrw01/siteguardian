'use client';

import { useState } from 'react';

export default function LoginPage() {
	const [email, setEmail] = useState('');
	const [sent, setSent] = useState(false);
	const [error, setError] = useState('');

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError('');
		try {
			const resp = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email }),
			});
			if (resp.ok) {
				setSent(true);
			} else {
				setError('Er ging iets mis. Probeer het opnieuw.');
			}
		} catch {
			setError('Verbinding mislukt. Probeer het opnieuw.');
		}
	}

	if (sent) {
		return (
			<section style={{ textAlign: 'center', padding: '80px 0' }}>
				<h1 style={{ fontSize: 28, marginBottom: 12 }}>Controleer uw e-mail</h1>
				<p style={{ color: '#9ca3af', fontSize: 16, lineHeight: 1.7, maxWidth: 400, margin: '0 auto' }}>
					We hebben een inloglink gestuurd naar <strong style={{ color: '#d1d5db' }}>{email}</strong>.
					De link is 10 minuten geldig.
				</p>
			</section>
		);
	}

	return (
		<section style={{ maxWidth: 400, margin: '80px auto', textAlign: 'center' }}>
			<h1 style={{ fontSize: 28, marginBottom: 8 }}>Inloggen</h1>
			<p style={{ color: '#9ca3af', marginBottom: 24, fontSize: 15 }}>
				Voer uw e-mailadres in om een inloglink te ontvangen.
			</p>
			<form onSubmit={handleSubmit} className="card">
				<div style={{ marginBottom: 16 }}>
					<label htmlFor="login-email">E-mailadres</label>
					<input
						id="login-email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						placeholder="j.jansen@rijssen-holten.nl"
						required
					/>
				</div>
				{error && (
					<p style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: 12 }}>{error}</p>
				)}
				<button type="submit" className="btn btn-primary">
					Inloglink versturen
				</button>
			</form>
		</section>
	);
}
