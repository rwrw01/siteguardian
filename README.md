# Site Guardian

Gratis en onafhankelijke website compliance scanner voor Nederlandse publieke instellingen.

Scant gemeentewebsites op beveiliging, toegankelijkheid (WCAG 2.2 AA), privacy (AVG) en overheidsstandaarden. Geen kosten, geen verborgen upsell, geen commercieel belang.

**Live:** https://siteguardian.publicvibes.nl

## Wat wordt gescand

| Onderdeel | Controles |
|-----------|-----------|
| Beveiliging | Security headers (HSTS, CSP, X-Frame-Options), cookie-instellingen, HTTPS |
| Toegankelijkheid | WCAG 2.2 AA: lang attribuut, headings, alt tekst, landmarks, formulierlabels |
| Privacy | Trackers (Google Analytics, Facebook Pixel etc.), cookie consent, privacyverklaring |
| Snelheid | HTTP requests, externe domeinen, render-blocking scripts, compressie |
| Standaarden | HTTPS, toegankelijkheidsverklaring, responsief ontwerp, metadata |

## Architectuur

- **Scan engine**: regel-gebaseerd, geen AI voor bevindingen
- **Bestuurders-samenvatting**: optioneel, via Mistral (duidelijk als AI gemarkeerd)
- **Auth**: magic-link via e-mail (Resend), HMAC-signed tokens
- **Autorisatie**: domein-restrictie (email moet matchen met scan-domein)
- **Repo-analyse**: niet ingebouwd — daarvoor verwijzen we naar [Git Guardian](https://gitguardian.publicvibes.nl)

## Deployment

Draait op een Hetzner VPS met Docker Compose, achter Traefik reverse proxy met:
- Nonce-based Content Security Policy
- CrowdSec WAF
- SHA256 image pinning
- Docker secrets (geen env vars voor credentials)
- Read-only containers, cap_drop ALL, non-root

## Lokaal draaien

```bash
npm install
npm run dev
```

Standalone scan (lokaal, met Playwright):
```bash
npx tsx scripts/standalone-scan.ts "https://www.rijssen-holten.nl"
npx tsx scripts/standalone-scan.ts "https://www.rijssen-holten.nl" --no-summary
```

## Dependencies

| Package | Versie | Licentie | Doel |
|---------|--------|----------|------|
| next | 15.3.1 | MIT | Web framework |
| react | 19.0.0 | MIT | UI library |
| react-dom | 19.0.0 | MIT | React DOM renderer |
| zod | 3.24.3 | MIT | Input validatie |
| resend | 4.1.2 | MIT | E-mail verzending |
| @prisma/client | 6.5.0 | Apache-2.0 | Database ORM |
| @octokit/rest | 21.1.1 | MIT | GitHub API (toekomstig) |
| typescript | 5.7.3 | Apache-2.0 | Type checking |
| @biomejs/biome | 1.9.4 | MIT | Linter/formatter |
| vitest | 3.0.9 | MIT | Unit tests |
| @vitest/coverage-v8 | 3.0.9 | MIT | Code coverage |
| prisma | 6.5.0 | Apache-2.0 | Database CLI |
| @playwright/test | 1.50.1 | Apache-2.0 | E2E tests |

## Licentie

EUPL-1.2

Dit project is gratis ter beschikking gesteld vanuit [publicvibes.nl](https://publicvibes.nl), een open source initiatief van Ralph Wagter.
