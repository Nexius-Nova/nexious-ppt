#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_NAME="${APP_NAME:-nexious-ppt}"
PM2_APP_NAME="${PM2_APP_NAME:-nexious-ppt-api}"
DOMAIN="${DOMAIN:-nexious-ppt.xyz}"
APP_PORT="${APP_PORT:-3001}"
NGINX_PORT="${NGINX_PORT:-8081}"
STORAGE_ROOT="${STORAGE_ROOT:-/var/lib/nexious-ppt}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://${DOMAIN}}"
CORS_ORIGINS="${CORS_ORIGINS:-https://${DOMAIN}}"
PYTHON_VENV_DIR="${PYTHON_VENV_DIR:-.venv}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

run_sudo() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

render_nginx() {
  local app_dir="$1"
  sed \
    -e "s|\${NGINX_PORT}|${NGINX_PORT}|g" \
    -e "s|\${DOMAIN}|${DOMAIN}|g" \
    -e "s|\${APP_DIR}|${app_dir}|g" \
    -e "s|\${APP_PORT}|${APP_PORT}|g" \
    "${SCRIPT_DIR}/nginx.conf"
}

ensure_env_file() {
  if [ -f .env ]; then
    return 0
  fi

  cp .env.example .env
  sed -i \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    -e "s|^PORT=.*|PORT=${APP_PORT}|" \
    -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=${PUBLIC_BASE_URL}|" \
    -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=${CORS_ORIGINS}|" \
    -e "s|^VITE_API_URL=.*|VITE_API_URL=${PUBLIC_BASE_URL}|" \
    -e "s|^STORAGE_ROOT=.*|STORAGE_ROOT=${STORAGE_ROOT}|" \
    .env
  echo "已创建 .env，请补齐数据库、JWT、ENCRYPTION_KEY、模型、Redis、Resend 邮件等配置后重新运行部署脚本。"
  exit 1
}

install_nginx_conf() {
  local app_dir="$1"
  local tmp_nginx
  tmp_nginx="$(mktemp)"
  render_nginx "${app_dir}" > "${tmp_nginx}"
  run_sudo mv "${tmp_nginx}" "/etc/nginx/conf.d/${APP_NAME}.conf"
  run_sudo nginx -t
  run_sudo systemctl reload nginx
}

