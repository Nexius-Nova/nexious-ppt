type ErrorLike = {
  message?: string;
  status?: number;
  code?: string;
};

function normalizeErrorInput(error: unknown): ErrorLike {
  if (!error) return {};
  if (typeof error === 'string') return { message: error };
  if (error instanceof Error) return { message: error.message };
  if (typeof error === 'object') return error as ErrorLike;
  return { message: String(error) };
}

export function translateErrorMessage(error: unknown, fallback = '操作失败，请稍后重试'): string {
  const { message = '', status, code } = normalizeErrorInput(error);
  const text = String(message || '').trim();
  const lower = text.toLowerCase();

  if (!text) return fallback;
  if (status === 401 || code === 'UNAUTHORIZED' || /unauthorized|jwt|token expired|invalid token/i.test(text)) {
    return '登录状态已失效，请重新登录';
  }
  if (status === 403 || /forbidden|permission denied|access denied/i.test(text)) {
    return '没有权限执行该操作';
  }
  if (status === 404 || /not found/i.test(text)) {
    return '资源不存在或无权访问';
  }
  if (status === 413 || /payload too large|request entity too large/i.test(text)) {
    return '请求内容过大，请减少内容后重试';
  }
  if (status === 429 || /too many requests|rate limit/i.test(text)) {
    return '操作过于频繁，请稍后再试';
  }

  const rules: Array<[RegExp, string]> = [
    [/failed to fetch|networkerror|load failed|network request failed/i, '网络连接失败，请检查网络或服务是否可用'],
    [/request timeout|timeout|timed out|aborterror|the operation was aborted/i, '请求超时，请稍后重试'],
    [/request failed|http error|bad request/i, '请求失败，请检查后重试'],
    [/internal server error|server error/i, '服务器内部错误，请稍后重试'],
    [/unknown error/i, '未知错误，请稍后重试'],
    [/no reader available/i, '无法读取服务器响应流，请稍后重试'],
    [/failed to proxy image/i, '图片代理加载失败，请稍后重试'],
    [/api error/i, '模型服务调用失败，请检查模型配置或稍后重试'],
    [/invalid encrypted data|decrypt|decryption/i, '配置解密失败，请重新配置密钥'],

    [/skill package failed security validation/i, 'Skill 包未通过安全检查'],
    [/skill package is required/i, '请上传 Skill 包'],
    [/skill package is empty/i, 'Skill 包为空'],
    [/skill package must be smaller than 20mb/i, 'Skill 包大小不能超过 20MB'],
    [/skill package contains no usable files/i, 'Skill 包内没有可用文件'],
    [/skill package not found/i, 'Skill 包不存在或无权访问'],
    [/skill not found/i, 'Skill 不存在或无权访问'],
    [/skill name is required/i, 'Skill 名称不能为空'],
    [/skill runtime initialization failed/i, 'Skill 运行环境初始化失败'],
    [/skill runtime is still initializing/i, 'Skill 运行环境仍在初始化，请稍后再试'],
    [/skill run failed/i, 'Skill 运行失败'],
    [/skill package scan failed/i, 'Skill 包检查失败'],
    [/skill entry must be inside package directory/i, 'Skill 入口必须位于包目录内'],
    [/skill\.md is required in the skill package/i, 'Skill 包中必须包含 SKILL.md'],
    [/invalid package path/i, 'Skill 包内存在非法文件路径'],
    [/file too large in package/i, 'Skill 包内存在过大的文件'],
    [/process timeout/i, 'Skill 执行超时'],
    [/process exited with code/i, 'Skill 进程执行失败'],
    [/missing required dependency|modulenotfounderror|importerror/i, '缺少运行依赖，请检查 Skill 包配置'],

    [/failed to fetch skills/i, '获取 Skill 列表失败'],
    [/failed to fetch skill runs/i, '获取 Skill 运行记录失败'],
    [/failed to fetch skill/i, '获取 Skill 失败'],
    [/failed to load skill package/i, '加载 Skill 包失败'],
    [/failed to parse skill package/i, '解析 Skill 包失败'],
    [/failed to upload skill package/i, '上传 Skill 包失败'],
    [/failed to create skill/i, '创建 Skill 失败'],
    [/failed to update skill/i, '更新 Skill 失败'],
    [/failed to reinstall skill/i, '重新初始化 Skill 失败'],
    [/failed to test skill/i, '测试 Skill 失败'],
    [/failed to run skill/i, '运行 Skill 失败'],
    [/failed to delete skill/i, '删除 Skill 失败'],
    [/failed to toggle skill/i, '切换 Skill 状态失败'],
  ];

  for (const [pattern, translated] of rules) {
    if (pattern.test(text)) return translated;
  }

  const hasAsciiLetter = /[A-Za-z]/.test(text);
  const hasChinese = /[\u4e00-\u9fff]/.test(text);
  if (hasAsciiLetter && !hasChinese && lower.length <= 120) {
    return fallback;
  }

  return text;
}
