#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-nexious-ppt}"
PM2_APP_NAME="${PM2_APP_NAME:-nexious-ppt-api}"
DEPLOY_USER="${DEPLOY_USER:-admin}"
DEPLOY_HOST="${DEPLOY_HOST:?请设置 DEPLOY_HOST，例如 DEPLOY_HOST=1.2.3.4}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
APP_DIR="${APP_DIR:-/www/nexious-ppt}"
DOMAIN="${DOMAIN:-nexious-ppt.xyz}"
APP_PORT="${APP_PORT:-3001}"
NGINX_PORT="${NGINX_PORT:-8081}"
STORAGE_ROOT="${STORAGE_ROOT:-/var/lib/nexious-ppt}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"
CORS_ORIGINS="${CORS_ORIGINS:-https://${DOMAIN}}"

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_OPTS=(-p "${DEPLOY_PORT}")
RSYNC_SSH="ssh -p ${DEPLOY_PORT}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

render_nginx() {
  sed \
    -e "s|\${NGINX_PORT}|${NGINX_PORT}|g" \
    -e "s|\${DOMAIN}|${DOMAIN}|g" \
    -e "s|\${APP_DIR}|${APP_DIR}|g" \
    -e "s|\${APP_PORT}|${APP_PORT}|g" \
    nginx.conf
}

require_cmd pnpm
require_cmd rsync
require_cmd scp
require_cmd ssh

echo "==> 本地安装依赖并构建"
pnpm install --frozen-lockfile
VITE_API_URL="${PUBLIC_BASE_URL}" pnpm build

echo "==> 准备服务器目录：${APP_DIR}"
ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" "mkdir -p '${APP_DIR}' '${STORAGE_ROOT}' '${APP_DIR}/logs'"

echo "==> 同步项目文件"
rsync -az --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.generated/' \
  --exclude='logs/' \
  --exclude='.env' \
  -e "${RSYNC_SSH}" \
  ./ "${SSH_TARGET}:${APP_DIR}/"

echo "==> 写入 Nginx 配置"
tmp_nginx="$(mktemp)"
render_nginx > "${tmp_nginx}"
scp -P "${DEPLOY_PORT}" "${tmp_nginx}" "${SSH_TARGET}:/tmp/${APP_NAME}.nginx.conf"
rm -f "${tmp_nginx}"

ssh "${SSH_OPTS[@]}" "${SSH_TARGET}" bash -s <<EOF
set -Eeuo pipefail
cd '${APP_DIR}'

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i \
    -e 's|^NODE_ENV=.*|NODE_ENV=production|' \
    -e 's|^PORT=.*|PORT=${APP_PORT}|' \
    -e 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${PUBLIC_BASE_URL}|' \
    -e 's|^CORS_ORIGINS=.*|CORS_ORIGINS=${CORS_ORIGINS}|' \
    -e 's|^VITE_API_URL=.*|VITE_API_URL=${PUBLIC_BASE_URL}|' \
    -e 's|^STORAGE_ROOT=.*|STORAGE_ROOT=${STORAGE_ROOT}|' \
    .env
  echo '已创建 .env，请补齐数据库、JWT、ENCRYPTION_KEY、模型和邮件配置后重新运行部署脚本。'
  exit 1
fi

mkdir -p '${STORAGE_ROOT}' logs
corepack enable >/dev/null 2>&1 || true
pnpm install --prod=false --frozen-lockfile
pnpm run migrate

if command -v sudo >/dev/null 2>&1; then
  sudo mv /tmp/${APP_NAME}.nginx.conf /etc/nginx/conf.d/${APP_NAME}.conf
  sudo nginx -t
  sudo systemctl reload nginx
else
  mv /tmp/${APP_NAME}.nginx.conf /etc/nginx/conf.d/${APP_NAME}.conf
  nginx -t
  systemctl reload nginx
fi

if pm2 describe '${PM2_APP_NAME}' >/dev/null 2>&1; then
  PM2_APP_NAME='${PM2_APP_NAME}' PORT='${APP_PORT}' STORAGE_ROOT='${STORAGE_ROOT}' pm2 reload ecosystem.config.cjs --update-env
else
  PM2_APP_NAME='${PM2_APP_NAME}' PORT='${APP_PORT}' STORAGE_ROOT='${STORAGE_ROOT}' pm2 start ecosystem.config.cjs --update-env
fi

pm2 save
pm2 status
EOF

echo "==> 部署完成"
echo "Cloudflared ingress 请指向：http://localhost:${NGINX_PORT}"
echo "验证：curl -I ${PUBLIC_BASE_URL} && curl ${PUBLIC_BASE_URL}/health"
