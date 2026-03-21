# Mox Mail Server voor publicvibes.nl — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mox mail server installeren op vps-001 voor publicvibes.nl — gebouwd vanuit broncode, volledig gehardend, met DKIM/DMARC/SPF/DANE/MTA-STS, en mail forwarding naar ralph@athide.nl.

**Architecture:** Mox draait direct op de host (niet in Docker) omdat het mail poorten nodig heeft en host networking vereist. De binary wordt gebouwd vanuit broncode op de VPS zelf. Mox beheert zijn eigen TLS-certificaten via Let's Encrypt ACME. Alle mail voor publicvibes.nl wordt geforward naar ralph@athide.nl. Site Guardian stuurt rapporten via SMTP submission (port 587) naar Mox.

**Tech Stack:** Go (build from source), Mox v0.0.15 (MIT), Ubuntu 22.04 ARM64, Let's Encrypt, systemd

**VPS:** vps-001 (Hetzner cax31, aarch64, 89.167.107.143, 15GB RAM, 102GB disk vrij)

**Huidige staat:**
- Go niet geïnstalleerd
- Mail poorten (25/465/587/993/4190) vrij op host
- Huidige MX: `smtp.rzone.de` (registrar default — moet gewijzigd worden)
- Geen SPF/DKIM/DMARC records voor publicvibes.nl
- UFW actief, Hetzner Cloud FW actief (mail poorten open in Cloud FW)
- Kernel hardening actief (`/etc/sysctl.d/99-sovereign-hardening.conf`)

---

## Fase 0: Voorbereiding

### Task 1: Go installeren op VPS

**Doel:** Go toolchain beschikbaar voor het bouwen van Mox vanuit broncode.

- [ ] **Step 1: Download Go ARM64 binary**

```bash
ssh ralph@100.64.0.2
GO_VERSION="1.23.6"  # Controleer latest stable op go.dev/dl
curl -LO "https://go.dev/dl/go${GO_VERSION}.linux-arm64.tar.gz"
```

- [ ] **Step 2: Verifieer checksum**

```bash
sha256sum "go${GO_VERSION}.linux-arm64.tar.gz"
# Vergelijk met checksum op https://go.dev/dl/
```

- [ ] **Step 3: Installeer**

```bash
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf "go${GO_VERSION}.linux-arm64.tar.gz"
rm "go${GO_VERSION}.linux-arm64.tar.gz"
echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh
source /etc/profile.d/go.sh
```

- [ ] **Step 4: Verifieer**

```bash
go version
```
Expected: `go version go1.23.6 linux/arm64`

---

### Task 2: Mox bouwen vanuit broncode

**Doel:** Mox binary gebouwd vanuit getagde release, niet vanuit een pre-built image.

- [ ] **Step 1: Clone en checkout tagged release**

```bash
cd /tmp
git clone --depth 1 --branch v0.0.15 https://github.com/mjl-/mox.git
cd mox
```

- [ ] **Step 2: Audit broncode (handmatige stap)**

Controleer voordat je bouwt:
- `go.mod` — welke dependencies worden gebruikt
- `main.go` — entry point
- `Makefile` of build instructies
- Geen verdachte imports of network calls in build scripts

```bash
cat go.mod | head -20
wc -l $(find . -name '*.go' | head -50)
```

- [ ] **Step 3: Bouw static binary**

```bash
CGO_ENABLED=0 GOBIN=$PWD go install ./...
```

- [ ] **Step 4: Verifieer binary**

```bash
./mox version
file ./mox
# Moet tonen: ELF 64-bit LSB executable, ARM aarch64, statically linked
```

- [ ] **Step 5: Installeer binary**

```bash
sudo cp mox /usr/local/bin/mox
sudo chmod 755 /usr/local/bin/mox
sudo chown root:root /usr/local/bin/mox
```

- [ ] **Step 6: Opruimen**

```bash
rm -rf /tmp/mox
```

---

## Fase 1: Systeemvoorbereiding

### Task 3: Mox gebruiker en directories aanmaken

**Doel:** Dedicated non-root gebruiker en veilige directory-structuur.

- [ ] **Step 1: Maak systeemgebruiker**

```bash
sudo useradd --system --shell /usr/sbin/nologin --home-dir /var/lib/mox --create-home mox
```

- [ ] **Step 2: Maak directories**

