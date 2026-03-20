#!/bin/bash
set -euo pipefail

SERVER="ralph@100.64.0.2"
REMOTE_DIR="/opt/siteguardian"
SSH_KEY="$HOME/.ssh/id_ed25519"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ">>> Site Guardian deploy naar vps-001..."

# 1. Build production image locally
echo ">>> Docker image bouwen..."
cd "$SCRIPT_DIR"
docker build -t siteguardian-app:latest -f Dockerfile .
docker save siteguardian-app:latest | gzip > /tmp/siteguardian-app.tar.gz

echo ">>> Image uploaden naar VPS (~150MB)..."
scp -i "$SSH_KEY" /tmp/siteguardian-app.tar.gz "$SERVER:/tmp/"

echo ">>> Remote setup..."
ssh -i "$SSH_KEY" "$SERVER" bash -s << 'REMOTE'
set -euo pipefail

# Create stack directory
sudo mkdir -p /opt/siteguardian/secrets
sudo chmod 700 /opt/siteguardian/secrets

# Load image
echo ">>> Docker image laden..."
sudo docker load < /tmp/siteguardian-app.tar.gz
rm /tmp/siteguardian-app.tar.gz

# Create network if not exists
sudo docker network create net-fe-siteguardian 2>/dev/null || true

echo ">>> Setup klaar"
REMOTE

# 2. Upload compose + config
echo ">>> Configuratie uploaden..."
scp -i "$SSH_KEY" "$SCRIPT_DIR/docker-compose.prod.yml" "$SERVER:/tmp/docker-compose.yml"
ssh -i "$SSH_KEY" "$SERVER" "sudo mv /tmp/docker-compose.yml /opt/siteguardian/docker-compose.yml"

# 3. Upload prisma schema
scp -i "$SSH_KEY" -r "$SCRIPT_DIR/prisma" "$SERVER:/tmp/prisma"
ssh -i "$SSH_KEY" "$SERVER" "sudo cp -r /tmp/prisma /opt/siteguardian/ && rm -rf /tmp/prisma"

echo ">>> Deploy klaar!"
echo ""
echo "Volgende stappen op de VPS:"
echo "  1. Secrets aanmaken in /opt/siteguardian/secrets/"
echo "  2. DNS A-record: siteguardian.publicvibes.nl -> 89.167.107.143"
echo "  3. cd /opt/siteguardian && sudo docker compose up -d"
echo "  4. sudo docker compose logs -f"

# Cleanup
rm -f /tmp/siteguardian-app.tar.gz
