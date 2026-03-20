export default function Home() {
	return (
		<>
			<section style={{ textAlign: 'center', padding: '60px 0 40px' }}>
				<h1 style={{ fontSize: 40, marginBottom: 8 }}>
					<span style={{ color: '#2ea043' }}>Site</span> Guardian
				</h1>
				<p style={{ fontSize: 20, color: '#d1d5db', fontWeight: 500, marginBottom: 8 }}>
					Gratis website compliance scanner
				</p>
				<p style={{ fontSize: 16, color: '#9ca3af', lineHeight: 1.7, maxWidth: 600, margin: '0 auto' }}>
					Scan uw gemeentewebsite op beveiliging, toegankelijkheid, privacy en
					overheidsstandaarden. Geen kosten, geen verborgen upsell.
				</p>
			</section>

			<section className="card" aria-labelledby="scan-heading" style={{ maxWidth: 540, margin: '0 auto 2rem' }}>
				<h2 id="scan-heading" style={{ fontSize: 18, marginBottom: 20 }}>Nieuwe scan</h2>
				<form action="/api/scan" method="POST">
					<div style={{ marginBottom: 16 }}>
						<label htmlFor="email">Uw e-mailadres</label>
						<input
							id="email"
							name="email"
							type="email"
							placeholder="j.jansen@rijssen-holten.nl"
							required
							aria-describedby="email-help"
						/>
						<p id="email-help" style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
							Het rapport wordt naar dit adres gestuurd. U kunt alleen websites scannen
							die bij uw e-maildomein horen.
						</p>
					</div>

					<div style={{ marginBottom: 16 }}>
						<label htmlFor="targetUrl">Website URL</label>
						<input
							id="targetUrl"
							name="targetUrl"
							type="url"
							placeholder="https://www.rijssen-holten.nl"
							required
						/>
					</div>

					<div style={{ marginBottom: 24 }}>
						<label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'normal', cursor: 'pointer' }}>
							<input
								type="checkbox"
								name="includeSummary"
								defaultChecked
								style={{ width: 'auto', accentColor: '#2ea043' }}
							/>
							<span style={{ color: '#d1d5db' }}>Bestuurlijke samenvatting toevoegen</span>
						</label>
						<p style={{ fontSize: '0.75rem', color: '#6b7280', margin: '4px 0 0 28px' }}>
							Een korte samenvatting in begrijpelijke taal voor wethouders en directeuren.
							Opgesteld door AI, duidelijk als zodanig gemarkeerd.
						</p>
					</div>

					<button type="submit" className="btn btn-primary">
						Scan starten
					</button>
				</form>
			</section>

			<section style={{
				display: 'grid',
				gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
				gap: 16,
				maxWidth: 540,
				margin: '0 auto 2rem',
			}}>
				{[
					{ title: 'Beveiliging', desc: 'Headers, cookies, versleuteling' },
					{ title: 'Toegankelijkheid', desc: 'WCAG 2.2 AA, schermlezers' },
					{ title: 'Privacy', desc: 'AVG, cookies, trackers' },
					{ title: 'Snelheid', desc: 'Laadtijd, compressie' },
					{ title: 'Standaarden', desc: 'HTTPS, verklaring, NL GOV' },
				].map((cat) => (
					<div key={cat.title} style={{
						background: 'rgba(255,255,255,0.03)',
						border: '1px solid rgba(255,255,255,0.08)',
						borderRadius: 8,
						padding: 16,
						textAlign: 'center',
					}}>
						<p style={{ color: '#2ea043', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{cat.title}</p>
						<p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>{cat.desc}</p>
					</div>
				))}
			</section>

			<section style={{
				background: 'rgba(46, 160, 67, 0.08)',
				border: '1px solid rgba(46, 160, 67, 0.2)',
				borderRadius: 12,
				padding: 24,
				maxWidth: 540,
				margin: '0 auto',
				textAlign: 'center',
			}}>
				<p style={{ fontSize: 15, color: '#d1d5db', lineHeight: 1.7 }}>
					Uit onderzoek (2026) blijkt dat veel gemeentewebsites onbewust gegevens van
					inwoners delen met grote techbedrijven. Wij vinden het onethisch om hiervoor
					honderden euro's te vragen. Site Guardian is en blijft gratis.
				</p>
			</section>
		</>
	);
}
