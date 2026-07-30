#!/usr/bin/env bash
set -euo pipefail
umask 077

REPO_RAW_BASE="${FLUX_SETUP_RAW_BASE:-}"
COMPOSE_FILE="docker-compose.images.yml"
ENV_FILE=".env"
TRANSMISSION_SETTINGS="transmission-settings.json"

info() {
  printf '\n\033[1;36m%s\033[0m\n' "$1"
}

warn() {
  printf '\033[1;33m%s\033[0m\n' "$1"
}

fail() {
  printf '\033[1;31m%s\033[0m\n' "$1" >&2
  exit 1
}

prompt() {
  local label="$1"
  local default_value="${2:-}"
  local value
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " value
    printf '%s' "${value:-$default_value}"
  else
    read -r -p "$label: " value
    printf '%s' "$value"
  fi
}

prompt_secret() {
  local label="$1"
  local value
  read -r -s -p "$label: " value
  printf '\n' >&2
  printf '%s' "$value"
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 48
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 96
    printf '\n'
  fi
}

download_file() {
  local url="$1"
  local path="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$path"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$path" "$url"
  else
    fail "Install curl or wget, then rerun setup."
  fi
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    fail "Docker Compose is required. Install Docker with the compose plugin, then rerun setup."
  fi
}

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is required. Install Docker, then rerun setup."
  docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is not reachable. Start Docker, then rerun setup."
}

quote_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  value="${value//\`/\\\`}"
  printf '"%s"' "$value"
}

write_env_var() {
  local key="$1"
  local value="$2"
  printf '%s=%s\n' "$key" "$(quote_env_value "$value")" >>"$ENV_FILE"
}

ensure_support_files() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    info "Downloading $COMPOSE_FILE"
    download_file "$REPO_RAW_BASE/$COMPOSE_FILE" "$COMPOSE_FILE"
  fi

  if [[ ! -f "$TRANSMISSION_SETTINGS" ]]; then
    info "Downloading $TRANSMISSION_SETTINGS"
    download_file "$REPO_RAW_BASE/$TRANSMISSION_SETTINGS" "$TRANSMISSION_SETTINGS"
  fi
}

choose_public_origin() {
  printf '\nHow will you access Flux?\n'
  printf '  1) Local machine only, like http://localhost:4938\n'
  printf '  2) Home/LAN server, like http://192.168.1.50:4938\n'
  printf '  3) Public domain, like https://flux.example.com\n'

  local mode
  mode="$(prompt "Choose 1, 2, or 3" "1")"

  case "$mode" in
    1)
      FRONTEND_PORT="$(prompt "Frontend port" "4938")"
      BACKEND_PORT="$(prompt "Backend port" "6948")"
      PUBLIC_ORIGIN="http://localhost:${FRONTEND_PORT}"
      ;;
    2)
      FRONTEND_PORT="$(prompt "Frontend port" "4938")"
      BACKEND_PORT="$(prompt "Backend port" "6948")"
      local host
      host="$(prompt "LAN IP or hostname reachable by your devices" "$(hostname -I 2>/dev/null | awk '{print $1}')")"
      [[ -n "$host" ]] || fail "A LAN IP or hostname is required for home/LAN setup."
      PUBLIC_ORIGIN="http://${host}:${FRONTEND_PORT}"
      ;;
    3)
      FRONTEND_PORT="$(prompt "Frontend port behind your reverse proxy" "4938")"
      BACKEND_PORT="$(prompt "Backend port behind your reverse proxy" "6948")"
      PUBLIC_ORIGIN="$(prompt "Public Flux URL, including https://" "https://flux.example.com")"
      PUBLIC_ORIGIN="${PUBLIC_ORIGIN%/}"
      [[ "$PUBLIC_ORIGIN" == http://* || "$PUBLIC_ORIGIN" == https://* ]] || fail "Public URL must start with http:// or https://."
      ;;
    *)
      fail "Unknown setup choice: $mode"
      ;;
  esac
}