```bash
sudo mkdir -p /etc/mox
sudo mkdir -p /var/lib/mox/data
sudo mkdir -p /var/log/mox
sudo chown -R mox:mox /var/lib/mox
sudo chown -R mox:mox /var/log/mox
sudo chmod 700 /var/lib/mox
sudo chmod 700 /var/log/mox
sudo chmod 750 /etc/mox
sudo chown root:mox /etc/mox
```

- [ ] **Step 3: Verifieer permissies**

```bash
ls -la /var/lib/mox/
ls -la /etc/mox/
ls -la /var/log/mox/
id mox
```

Expected: user `mox` met eigen home, geen shell, restrictieve permissies.

---

### Task 4: UFW firewall configureren voor mail

**Doel:** Mail poorten openzetten in UFW (host firewall).

- [ ] **Step 1: Open mail poorten**

```bash
sudo ufw allow 25/tcp comment 'SMTP (mail ontvangst)'
sudo ufw allow 465/tcp comment 'SMTPS (implicit TLS)'
sudo ufw allow 587/tcp comment 'Submission (mail verzending)'
sudo ufw allow 993/tcp comment 'IMAPS (niet actief gebruikt, maar standaard)'
```

- [ ] **Step 2: Verifieer**

```bash
sudo ufw status | grep -E '25|465|587|993'
```

- [ ] **Step 3: Controleer Hetzner Cloud Firewall**

In de Hetzner Cloud Console: bevestig dat poorten 25, 465, 587, 993 TCP inbound open staan. Deze stonden al open voor Mailcow (zie service-inventory.md).

---

## Fase 2: DNS configuratie

### Task 5: DNS records instellen voor publicvibes.nl

**Doel:** Alle DNS records die Mox nodig heeft voor mail. Mox genereert de benodigde records automatisch, maar we moeten ze handmatig instellen bij de DNS provider.

**Belangrijk:** Voer dit uit NADAT Mox geconfigureerd is (Task 6), want Mox genereert de DKIM public key en andere waarden.

- [ ] **Step 1: Genereer DNS records via Mox quickstart**

```bash
sudo -u mox /usr/local/bin/mox quickstart -hostname mail.publicvibes.nl scan@publicvibes.nl
```

Mox genereert een lijst van alle benodigde DNS records. Bewaar deze output.

- [ ] **Step 2: MX record**

```
publicvibes.nl.  IN  MX  10 mail.publicvibes.nl.
```

- [ ] **Step 3: A en AAAA record voor mail subdomain**

```
mail.publicvibes.nl.  IN  A     89.167.107.143
mail.publicvibes.nl.  IN  AAAA  2a01:4f9:c014:34f6::1
```

- [ ] **Step 4: SPF record**

```
publicvibes.nl.  IN  TXT  "v=spf1 a mx ip4:89.167.107.143 ip6:2a01:4f9:c014:34f6::1 -all"
```

Let op: `-all` (hard fail) — alleen deze server mag mail versturen voor publicvibes.nl.

- [ ] **Step 5: DKIM record**

Mox genereert de DKIM selector en public key. Voeg het TXT record toe dat Mox aangeeft:

```
<selector>._domainkey.publicvibes.nl.  IN  TXT  "v=DKIM1; k=ed25519; p=<public key>"
```

Er kunnen meerdere selectors zijn (ed25519 + rsa). Voeg beide toe.

- [ ] **Step 6: DMARC record**

```
_dmarc.publicvibes.nl.  IN  TXT  "v=DMARC1; p=reject; rua=mailto:dmarc-reports@publicvibes.nl; ruf=mailto:dmarc-reports@publicvibes.nl; adkim=s; aspf=s"
```

Let op: `p=reject` — stricte DMARC policy. Mails die niet voldoen aan SPF+DKIM worden geweigerd.

- [ ] **Step 7: MTA-STS policy**

Maak een `_mta-sts.publicvibes.nl` TXT record:

```
_mta-sts.publicvibes.nl.  IN  TXT  "v=STSv1; id=20260320"
```

En host het MTA-STS policy bestand op `https://mta-sts.publicvibes.nl/.well-known/mta-sts.txt`:

```
version: STSv1
mode: enforce
mx: mail.publicvibes.nl
max_age: 604800
```

Dit kan via een simpele nginx container met Traefik label, of Mox kan dit zelf serveren.

- [ ] **Step 8: TLSRPT record**

```
_smtp._tls.publicvibes.nl.  IN  TXT  "v=TLSRPTv1; rua=mailto:tls-reports@publicvibes.nl"
```

- [ ] **Step 9: DANE / TLSA record**

Mox ondersteunt DANE. Het TLSA record linkt het TLS-certificaat aan DNS:

