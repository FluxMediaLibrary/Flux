#!/usr/bin/env bash
# =============================================================================
# Flux — domain setup script
#
# Usage:  ./domainsetup.sh example.com
#
# Updates .env with the domain for CORS, invite links, and the API base URL.
# Optionally generates an nginx reverse-proxy config so:
#   https://example.com      → frontend  (localhost:4938)
#   https://example.com/api  → backend   (localhost:6948)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

DOMAIN="${1:-}"

if [ -z "$DOMAIN" ]; then
  echo -e "${RED}Error:${NC} No domain provided."
  echo "Usage: ./domainsetup.sh example.com"
  exit 1
fi

# Strip protocol + trailing slash if the user pastes a full URL
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%/}"

ENV_FILE=".env"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_PATH="$SCRIPT_DIR/$ENV_FILE"

if [ ! -f "$ENV_PATH" ]; then
  echo -e "${RED}Error:${NC} $ENV_FILE not found at $ENV_PATH."
  echo "Copy .env.example to .env first:  cp .env.example .env"
  exit 1
fi

echo -e "${CYAN}Setting up domain:${NC} $DOMAIN"
echo ""

# ─── 1. Update .env ───────────────────────────────────────────────────────────
echo -e "Updating ${CYAN}$ENV_FILE${NC} ..."

# Use a temp file to avoid sed -i portability issues between macOS / Linux.
TMP="$(mktemp)"

while IFS= read -r line; do
  case "$line" in
    FRONTEND_ORIGIN=*)
      echo "FRONTEND_ORIGIN=https://$DOMAIN"
      ;;
    NEXT_PUBLIC_API_BASE_URL=*)
      echo "NEXT_PUBLIC_API_BASE_URL=https://$DOMAIN"
      ;;
    *)
      echo "$line"
      ;;
  esac
done < "$ENV_PATH" > "$TMP"

mv "$TMP" "$ENV_PATH"

echo -e "  ${GREEN}FRONTEND_ORIGIN=https://$DOMAIN${NC}"
echo -e "  ${GREEN}NEXT_PUBLIC_API_BASE_URL=https://$DOMAIN/api${NC}"
echo ""

# ─── 2. Generate nginx config ─────────────────────────────────────────────────
NGINX_FILE="nginx-$DOMAIN.conf"

cat > "$NGINX_FILE" << NGINXEOF
# Flux — nginx reverse proxy for $DOMAIN
#
# Place this in /etc/nginx/sites-available/$DOMAIN, then:
#   ln -s /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
#   nginx -t && systemctl reload nginx
#
# Certbot (SSL) — run after DNS is pointing:
#   certbot --nginx -d $DOMAIN

server {
    listen 80;
    server_name $DOMAIN;

    # Flux frontend and private API proxy
    location / {
        proxy_pass http://127.0.0.1:4938;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
        proxy_read_timeout 86400;
    }

    # Backend is bound to host loopback only, so nginx can serve API and media
    # without making the Fastify port publicly reachable.
    location /api/ {
        proxy_pass http://127.0.0.1:6948;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 10M;
        proxy_read_timeout 86400;
    }

    location /health {
        proxy_pass http://127.0.0.1:6948;
    }

}
NGINXEOF

echo -e "Generated ${CYAN}$NGINX_FILE${NC}"
echo ""

# ─── 3. Next steps ────────────────────────────────────────────────────────────
echo -e "${GREEN}Done.${NC} Next steps:"
echo ""
echo "  1. Point DNS for $DOMAIN to this server's IP"
echo "  2. Set up nginx:"
echo "     sudo cp $NGINX_FILE /etc/nginx/sites-available/$DOMAIN"
echo "     sudo ln -s /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo ""
echo "  3. Get SSL:"
echo "     sudo certbot --nginx -d $DOMAIN"
echo ""
echo "  4. Restart Flux after changing its public origin:"
echo "     docker compose up -d --build frontend"
echo ""
echo "  The backend picks up FRONTEND_ORIGIN at startup — restart it too:"
echo "     docker compose up -d --build backend"
echo ""
echo "  Or rebuild everything:"
echo "     docker compose up -d --build"
