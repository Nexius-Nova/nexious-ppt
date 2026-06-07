# Nexious PPT

Nexious PPT 是一个面向个人和小团队的 AI PPT 生成工作台。前端使用 Vue 3、Pinia、Vue Router 和项目内自定义 UI 组件，服务端使用 Express、MySQL、Redis/BullMQ、PM2 与 Nginx 部署。系统支持大纲生成、逐页 SVG 生成、图片生成、Skill 包管理、可编辑 PPTX 导出和工作流状态恢复。

## 功能

- 登录、注册、图片行为验证码、邮箱验证码占位/扩展入口。
- PPT 输入页：主题、资料内容、模板、Skill、生成参数。
- AI 工作流：大纲流式输出、逐页生成、逐图显示、运行日志。
- 图片与 SVG 资源：私有资源代理、生成图片持久化、SVG 图片导出内联。
- Skill 管理：上传、预览、安全检查、初始化、运行、查看包内容。
- 模板管理：PPTX 导入预览、模板保存、模板广场。
- 导出：后端生成可编辑 PPTX，默认不添加动画，除非用户明确启用。

## 技术栈

- 前端：Vue 3、TypeScript、Pinia、Vue Router、Vite。
- 服务端：Express、TypeScript、MySQL、Redis/BullMQ。
- 部署：Nginx、PM2、Cloudflare Tunnel。
- 包管理器：pnpm。

## 本地开发

```bash
pnpm install
cp .env.example .env
pnpm run init-db
pnpm dev
```

常用命令：

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm run migrate
pnpm run cleanup-generated
```

## 环境变量

核心配置放在 `.env`：

```env
NODE_ENV=development
PORT=3001
PUBLIC_BASE_URL=http://localhost:3001
CORS_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:3001
STORAGE_ROOT=.generated

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=nexious-ppt

REDIS_URL=redis://localhost:6379
QUEUE_DRIVER=redis

JWT_SECRET=change-this
ENCRYPTION_KEY=change-this-32-character-key
```

`STORAGE_ROOT` 是服务端持久化存储根路径。生成图片、头像、Skill 包、导出文件、PPT 快照都会写入该目录。生产环境建议使用绝对路径，例如：

```env
STORAGE_ROOT=/var/lib/nexious-ppt
```

可编辑 PPTX 导出依赖 Python 运行时。部署脚本会自动创建 `.venv` 并安装 [server/requirements.txt](server/requirements.txt)，PM2 会通过 `PYTHON_BIN` 使用该虚拟环境：

```env
PYTHON_BIN=/home/admin/nexious-ppt/.venv/bin/python
```

## 数据库初始化

初始化脚本在 [database/init.sql](database/init.sql)。

该脚本只创建表结构，并为**已有用户**补充 `run_configs` 默认运行配置。它不会创建测试用户，也不会覆盖用户已修改的配置，可重复执行。

```bash
pnpm run init-db
pnpm run migrate
```

## Redis 建议

项目使用 Redis 支撑验证码限流、邮箱验证码和生成队列。生产环境建议启用 Redis：

```env
REDIS_URL=redis://localhost:6379
QUEUE_DRIVER=redis
REDIS_QUEUE_PREFIX=nexious:ppt
```

是否使用 Docker：

- 单台阿里云 ECS、快速部署：建议用 Docker 跑 Redis，隔离好、升级和迁移方便。
- 已经有阿里云 Redis/Tair：优先用托管 Redis，稳定性和备份更好。
- 服务器资源很紧或不想引入 Docker：可以用系统包安装 Redis，但要注意版本、配置和安全加固。

如果使用 Docker，建议只绑定本机，不要开放公网端口：

```bash
docker run -d \
  --name nexious-ppt-redis \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  -v /var/lib/nexious-ppt/redis:/data \
  redis:7-alpine \
  redis-server --appendonly yes --maxmemory-policy noeviction
```

BullMQ 更推荐 `maxmemory-policy noeviction`。如果 Redis 设置了会驱逐 key 的策略，队列可能出现任务状态丢失。

## 云端部署

项目已提供：

- [ecosystem.config.cjs](ecosystem.config.cjs)：PM2 配置。
- [nginx.conf](nginx.conf)：Nginx 模板。
- [deploy.sh](deploy.sh)：一键部署脚本。

在服务器项目目录中直接执行：

```bash
bash deploy.sh
```

也可以从本地电脑推送部署：

```bash
DEPLOY_HOST=你的服务器IP \
DEPLOY_USER=admin \
APP_DIR=/www/nexious-ppt \
DOMAIN=nexious-ppt.xyz \
APP_PORT=3001 \
NGINX_PORT=8081 \
STORAGE_ROOT=/var/lib/nexious-ppt \
bash deploy.sh
```

首次部署时脚本会创建 `.env` 并停止。补齐数据库、JWT、`ENCRYPTION_KEY`、模型和邮件配置后，再执行一次部署脚本。

Cloudflare Tunnel ingress 示例：

```yaml
ingress:
  - hostname: nexious-ppt.xyz
    service: http://localhost:8081
  - service: http_status:404
```

部署后验证：

```bash
curl -I https://nexious-ppt.xyz
curl https://nexious-ppt.xyz/health
pm2 status
pm2 logs nexious-ppt-api --lines 80
```

如果导出时报 `from svg_to_pptx...`、`No module named pptx`、`No module named PIL` 等 Python 导入错误，先在服务器重新执行：

```bash
cd ~/nexious-ppt
bash deploy.sh
.venv/bin/python - <<'PY'
import sys
sys.path.insert(0, "server/vendor")
from svg_to_pptx.pptx_builder import create_pptx_with_native_svg
print("python pptx exporter deps ok")
PY
pm2 restart nexious-ppt-api --update-env
```

## 目录

- `src/components/ui`：项目 UI 基础组件。
- `src/components/pages`：主要业务页面。
- `src/components/panels`：工作流面板、输入面板、导出面板。
- `src/stores`：Pinia 状态。
- `src/services`：前端 API 与渲染服务。
- `server/routes`：后端 API 路由。
- `server/services`：生成队列、模型选择、Skill 包服务。
- `server/engine`：PPT/SVG 生成与导出核心逻辑。
- `database`：数据库初始化脚本。
- `deploy`：部署脚本和 Nginx 配置。

## 注意事项

- 生产环境不要使用 `pnpm dev`，前端使用 `pnpm build` 产物，后端由 PM2 启动。
- 不要把 `.env`、`STORAGE_ROOT`、生成文件目录提交到仓库。
- `PUBLIC_BASE_URL`、`VITE_API_URL`、`CORS_ORIGINS` 生产环境应保持同域，例如 `https://nexious-ppt.xyz`。
- Cloudflare Tunnel 指向 Nginx 本地端口，不建议直接指向 Vite 开发服务。