```
_25._tcp.mail.publicvibes.nl.  IN  TLSA  3 1 1 <certificate hash>
```

Mox genereert deze hash. **Vereist DNSSEC op publicvibes.nl** — controleer of de registrar DNSSEC ondersteunt.

- [ ] **Step 10: Reverse DNS (PTR)**

In Hetzner Cloud Console: stel de PTR van 89.167.107.143 in op `mail.publicvibes.nl` (of laat de bestaande PTR staan als die al op de server wijst).

**Let op:** Het huidige PTR record wijst waarschijnlijk naar de VPS hostname. Een PTR wijzigen heeft impact op alle andere services. Controleer eerst wat het huidige PTR is:

```bash
dig +short -x 89.167.107.143
```

- [ ] **Step 11: Verifieer alle DNS records**

```bash
dig +short publicvibes.nl MX @8.8.8.8
dig +short publicvibes.nl TXT @8.8.8.8
dig +short _dmarc.publicvibes.nl TXT @8.8.8.8
dig +short mail.publicvibes.nl A @8.8.8.8
```

---

## Fase 3: Mox configuratie

### Task 6: Mox initiële configuratie

**Doel:** Mox configureren voor publicvibes.nl met mail forwarding.

- [ ] **Step 1: Mox quickstart uitvoeren**

```bash
cd /etc/mox
sudo -u mox /usr/local/bin/mox quickstart -hostname mail.publicvibes.nl scan@publicvibes.nl
```

Dit genereert:
- `/etc/mox/mox.conf` — hoofd-configuratie
- `/etc/mox/domains.conf` — domein-specifieke config
- DKIM private keys in `/var/lib/mox/`
- Alle benodigde DNS records (output bewaren!)

- [ ] **Step 2: Configureer mail forwarding**

Bewerk `/etc/mox/domains.conf` om alle mail voor publicvibes.nl te forwarden naar ralph@athide.nl:

Maak een aliasconfiguratie aan zodat:
- `scan@publicvibes.nl` → forward naar `ralph@athide.nl`
- `dmarc-reports@publicvibes.nl` → forward naar `ralph@athide.nl`
- `tls-reports@publicvibes.nl` → forward naar `ralph@athide.nl`
- `*@publicvibes.nl` (catch-all) → forward naar `ralph@athide.nl`

- [ ] **Step 3: Verifieer configuratie**

```bash
sudo -u mox /usr/local/bin/mox config test
```

Expected: geen fouten.

---

### Task 7: Systemd service aanmaken

**Doel:** Mox als systemd service met hardening.

- [ ] **Step 1: Maak service file**

Bestand: `/etc/systemd/system/mox.service`

```ini
[Unit]
Description=Mox mail server
Documentation=https://www.xmox.nl/
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mox
Group=mox
WorkingDirectory=/var/lib/mox
ExecStart=/usr/local/bin/mox serve
Restart=on-failure
RestartSec=5

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources

# Directories
ReadWritePaths=/var/lib/mox /var/log/mox
ReadOnlyPaths=/etc/mox /usr/local/bin/mox

# Resource limits
MemoryMax=512M
TasksMax=256

# Capabilities — alleen wat nodig is voor mail poorten (<1024)
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=mox

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Reload en start**

```bash
sudo systemctl daemon-reload
sudo systemctl enable mox
sudo systemctl start mox
```

- [ ] **Step 3: Verifieer**

```bash
sudo systemctl status mox
sudo journalctl -u mox --no-pager -n 20
```

Expected: Active (running), geen errors.

- [ ] **Step 4: Verifieer poorten**

```bash
sudo ss -tlnp | grep -E ':25 |:465 |:587 |:993 '
```

Expected: mox luistert op alle vier de poorten.

---

## Fase 4: Verificatie

### Task 8: Mail versturen en ontvangen testen

**Doel:** Verifiëren dat de volledige mailflow werkt.

- [ ] **Step 1: Test SMTP connectivity**

```bash
openssl s_client -connect mail.publicvibes.nl:465 -quiet
```

Expected: TLS handshake succesvol, certificaat voor mail.publicvibes.nl.

- [ ] **Step 2: Test STARTTLS**

```bash
openssl s_client -connect mail.publicvibes.nl:587 -starttls smtp -quiet
```

Expected: STARTTLS handshake succesvol.

- [ ] **Step 3: Verstuur testmail via Mox CLI**

```bash
sudo -u mox /usr/local/bin/mox sendmail -f scan@publicvibes.nl ralph@athide.nl <<EOF
Subject: Site Guardian testmail
From: scan@publicvibes.nl
To: ralph@athide.nl

