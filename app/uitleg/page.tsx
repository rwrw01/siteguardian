import type { Metadata } from 'next';

export const metadata: Metadata = {
	title: 'Wat scannen wij en waarom',
};

export default function UitlegPage() {
	const categories = [
		{
			title: 'Beveiliging',
			why: 'Gemeentewebsites verwerken persoonsgegevens van inwoners. Zonder goede beveiliging kunnen kwaadwillenden gegevens onderscheppen, de website misbruiken voor phishing, of bezoekers omleiden naar schadelijke pagina\'s.',
			what: [
				'Beveiligingsheaders (HSTS, CSP, X-Frame-Options) — beschermen bezoekers tegen aanvallen',
				'Cookie-instellingen (Secure, HttpOnly, SameSite) — voorkomen diefstal van sessiegegevens',
				'HTTPS-configuratie — versleuteling van alle verkeer tussen bezoeker en website',
				'Informatie-lekken — of de website technische details toont die aanvallers kunnen misbruiken',
				'Externe scripts zonder integriteitscontrole — risico op ongeautoriseerde code-injectie',
			],
		},
		{
			title: 'Toegankelijkheid',
			why: 'Nederlandse overheidswebsites zijn wettelijk verplicht om toegankelijk te zijn voor iedereen, inclusief mensen met een visuele, auditieve of motorische beperking (Besluit digitale toegankelijkheid overheid, WCAG 2.2 AA).',
			what: [
				'Taalinstelling — zodat schermlezers de juiste taal gebruiken',
				'Koppenstructuur — logische hiërarchie voor navigatie met hulptechnologie',
				'Alternatieve tekst bij afbeeldingen — zodat blinde bezoekers weten wat er staat',
				'Formulierlabels — zodat elk invoerveld een duidelijke beschrijving heeft',
				'Toetsenbordnavigatie — skip links en focusindicatoren voor wie geen muis kan gebruiken',
				'Zoombeperking — of de website inzoomen verhindert (problematisch voor slechtzienden)',
			],
		},
		{
			title: 'Privacy',
			why: 'Gemeenten hebben een bijzondere verantwoordelijkheid richting hun inwoners. Inwoners moeten erop kunnen vertrouwen dat hun bezoek aan de gemeentewebsite niet wordt gevolgd door commerciële partijen. De AVG en Telecommunicatiewet stellen hier strenge eisen aan.',
			what: [
				'Tracking-diensten — of Google Analytics, Facebook Pixel of vergelijkbare trackers actief zijn',
				'Cookie-toestemming — of er een correct werkend toestemmingsmechanisme is',
				'Externe domeinen — hoeveel derde partijen gegevens van bezoekers ontvangen',
				'Privacyverklaring — of er een zichtbare link naar het privacybeleid is',
				'Analytics-cookies — of deze pas na toestemming worden geplaatst (niet direct bij laden)',
			],
		},
		{
			title: 'Snelheid',
			why: 'Een trage website is niet alleen vervelend, maar ook een toegankelijkheidsprobleem. Inwoners met een langzame internetverbinding of ouder apparaat worden buitengesloten. Bovendien beïnvloedt snelheid de vindbaarheid in zoekmachines.',
			what: [
				'Aantal HTTP-verzoeken — hoeveel bestanden de browser moet laden',
				'Externe afhankelijkheden — hoeveel derde partij-domeinen extra wachttijd veroorzaken',
				'Render-blocking scripts — of scripts het tonen van de pagina blokkeren',
				'Compressie — of HTML, CSS en JavaScript gecomprimeerd worden verstuurd',
				'Caching — of de browser bestanden mag onthouden voor een volgend bezoek',
			],
		},
		{
			title: 'Overheidsstandaarden',
			why: 'Nederlandse gemeenten moeten voldoen aan de verplichte standaarden van het Forum Standaardisatie. Dit borgt dat overheidswebsites betrouwbaar, vindbaar en interoperabel zijn.',
			what: [
				'HTTPS — verplicht voor alle overheidswebsites',
				'Toegankelijkheidsverklaring — verplichte publicatie over de toegankelijkheidsstatus',
				'Responsief ontwerp — geschikt voor mobiel, tablet en desktop',
				'Open standaarden — gebruik van HTML5, geen afhankelijkheid van specifieke leveranciers',
				'Metadata — correcte beschrijving voor zoekmachines en sociale media',
			],
		},
	];

	return (
		<>
			<section style={{ padding: '40px 0 20px' }}>
				<h1 style={{ fontSize: 28, marginBottom: 8 }}>Wat scannen wij en waarom</h1>
				<p style={{ color: '#9ca3af', lineHeight: 1.7, maxWidth: 640 }}>
					Site Guardian controleert gemeentewebsites op vijf onderdelen. Hieronder leggen
					we per onderdeel uit waarom het belangrijk is en wat we precies controleren.
					Alle controles zijn geautomatiseerd en regel-gebaseerd — er wordt geen AI
					gebruikt voor de bevindingen zelf.
				</p>
			</section>

			{categories.map((cat) => (
				<section key={cat.title} style={{
					marginBottom: 24,
					background: 'rgba(255,255,255,0.03)',
					border: '1px solid rgba(255,255,255,0.08)',
					borderRadius: 12,
					padding: 24,
				}}>
					<h2 style={{ fontSize: 20, color: '#2ea043', marginBottom: 8 }}>{cat.title}</h2>
					<p style={{ color: '#d1d5db', lineHeight: 1.7, marginBottom: 16 }}>
						<strong style={{ color: '#fff' }}>Waarom? </strong>{cat.why}
					</p>
					<p style={{ color: '#9ca3af', fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Wat controleren wij:</p>
					<ul style={{ paddingLeft: 20, color: '#d1d5db', lineHeight: 1.8 }}>
						{cat.what.map((item) => (
							<li key={item} style={{ fontSize: 14, marginBottom: 4 }}>{item}</li>
						))}
					</ul>
				</section>
			))}

			<section style={{
				background: 'rgba(255,255,255,0.05)',
				border: '1px solid rgba(255,255,255,0.1)',
				borderRadius: 12,
				padding: 24,
				marginBottom: 24,
			}}>
				<h2 style={{ fontSize: 20, marginBottom: 12 }}>Over de bestuurlijke samenvatting</h2>
				<p style={{ color: '#d1d5db', lineHeight: 1.7, marginBottom: 12 }}>
					Optioneel kan Site Guardian een korte samenvatting toevoegen die geschreven is
					voor bestuurders: wethouders, gemeentesecretarissen en directeuren. Deze
					samenvatting vertaalt de technische bevindingen naar begrijpelijke risico's en
					concrete acties.
				</p>
				<p style={{ color: '#d1d5db', lineHeight: 1.7, marginBottom: 12 }}>
					De samenvatting wordt opgesteld door AI (Mistral) en is in het rapport altijd
					duidelijk als zodanig gemarkeerd. De feitelijke bevindingen zijn en blijven
					volledig regel-gebaseerd — de AI interpreteert alleen het resultaat, niet de scan.
				</p>
				<p style={{ color: '#9ca3af', lineHeight: 1.7, fontSize: 14 }}>
					Geen samenvatting nodig? Vink de optie uit bij het starten van de scan.
					U ontvangt dan alleen het technische rapport.
				</p>
			</section>

			<section style={{
				background: 'rgba(46, 160, 67, 0.08)',
				border: '1px solid rgba(46, 160, 67, 0.2)',
				borderRadius: 12,
				padding: 24,
				textAlign: 'center',
			}}>
				<h2 style={{ fontSize: 20, marginBottom: 8 }}>Waarom gratis?</h2>
				<p style={{ color: '#d1d5db', lineHeight: 1.7, maxWidth: 560, margin: '0 auto' }}>
					Wij vinden dat elke gemeente recht heeft op inzicht in de digitale veiligheid
					en privacy van haar website. Andere partijen bieden een gratis scan aan en
					vragen vervolgens honderden euro's voor het rapport. Wij doen het anders.
					Site Guardian is open source (EUPL-1.2), volledig gratis, en heeft geen
					commercieel belang.
				</p>
			</section>
		</>
	);
}
