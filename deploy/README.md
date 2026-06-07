# Nexious PPT 部署说明

## 前置条件

服务器需要安装：

- Node.js 20+
- pnpm
- pm2
- nginx
- rsync

Cloudflare Tunnel 指向 Nginx 本地端口，例如：

```yaml
  - hostname: nexious-ppt.xyz
    service: http://localhost:8081
```

## 一键部署

在本地项目根目录执行：

```bash
DEPLOY_HOST=你的服务器IP \
DEPLOY_USER=admin \
APP_DIR=/www/nexious-ppt \
DOMAIN=nexious-ppt.xyz \
APP_PORT=3001 \
NGINX_PORT=8081 \
STORAGE_ROOT=/var/lib/nexious-ppt \
bash deploy/deploy.sh
```

首次部署时脚本会在服务器创建 `.env` 并停止，请先补齐数据库、JWT、ENCRYPTION_KEY、模型和邮件配置，再重新执行部署脚本。

## 关键环境变量

```env
NODE_ENV=production
PORT=3001
PUBLIC_BASE_URL=https://nexious-ppt.xyz
CORS_ORIGINS=https://nexious-ppt.xyz
VITE_API_URL=https://nexious-ppt.xyz
STORAGE_ROOT=/var/lib/nexious-ppt
```

`STORAGE_ROOT` 是持久化存储根路径，图片、头像、Skill 包、导出文件和 PPT 快照都会放在这个目录下。生产环境建议使用绝对路径，不要放在项目目录里。

## 验证

```bash
curl -I https://nexious-ppt.xyz
curl https://nexious-ppt.xyz/health
pm2 status
pm2 logs nexious-ppt-api --lines 80
```