Dit is een testmail vanuit Site Guardian via Mox.
EOF
```

- [ ] **Step 4: Controleer ontvangst**

Controleer of ralph@athide.nl de testmail heeft ontvangen. Controleer in de mailheaders:
- `DKIM-Signature:` header aanwezig
- `Authentication-Results:` toont dkim=pass, spf=pass

- [ ] **Step 5: Test forwarding**

Stuur een mail naar scan@publicvibes.nl vanuit een extern account. Verifieer dat het wordt geforward naar ralph@athide.nl.

---

### Task 9: internet.nl mail test

**Doel:** 100% score op internet.nl mail test.

- [ ] **Step 1: Voer test uit**

Ga naar https://internet.nl en test `publicvibes.nl` op mail.

- [ ] **Step 2: Controleer resultaten**

Verwacht 100% (of zeer hoog) op:
- [x] STARTTLS
- [x] DANE
- [x] SPF
- [x] DKIM
- [x] DMARC
- [x] MTA-STS
- [x] DNSSEC (vereist dat de registrar DNSSEC ondersteunt)

- [ ] **Step 3: Los eventuele tekortkomingen op**

Per falend onderdeel: controleer het betreffende DNS record en de Mox configuratie.

---

## Fase 5: Integratie met Site Guardian

### Task 10: Site Guardian koppelen aan Mox

**Doel:** Site Guardian stuurt rapporten via SMTP submission naar lokale Mox in plaats van via Resend API.

- [ ] **Step 1: Maak SMTP credentials aan in Mox**

```bash
sudo -u mox /usr/local/bin/mox setaccountpassword scan
# Stel een sterk wachtwoord in
```

Sla het wachtwoord op als Docker secret:

```bash
echo -n '<wachtwoord>' | sudo tee /opt/siteguardian/secrets/smtp_password > /dev/null
sudo chmod 600 /opt/siteguardian/secrets/smtp_password
```

- [ ] **Step 2: Update Site Guardian email module**

Vervang de Resend-integratie door SMTP submission in `src/integration/email.ts`:
- SMTP host: `mail.publicvibes.nl` (of `127.0.0.1` als Mox op dezelfde host draait)
- SMTP port: 587 (STARTTLS)
- Auth: `scan@publicvibes.nl` + wachtwoord uit Docker secret

- [ ] **Step 3: Voeg nodemailer dependency toe** (of gebruik native SMTP)

```bash
npm install --save-exact nodemailer
npm install --save-exact @types/nodemailer  # devDependency
```

Of: implementeer SMTP submission zonder externe dependency via Node.js `net` + `tls` modules.

- [ ] **Step 4: Test end-to-end**

Dien een scan aan via https://siteguardian.publicvibes.nl → bevestigingsmail moet aankomen via Mox → na bevestiging moet het rapport aankomen.

- [ ] **Step 5: Verwijder Resend dependency**

Als Mox stabiel draait:
1. Verwijder `resend` uit `package.json`
2. Verwijder Resend API key uit secrets
3. Update docker-compose.prod.yml (verwijder resend_api_key secret)

---

## Fase 6: Hardening verificatie

### Task 11: Security audit van de Mox installatie

**Doel:** Verifiëren dat Mox voldoet aan alle sovereign-stack hardening eisen.

- [ ] **Step 1: Controleer systemd hardening**

```bash
sudo systemd-analyze security mox
```

Expected: score 2.0 of lager (hoe lager hoe beter, 0.0 is maximaal gehardend).

- [ ] **Step 2: Controleer running user**

```bash
ps aux | grep mox
```

Expected: draait als user `mox`, niet als root.

- [ ] **Step 3: Controleer file permissies**

```bash
sudo find /var/lib/mox -not -user mox -o -not -group mox | head
sudo find /etc/mox -perm -o+r | head
```

Expected: geen bestanden met verkeerde eigenaar of te brede permissies.

- [ ] **Step 4: Controleer TLS configuratie**

```bash
sudo -u mox /usr/local/bin/mox config test
testssl --quiet mail.publicvibes.nl:465
```

- [ ] **Step 5: Controleer open relay**

```bash
# Vanuit een externe machine (niet de VPS):
telnet mail.publicvibes.nl 25
EHLO test
MAIL FROM:<evil@example.com>
RCPT TO:<test@example.com>
```

Expected: `550 relay not permitted` of vergelijkbaar. Mox mag GEEN mail relayen voor externe domeinen.

- [ ] **Step 6: Voeg Mox toe aan CrowdSec**

```bash
sudo cscli collections install crowdsecurity/postfix  # SMTP log parsing
# Of als Mox specifieke log format: custom parser nodig
```

- [ ] **Step 7: Voeg Mox toe aan monitoring**

Controleer dat Falco de Mox binary detecteert en geen verdachte syscalls ziet:

```bash
sudo journalctl -u mox --since "1 hour ago" | tail -20
```

- [ ] **Step 8: Update egress filtering**

Mox moet outbound SMTP kunnen doen. Update de UFW regels als nodig:

```bash
# Mox outbound SMTP (naar andere mailservers)
# Dit wordt al afgehandeld via de host UFW — controleer:
sudo ufw status | grep -i out
```

Mox draait op de host (niet in Docker), dus DOCKER-USER chain is niet relevant. UFW regelt de egress.

---

## Fase 7: Documentatie

### Task 12: Documentatie bijwerken

- [ ] **Step 1: Update sovereign-stack service inventory**

Voeg Mox toe aan `docs/service-inventory.md`:

| Service | Container | Poorten | RAM | Doel |
|---------|-----------|---------|-----|------|
| Mox | host (systemd) | 25, 465, 587, 993 | ~512M | Mail voor publicvibes.nl |

- [ ] **Step 2: Update admin-guide**

Voeg Mox beheer commando's toe:
- `sudo systemctl status mox` — status
- `sudo journalctl -u mox -f` — logs
- `sudo -u mox mox config test` — configuratie test
- `sudo -u mox mox setaccountpassword <user>` — wachtwoord wijzigen

- [ ] **Step 3: Update Site Guardian README**

Voeg Mox vermelding toe aan dependencies tabel.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add Mox mail server for publicvibes.nl"
```

