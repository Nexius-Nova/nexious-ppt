**最高优先级**
0. 添加账号功能，生成ppt必须登录，不同账号所有内容必须隔离，避免越权。在合适位置添加个人中心页面和功能。
1. **认证必须先收紧**  
   [server/routes/auth.ts](E:/demo/nexious-ppt/server/routes/auth.ts) 里无 token 或 token 无效时会回落到 `userId = 1`，这是高风险问题。生产环境应直接返回 `401`。

2. **API Key 路由必须绑定真实用户**  
   [server/routes/apiKeys.ts](E:/demo/nexious-ppt/server/routes/apiKeys.ts) 使用 `DEFAULT_USER_ID = 1`，所有用户都可能操作同一批密钥。建议接入统一 `authMiddleware`，所有查询、修改、删除都加 `user_id` 约束。

3. **密钥加密方案需要升级**  
   API Key 属于敏感数据，建议改为 AES-256-GCM、随机 IV、保存 auth tag，并强制生产环境配置 `ENCRYPTION_KEY`。JWT 默认密钥也应禁止生产环境启动。

4. **事务实现需要修正**  
   [server/db/connection.ts](E:/demo/nexious-ppt/server/db/connection.ts) 当前 `beginTransaction`、`commit`、`rollback` 获取的不是同一个连接，事务实际上不可靠。涉及“设置默认 API Key”“模板保存”“项目状态切换”等操作时，应使用同一 connection 执行完整事务。

5. **生成任务应服务端持久化**  
   前端 [src/stores/agentStore.ts](E:/demo/nexious-ppt/src/stores/agentStore.ts) 已经有运行 token、防跨项目等逻辑，但后端缺少真正的任务表、取消、恢复、进度记录。建议引入 `generation_jobs`，记录阶段、进度、错误、重试次数和当前项目版本。

6. **API 封装需要统一超时、取消和错误提示**  
   [src/services/api.ts](E:/demo/nexious-ppt/src/services/api.ts) 目前 fetch 封装较薄，建议增加 `AbortController`、请求超时、401 统一跳转、非 JSON 响应兜底、请求 ID，以及统一错误结构 `{ code, message, details }`。

7. **项目名、模板名唯一性要靠数据库兜底**  
   前端校验只能提升体验，最终必须有服务端校验和数据库唯一索引。建议项目名按 `user_id + title` 唯一，模板名按 `user_id + name` 或全局模板范围唯一，并处理历史重复数据迁移。

8. **全局消息提示要统一入口**  
   成功、失败、加载中、重试、撤销、查看详情应由统一 toast/notification 服务处理，避免页面各写各的。网络错误、业务错误、权限错误也应有一致文案和交互。

**功能流程**
- 新建 PPT 到导出的流程可以更清晰：输入内容、生成大纲、生成图片、生成页面、预览导出，每一步给明确主按钮、阻塞原因和失败恢复入口。
- 进入项目后再显示 AI PPT 助手是正确方向，建议助手顶部明确显示“当前仅操作：项目名称”，执行改写、换图、重排、保存前给预览和确认。
- “保存为模板”建议支持三态：未保存、已保存、模板已过期。项目内容修改后，应提示“当前 PPT 已不同于模板，可更新模板”。
- 模板广场建议增加模板版本、最近使用、从当前 PPT 更新已有模板、复制模板、删除前影响提示。
- 配置页建议增加模型连通性测试、默认文本模型/图片模型缺失提醒，并在生成前做前置检查。

**并发稳定性**
- 图片生成适合可控并发，比如每次 2-3 页并行，失败页单独重试，不要让一个页面失败拖垮整套 PPT。
- 项目保存建议引入版本号或 `updated_at` 乐观锁，避免多个标签页、自动保存和手动保存互相覆盖。
- `syncToProject` 这类保存入口应收敛成队列：防抖、合并 patch、失败重试、冲突提示。
- 长任务建议后端返回 job id，前端轮询或 SSE 订阅状态，刷新页面后仍能恢复进度。

**安全**
- `express.json({ limit: '150mb' })` 风险偏高，建议按接口设置体积限制。文本接口小限制，图片/文件走上传接口。
- `.generated/images` 静态暴露应做用户隔离或签名访问，避免通过路径猜测访问他人生成图。
- 增加 `helmet`、rate limit、登录失败限制、CORS 白名单配置和生产环境安全检查。
- 所有写接口建议用 schema 校验，比如 zod，避免任意 JSON 写入 `settings/state`。
- 日志不要输出完整 API Key、token、生成 prompt 中的敏感内容。

**样式布局**
- 当前控制台式产品方向是对的，建议继续保持克制、密集、工具化，不要做营销页风格。
- 新增样式避免渐变色，优先使用现有主题变量和 [src/components](E:/demo/nexious-ppt/src/components) 内 UI 组件。
- 重复样式应组件化：弹窗、空状态、确认删除、状态标签、操作按钮、表单错误、卡片工具栏。
- 卡片圆角建议统一到 8px 左右，按钮、输入框、列表项保持一致密度。
- 移动端重点检查：侧边栏收起、项目阶段条横向滚动、右侧日志/助手改为抽屉，避免挤压主编辑区。
- 模板编辑和项目编辑这类复杂表单，建议用抽屉或全屏编辑页，减少嵌套卡片和多层滚动。

**工程质量**
- [src/stores/agentStore.ts](E:/demo/nexious-ppt/src/stores/agentStore.ts) 过大，建议拆成 `projectStore`、`workflowStore`、`templateStore`、`exportStore`，复杂逻辑下沉到 composables/services。
- 建议补测试：认证/API Key 路由测试、项目/模板唯一性测试、生成流程 store 单测、关键页面 Playwright E2E。
- 构建体积可优化：`pptxgenjs`、`jszip`、导出相关模块懒加载，路由级动态 import。
- README 和部署文档应更新到当前 Express + MySQL 架构，补充环境变量、迁移、启动、构建和生产安全检查。
- 对 `settings/state` 建议定义版本化 schema，后续升级时做 migration，避免旧项目打不开。
