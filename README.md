# Nexious PPT Agent

面向个人使用的 AI PPT 自动生成控制台，按照 `nexiou-ppt需求文档.md` 实现前端 MVP。项目使用 Vue 3、Pinia、Vue Router 和自定义 UI 组件库，视觉参考 OpenClaw WebUI 的深色三栏控制台布局，并严格避免渐变色。

## 功能范围

- 用户输入：主题、正文、资料文件挂载。
- 文本分析：生成可编辑 PPT 大纲、页面要点和演讲稿。
- 图像生成：按页生成候选插图，并支持选择替换。
- PPT 排版：16:9 预览画布、模板参数、拖拽占位。
- Skill 系统：内置讲稿生成、数据图表、设计优化 Skill，可启停。
- 预览微调：实时同步大纲、图像、讲稿与版式。
- 导出入口：PPTX 已接入 `pptxgenjs` 生成真实文件；PDF 当前保留为任务接口，适合后续接后端转换或浏览器打印。

## 开发命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
```

## 目录约定

- `src/components/ui`：项目 UI 基础组件，统一管理按钮、卡片、输入、选择器、徽标。
- `src/components/layout`：应用框架与顶部区域。
- `src/components/workflow`：流程条与 Skill 面板。
- `src/components/panels`：输入、参数、图像、大纲、日志面板。
- `src/components/preview`：PPT 预览与导出入口。
- `src/stores`：Pinia 工作流状态。
- `src/services`：Agent 服务接口，后续替换真实 API、WebSocket、PPT 生成服务。
- `src/styles`：主题令牌与基础样式。

## 后续扩展

- 将 `src/services/agentSimulator.ts` 替换为真实文本生成、图像生成和导出 API。
- 增加 Express.js 或 Next.js API Routes，并接入 `pptxgenjs`。
- 增加 MySQL、S3 或本地文件存储。
- 将 Skill 注册、执行、配置抽象为插件协议。