write_env() {
  if [[ -f "$ENV_FILE" ]]; then
    local overwrite
    overwrite="$(prompt "$ENV_FILE already exists. Overwrite it? Type yes to replace" "no")"
    [[ "$overwrite" == "yes" ]] || fail "Stopped without changing $ENV_FILE."
  fi

  POSTGRES_PASSWORD="$(prompt_secret "Postgres password (leave empty to generate)")"
  [[ -n "$POSTGRES_PASSWORD" ]] || POSTGRES_PASSWORD="$(generate_secret)"

  JWT_SECRET="$(prompt_secret "JWT secret (leave empty to generate)")"
  [[ -n "$JWT_SECRET" ]] || JWT_SECRET="$(generate_secret)"

  TMDB_API_KEY="$(prompt "TMDb v3 API key")"
  BOOTSTRAP_ADMIN_EMAIL="$(prompt "Initial admin email" "admin@example.com")"
  BOOTSTRAP_ADMIN_PASSWORD="$(prompt_secret "Initial admin password")"
  [[ -n "$BOOTSTRAP_ADMIN_PASSWORD" ]] || fail "Initial admin password is required."

  TRANSMISSION_USER="$(prompt "Transmission username" "admin")"
  TRANSMISSION_PASS="$(prompt_secret "Transmission password (leave empty to generate)")"
  [[ -n "$TRANSMISSION_PASS" ]] || TRANSMISSION_PASS="$(generate_secret)"
  [[ ${#TRANSMISSION_PASS} -ge 12 ]] || fail "Transmission password must be at least 12 characters."

  local default_image_tag=""
  if command -v git >/dev/null 2>&1; then
    local remote_sha
    remote_sha="$(git rev-parse HEAD 2>/dev/null || true)"
    if [[ ! "$remote_sha" =~ ^[0-9a-f]{40}$ ]]; then
      remote_sha="$(git ls-remote https://github.com/IDKDeadXD/Flux.git refs/heads/master 2>/dev/null | awk '{print $1}' || true)"
    fi
    if [[ "$remote_sha" =~ ^[0-9a-f]{40}$ ]]; then
      default_image_tag="sha-${remote_sha:0:12}"
      [[ -n "$REPO_RAW_BASE" ]] || REPO_RAW_BASE="https://raw.githubusercontent.com/IDKDeadXD/Flux/$remote_sha"
    fi
  fi
  FLUX_IMAGE_TAG="$(prompt "Immutable Flux image tag (sha-...)" "$default_image_tag")"
  [[ "$FLUX_IMAGE_TAG" =~ ^sha-[0-9a-f]{12}$ ]] || fail "Use an immutable image tag such as sha-0123456789ab."
  FLUX_IMAGE_PREFIX="$(prompt "Flux image prefix" "ghcr.io/idkdeadxd/flux")"

  local storage_root default_downloads default_extra
  storage_root="$(pwd)/storage"
  default_downloads="$storage_root/downloads"
  default_extra="$storage_root/extra"
  FLUX_DOWNLOADS_PATH="$(prompt "Downloads storage path" "$default_downloads")"
  FLUX_EXTRA_PATH="$(prompt "Extra media storage path" "$default_extra")"
  mkdir -p "$FLUX_DOWNLOADS_PATH" "$FLUX_EXTRA_PATH" releases/android

  : >"$ENV_FILE"
  write_env_var POSTGRES_USER "flux"
  write_env_var POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  write_env_var POSTGRES_DB "flux"
  write_env_var DATABASE_URL "postgresql://flux:$POSTGRES_PASSWORD@localhost:5432/flux?schema=public"
  write_env_var REDIS_URL "redis://localhost:6379"
  printf '\n' >>"$ENV_FILE"
  write_env_var JWT_SECRET "$JWT_SECRET"
  write_env_var JWT_EXPIRES_IN "7d"
  printf '\n' >>"$ENV_FILE"
  write_env_var TMDB_API_KEY "$TMDB_API_KEY"
  printf '\n' >>"$ENV_FILE"
  write_env_var BACKEND_PORT "$BACKEND_PORT"
  write_env_var FRONTEND_PORT "$FRONTEND_PORT"
  write_env_var FRONTEND_ORIGIN "$PUBLIC_ORIGIN"
  write_env_var PUBLIC_API_BASE_URL "$PUBLIC_ORIGIN"
  write_env_var NEXT_PUBLIC_API_BASE_URL ""
  write_env_var FLUX_INTERNAL_API_BASE_URL "http://127.0.0.1:$BACKEND_PORT"
  printf '\n' >>"$ENV_FILE"
  write_env_var MEDIA_ROOTS "/data/media,/data/extra"
  write_env_var MEDIA_ROOT "/data/media"
  write_env_var DOWNLOAD_ROOT "/data/downloads"
  write_env_var TRANSCODE_ROOT "/data/transcode"
  write_env_var CAST_SESSION_TTL_SECONDS "7200"
  write_env_var FLUX_SERVER_NAME "Flux"
  write_env_var FLUX_SERVER_VERSION "0.1.0"
  printf '\n' >>"$ENV_FILE"
  write_env_var TRANSMISSION_RPC_URL "http://localhost:9091/transmission/rpc"
  write_env_var TRANSMISSION_USER "$TRANSMISSION_USER"
  write_env_var TRANSMISSION_PASS "$TRANSMISSION_PASS"
  printf '\n' >>"$ENV_FILE"
  write_env_var FLUX_IMAGE_PREFIX "$FLUX_IMAGE_PREFIX"
  write_env_var FLUX_IMAGE_TAG "$FLUX_IMAGE_TAG"
  write_env_var FLUX_DOWNLOADS_PATH "$FLUX_DOWNLOADS_PATH"
  write_env_var FLUX_EXTRA_PATH "$FLUX_EXTRA_PATH"
  printf '\n' >>"$ENV_FILE"
  write_env_var BOOTSTRAP_ADMIN_EMAIL "$BOOTSTRAP_ADMIN_EMAIL"
  write_env_var BOOTSTRAP_ADMIN_PASSWORD "$BOOTSTRAP_ADMIN_PASSWORD"
  chmod 600 "$ENV_FILE"
}

main() {
  info "Flux image deployment setup"
  require_docker
  choose_public_origin
  write_env
  if [[ ! -f "$COMPOSE_FILE" || ! -f "$TRANSMISSION_SETTINGS" ]]; then
    [[ -n "$REPO_RAW_BASE" ]] || fail "Could not resolve an immutable source revision. Install git or set FLUX_SETUP_RAW_BASE to a commit-pinned raw URL."
  fi
  ensure_support_files

  info "Pulling Flux images"
  docker_compose -f "$COMPOSE_FILE" pull

  info "Starting Flux"
  docker_compose -f "$COMPOSE_FILE" up -d

  info "Waiting for the initial administrator to be created"
  local ready="false"
  for _ in $(seq 1 30); do
    if docker_compose -f "$COMPOSE_FILE" exec -T backend \
      node -e "fetch('http://127.0.0.1:${BACKEND_PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      ready="true"
      break
    fi
    sleep 2
  done
  if [[ "$ready" == "true" ]]; then
    sed -i 's/^BOOTSTRAP_ADMIN_EMAIL=.*/BOOTSTRAP_ADMIN_EMAIL=""/' "$ENV_FILE"
    sed -i 's/^BOOTSTRAP_ADMIN_PASSWORD=.*/BOOTSTRAP_ADMIN_PASSWORD=""/' "$ENV_FILE"
    info "Removed one-time bootstrap credentials from $ENV_FILE"
  else
    warn "Backend did not become ready; bootstrap credentials remain in $ENV_FILE for the next start."
  fi

  info "Setup complete"
  printf 'Flux should be reachable at: %s\n' "$PUBLIC_ORIGIN"
  printf 'Show service status with: docker compose -f %s ps\n' "$COMPOSE_FILE"
  printf 'Show backend logs with: docker compose -f %s logs -f backend\n' "$COMPOSE_FILE"
}

main "$@"