---

## Samenvatting DNS records

Alle records die moeten worden ingesteld bij de DNS provider voor publicvibes.nl:

| Type | Naam | Waarde |
|------|------|--------|
| MX | publicvibes.nl | 10 mail.publicvibes.nl |
| A | mail.publicvibes.nl | 89.167.107.143 |
| AAAA | mail.publicvibes.nl | 2a01:4f9:c014:34f6::1 |
| TXT | publicvibes.nl | v=spf1 a mx ip4:89.167.107.143 ip6:2a01:4f9:c014:34f6::1 -all |
| TXT | \<selector\>._domainkey.publicvibes.nl | v=DKIM1; k=ed25519; p=\<key\> (door Mox gegenereerd) |
| TXT | _dmarc.publicvibes.nl | v=DMARC1; p=reject; rua=mailto:dmarc-reports@publicvibes.nl; adkim=s; aspf=s |
| TXT | _mta-sts.publicvibes.nl | v=STSv1; id=20260320 |
| TXT | _smtp._tls.publicvibes.nl | v=TLSRPTv1; rua=mailto:tls-reports@publicvibes.nl |
| TLSA | _25._tcp.mail.publicvibes.nl | 3 1 1 \<hash\> (door Mox gegenereerd, vereist DNSSEC) |
| PTR | 89.167.107.143 | mail.publicvibes.nl (via Hetzner Console) |

**Vereisten:**
- DNSSEC moet actief zijn op publicvibes.nl voor DANE/TLSA
- PTR wijziging heeft impact op alle services op dit IP — overleg met jezelf of een apart IP nodig is
- Alle DKIM keys en TLSA hashes worden door Mox gegenereerd tijdens `mox quickstart`

---

## Risico's en aandachtspunten

1. **PTR record**: Het IP 89.167.107.143 wordt gedeeld met alle services. Het PTR record kan maar naar één hostname wijzen. Als het nu op de VPS hostname staat, moet je overwegen of `mail.publicvibes.nl` de PTR mag worden. Sommige mailservers controleren PTR.

2. **DNSSEC**: publicvibes.nl moet DNSSEC ondersteunen voor DANE/TLSA. Als de registrar geen DNSSEC biedt, werkt DANE niet. MTA-STS is dan het alternatief.

3. **IP reputatie**: Hetzner IP's hebben soms een lage mail-reputatie. Monitor na go-live of mail bij Gmail/Outlook aankomt. Overweeg het IP te registreren bij relevante allowlists.

4. **Mox updates**: Mox is v0.0.x — controleer regelmatig op nieuwe releases en herbouw de binary vanuit broncode.

5. **Backup**: Voeg Mox configuratie en DKIM keys toe aan het bestaande backup-script (`/opt/scripts/backup.sh`).