resolve_python_venv_dir() {
  local app_dir="$1"
  if [[ "${PYTHON_VENV_DIR}" = /* ]]; then
    echo "${PYTHON_VENV_DIR}"
  else
    echo "${app_dir}/${PYTHON_VENV_DIR}"
  fi
}

ensure_python_runtime() {
  local app_dir="$1"
  local venv_dir
  venv_dir="$(resolve_python_venv_dir "${app_dir}")"

  if command -v apt-get >/dev/null 2>&1; then
    echo "==> 安装 Python、文件解析、SVG/PPTX 导出系统依赖"
    run_sudo apt-get update
    run_sudo apt-get install -y \
      build-essential \
      pkg-config \
      pandoc \
      python3 \
      python3-dev \
      python3-pip \
      python3-venv \
      libcairo2 \
      libcairo2-dev \
      libpango-1.0-0 \
      libpango1.0-dev \
      libpangocairo-1.0-0 \
      libgdk-pixbuf-2.0-0 \
      libgdk-pixbuf-2.0-dev \
      libffi-dev \
      libxml2-dev \
      libxslt1-dev \
      zlib1g-dev \
      libjpeg-dev \
      libopenjp2-7 \
      libopenjp2-7-dev \
      shared-mime-info
  fi

  require_cmd python3

  if [ ! -x "${venv_dir}/bin/python" ]; then
    echo "==> 创建 Python 虚拟环境：${venv_dir}"
    python3 -m venv "${venv_dir}"
  fi

  echo "==> 安装 PPT 文件解析、网页转 Markdown、SVG 质量检查、公式渲染、动画 PPTX 导出依赖"
  "${venv_dir}/bin/python" -m pip install --upgrade pip
  "${venv_dir}/bin/python" -m pip install -r "${app_dir}/server/requirements.txt"

  export PYTHON_BIN="${venv_dir}/bin/python"
}

start_pm2() {
  if pm2 describe "${PM2_APP_NAME}" >/dev/null 2>&1; then
    PM2_APP_NAME="${PM2_APP_NAME}" PORT="${APP_PORT}" STORAGE_ROOT="${STORAGE_ROOT}" PYTHON_BIN="${PYTHON_BIN}" pm2 reload ecosystem.config.cjs --update-env
  else
    PM2_APP_NAME="${PM2_APP_NAME}" PORT="${APP_PORT}" STORAGE_ROOT="${STORAGE_ROOT}" PYTHON_BIN="${PYTHON_BIN}" pm2 start ecosystem.config.cjs --update-env
  fi
  pm2 save
  pm2 status
}

deploy_here() {
  local app_dir="${APP_DIR:-${SCRIPT_DIR}}"
  cd "${app_dir}"

  require_cmd pnpm
  require_cmd pm2
  require_cmd nginx

  echo "==> 本机部署目录：${app_dir}"
  echo "==> 持久化存储目录：${STORAGE_ROOT}"

  ensure_env_file

  run_sudo mkdir -p "${STORAGE_ROOT}" "${app_dir}/logs"
  if command -v sudo >/dev/null 2>&1; then
    run_sudo chown -R "$(id -u):$(id -g)" "${STORAGE_ROOT}" "${app_dir}/logs"
  fi

  corepack enable >/dev/null 2>&1 || true

  echo "==> 安装 Node 依赖"
  pnpm install --frozen-lockfile

  ensure_python_runtime "${app_dir}"

  echo "==> 构建前端"
  VITE_API_URL="${PUBLIC_BASE_URL}" pnpm build

  echo "==> 执行数据库迁移"
  pnpm run migrate

  echo "==> 写入并重载 Nginx"
  install_nginx_conf "${app_dir}"

  echo "==> 启动或重载 PM2"
  start_pm2

  echo "==> 部署完成"
  echo "Cloudflared ingress 请指向：http://localhost:${NGINX_PORT}"
  echo "验证：curl -I ${PUBLIC_BASE_URL} && curl ${PUBLIC_BASE_URL}/health"
}

deploy_remote() {
  local deploy_user="${DEPLOY_USER:-admin}"
  local deploy_host="${DEPLOY_HOST}"
  local deploy_port="${DEPLOY_PORT:-22}"
  local app_dir="${APP_DIR:-/www/nexious-ppt}"
  local ssh_target="${deploy_user}@${deploy_host}"
  local rsync_ssh="ssh -p ${deploy_port}"

  require_cmd pnpm
  require_cmd rsync
  require_cmd scp
  require_cmd ssh

  cd "${SCRIPT_DIR}"

  echo "==> 本地安装依赖并构建"
  pnpm install --frozen-lockfile
  VITE_API_URL="${PUBLIC_BASE_URL}" pnpm build

  echo "==> 准备服务器目录：${app_dir}"
  ssh -p "${deploy_port}" "${ssh_target}" "mkdir -p '${app_dir}'"

  echo "==> 同步项目文件"
  rsync -az --delete \
    --exclude='.git/' \
    --exclude='node_modules/' \
    --exclude='.venv/' \
    --exclude='.generated/' \
    --exclude='logs/' \
    --exclude='.env' \
    -e "${rsync_ssh}" \
    ./ "${ssh_target}:${app_dir}/"

  echo "==> 在服务器执行部署"
  ssh -p "${deploy_port}" "${ssh_target}" \
    "cd '${app_dir}' && APP_DIR='${app_dir}' APP_NAME='${APP_NAME}' PM2_APP_NAME='${PM2_APP_NAME}' DOMAIN='${DOMAIN}' APP_PORT='${APP_PORT}' NGINX_PORT='${NGINX_PORT}' STORAGE_ROOT='${STORAGE_ROOT}' PUBLIC_BASE_URL='${PUBLIC_BASE_URL}' CORS_ORIGINS='${CORS_ORIGINS}' PYTHON_VENV_DIR='${PYTHON_VENV_DIR}' bash deploy.sh"
}

if [ -n "${DEPLOY_HOST:-}" ]; then
  deploy_remote
else
  deploy_here
fi
