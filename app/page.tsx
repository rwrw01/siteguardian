'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function HomeContent() {
	const params = useSearchParams();
	const status = params.get('status');
	const error = params.get('error');
	const domain = params.get('domain');
	const email = params.get('email');
	const [submitting, setSubmitting] = useState(false);
	const [scanMode, setScanMode] = useState<'live' | 'har'>('live');

	return (
		<>
			<section style={{ textAlign: 'center', padding: '60px 0 40px' }}>
				<h1 style={{ fontSize: 40, marginBottom: 8 }}>
					<span style={{ color: '#2ea043' }}>Site</span> Guardian
				</h1>
				<p style={{ fontSize: 20, color: '#d1d5db', fontWeight: 500, marginBottom: 8 }}>
					Gratis website compliance scanner
				</p>
				<p
					style={{
						fontSize: 16,
						color: '#9ca3af',
						lineHeight: 1.7,
						maxWidth: 600,
						margin: '0 auto',
					}}
				>
					Scan uw gemeentewebsite op beveiliging, toegankelijkheid, privacy en overheidsstandaarden.
					Geen kosten, geen verborgen upsell.
				</p>
			</section>

			{status === 'scan_complete' && (
				<section
					style={{
						background: 'rgba(46, 160, 67, 0.15)',
						border: '1px solid rgba(46, 160, 67, 0.3)',
						borderRadius: 8,
						padding: 20,
						maxWidth: 540,
						margin: '0 auto 2rem',
						textAlign: 'center',
					}}
				>
					<p style={{ color: '#86efac', fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
						Bedankt voor uw aanvraag
					</p>
					<p style={{ color: '#d1d5db', fontSize: 14 }}>
						De scan van <strong>{domain}</strong> is gestart. Over enkele ogenblikken ontvangt u het
						rapport als PDF in uw mailbox (<strong>{email}</strong>).
					</p>
				</section>
			)}

			{error && (
				<section
					style={{
						background: 'rgba(220, 38, 38, 0.15)',
						border: '1px solid rgba(220, 38, 38, 0.3)',
						borderRadius: 8,
						padding: 20,
						maxWidth: 540,
						margin: '0 auto 2rem',
						textAlign: 'center',
					}}
				>
					<p style={{ color: '#fca5a5', fontSize: 14 }}>
						{error === 'token_used' && 'Deze scanlink is al gebruikt. Vraag een nieuwe scan aan.'}
						{error === 'scan_failed' &&
							`De scan van ${domain ?? 'de website'} is mislukt. Probeer het opnieuw.`}
						{error === 'unauthorized' &&
							'U kunt alleen websites scannen die bij uw e-maildomein horen. Gebruik een e-mailadres van de organisatie die u wilt scannen.'}
						{error === 'missing_token' && 'Ongeldige link. Vraag een nieuwe scan aan.'}
						{error === 'validation' && 'Controleer of alle velden correct zijn ingevuld.'}
						{error === 'rate_limit' &&
							`${domain ? `${domain} is recent al gescand.` : 'U heeft te veel scans aangevraagd.'} Probeer het over een uur opnieuw.`}
						{![
							'token_used',
							'scan_failed',
							'unauthorized',
							'missing_token',
							'validation',
							'rate_limit',
							'har_too_large',
							'har_invalid',
						].includes(error) && `Er ging iets mis: ${error}`}
						{error === 'har_too_large' && 'Het HAR bestand is te groot (max 50 MB).'}
						{error === 'har_invalid' &&
							'Het HAR bestand is ongeldig. Exporteer een nieuw bestand vanuit uw browser.'}
					</p>
				</section>
			)}

			{!status && (
				<section
					className="card"
					aria-labelledby="scan-heading"
					style={{ maxWidth: 540, margin: '0 auto 2rem' }}
				>
					<h2 id="scan-heading" style={{ fontSize: 18, marginBottom: 20 }}>
						Nieuwe scan
					</h2>

					<div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
						<button
							type="button"
							onClick={() => setScanMode('live')}
							style={{
								flex: 1,
								padding: '8px 12px',
								borderRadius: 6,
								border: `1px solid ${scanMode === 'live' ? '#2ea043' : 'rgba(255,255,255,0.1)'}`,
								background: scanMode === 'live' ? 'rgba(46,160,67,0.15)' : 'transparent',
								color: scanMode === 'live' ? '#86efac' : '#9ca3af',
								cursor: 'pointer',
								fontSize: 14,
								fontWeight: 500,
							}}
						>
							Live scan
						</button>
						<button
							type="button"
							onClick={() => setScanMode('har')}
							style={{
								flex: 1,
								padding: '8px 12px',
								borderRadius: 6,
								border: `1px solid ${scanMode === 'har' ? '#2ea043' : 'rgba(255,255,255,0.1)'}`,
								background: scanMode === 'har' ? 'rgba(46,160,67,0.15)' : 'transparent',
								color: scanMode === 'har' ? '#86efac' : '#9ca3af',
								cursor: 'pointer',
								fontSize: 14,
								fontWeight: 500,
							}}
						>
							HAR-bestand uploaden
						</button>
					</div>

					<form
						action={scanMode === 'har' ? '/api/scan/har' : '/api/scan'}
						method="POST"
						encType={scanMode === 'har' ? 'multipart/form-data' : undefined}
						onSubmit={() => setSubmitting(true)}
					>
						<div style={{ marginBottom: 16 }}>
							<label htmlFor="name">Uw naam</label>
							<input id="name" name="name" type="text" placeholder="Jan Jansen" required />
						</div>

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
								Het rapport wordt als PDF naar dit adres verstuurd.
								{scanMode === 'live' &&
									' U kunt alleen websites scannen die bij uw e-maildomein horen.'}
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

						{scanMode === 'har' && (
							<div style={{ marginBottom: 16 }}>
								<label htmlFor="harFile">HAR-bestand</label>
								<input
									id="harFile"
									name="harFile"
									type="file"
									accept=".har,application/json"
									required
									aria-describedby="har-help"
									style={{ padding: '8px 0' }}
								/>
								<p id="har-help" style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
									Open DevTools (F12) in uw browser, ga naar het Network-tabblad, laad de pagina,
									klik rechts en kies &quot;Save all as HAR with content&quot;.
								</p>
							</div>
						)}

						<div style={{ marginBottom: 24 }}>
							<label
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									fontWeight: 'normal',
									cursor: 'pointer',
								}}
							>
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

						{/* Honeypot: invisible to users, bots fill this in */}
						<div
							aria-hidden="true"
							style={{ position: 'absolute', left: '-9999px', height: 0, overflow: 'hidden' }}
						>
							<label htmlFor="website">Website</label>
							<input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
						</div>

						<button
							type="submit"
							className="btn btn-primary"
							disabled={submitting}
							style={submitting ? { opacity: 0.6, cursor: 'wait' } : {}}
						>
							{submitting
								? 'Scan wordt aangevraagd...'
								: scanMode === 'har'
									? 'HAR analyseren'
									: 'Scan aanvragen'}
						</button>
					</form>
				</section>
			)}

			<section
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
					gap: 16,
					maxWidth: 540,
					margin: '0 auto 2rem',
				}}
			>
				{[
					{ title: 'Beveiliging', desc: 'Headers, cookies, versleuteling' },
					{ title: 'Toegankelijkheid', desc: 'WCAG 2.2 AA, schermlezers' },
					{ title: 'Privacy', desc: 'AVG, cookies, trackers' },
				].map((cat) => (
					<div
						key={cat.title}
						style={{
							background: 'rgba(255,255,255,0.03)',
							border: '1px solid rgba(255,255,255,0.08)',
							borderRadius: 8,
							padding: 16,
							textAlign: 'center',
						}}
					>
						<p style={{ color: '#2ea043', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
							{cat.title}
						</p>
						<p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5 }}>{cat.desc}</p>
					</div>
				))}
			</section>

			<section
				style={{
					background: 'rgba(46, 160, 67, 0.08)',
					border: '1px solid rgba(46, 160, 67, 0.2)',
					borderRadius: 12,
					padding: 24,
					maxWidth: 540,
					margin: '0 auto',
					textAlign: 'center',
				}}
			>
				<p style={{ fontSize: 15, color: '#d1d5db', lineHeight: 1.7 }}>
					Gemeenten zijn in het nieuws gekomen omdat hun websites gegevens van inwoners delen met
					externe partijen zonder daarvoor toestemming te vragen. Raadsleden stellen vragen,
					ambtenaren moeten in allerijl antwoorden leveren. Ondertussen vragen de onderzoekers
					enkele honderden euro's voor een gedetailleerd rapport. Uiteraard moeten gemeenten hun
					digitale zaken op orde hebben — maar dat kan ook zonder kosten. Daarom dit initiatief.
				</p>
			</section>
		</>
	);
}

export default function Home() {
	return (
		<Suspense>
			<HomeContent />
		</Suspense>
	);
}
