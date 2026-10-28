# 项目详情页：点击项目名回显最近一次部署日志摘要

日期：2026-10-28
状态：已与用户确认

## 背景与目标

当前项目中，用户不启动部署就看不到某项目上一次的部署结果：日志路径只在完成卡片出现一次（`a71865a` 已支持点击文件名在编辑器打开），返回列表后无处可查。

目标：项目列表卡片中的**项目名称**（`webview/app.js` 第 33 行 `.name`）变为可点击（hover 下划线 + 小手光标），点击进入新的**详情视图**，回显该项目最近一次部署的结构化摘要，并提供打开完整日志、再次部署的入口。

## 已确认的产品决策

1. **详情页形态**：结构化摘要页（结果、时间、分支、目标、摘要），不在 webview 内回放全文日志；全文交给编辑器打开，与 `openLogFile` 形成"详情页看结论、编辑器看全文"的分工。
2. **数据源**：只解析日志文件头，不新增结构化部署记录存储。步骤级时间线（每步 ✅/❌/耗时）当前**没有落盘**（`onStep` 只推送前端，日志文件仅含 `onLog` 文本行 + 头部 8 行），本设计不涉及。
3. **实现方案**：后端（`WebviewProvider`）负责定位文件并解析头部为结构化 JSON 返回；前端只做渲染。读写同侧——头部格式本来就是 `finalizeLog` 写的，格式演化时好同步。

## 前端设计（webview/）

### 项目名可点击

- `style.css`：`.project-card .name` 增加 `cursor: pointer`，hover 时 `text-decoration: underline` 并提亮颜色，样式语言对齐现有 `.log-link`。
- `.name` 加 `title="查看最近一次部署记录"`。
- `renderProjectList()` 模板中 `.name` 绑定 `onclick="showDetail('${p.id}')"`（与编辑/删除/部署按钮的 inline 绑定方式一致；innerHTML 重建后天然生效，拖拽重渲染无碍）。
- 仅 `.name` 行可点，`.meta` 区域维持现状。浏览器在 drag 后不派发 click，与整卡拖拽排序不冲突。

### 新视图 viewDetail

- `index.html` 新增 `<div id="viewDetail" class="hidden">` 节点（现有视图容器只有 3 个：`#viewList` / `#viewForm` / `#viewProgress`，完成卡片内嵌在进度页中，没有独立的 viewComplete 节点）。
- **`showView()` 的选择器列表必须补上 `#viewDetail`**（当前只隐藏 `#viewList, #viewForm, #viewProgress`，不改会切不干净）。
- 布局自上而下：
  1. 头部：项目名 + 返回按钮（回列表）
  2. 结果横幅：✅ 部署成功 / ❌ 部署失败（复用进度页 `resultBanner` 的样式模式）
  3. 信息网格：开始时间、耗时、分支、构建命令、目标 `user@host:remotePath`
  4. 摘要文本
  5. 底部按钮：**打开完整日志**（发 `openLogFile { path: logPath }`，复用现有后端安全校验）；**再次部署**（直接调现有 `startDeploy(id)`）
- `showDetail(id)`：先切入 viewDetail 显示"加载中…"，发 `getLatestDeployLog`；收到回包渲染。
- 详情页只读历史，与 `deploying` 状态无关——部署进行中点名字看日志不冲突。
- 空态："未找到部署记录（可能已被自动清理，仅保留最近 50 个日志）"。

## 消息协议（src/types.ts）

```ts
// 前端 → 后端
export type WebviewMessage = ... | { type: 'getLatestDeployLog'; id: string };

// 后端 → 前端（found 判别，两个变体）
export type ExtensionMessage = ...
  | { type: 'latestDeployLog'; projectId: string; found: false }
  | { type: 'latestDeployLog'; projectId: string; found: true;
      logPath: string; info: DeployLogInfo }

export interface DeployLogInfo {
  projectName: string;
  target?: string;       // user@host:remotePath
  branch?: string;
  buildCommand?: string;
  startedAt: string;     // 文件头原文（zh-CN 本地时间串）
  success: boolean;      // "结果: 成功/失败"
  duration: string;
  summary: string;
}
```

可选字段对应 `finalizeLog` 在 project 为 undefined 时跳过 `目标/分支/构建命令` 行的情况；前端缺字段渲染 `—`。

安全：本消息只传项目 `id`，所有路径由后端自行构造，无注入面；`openLogFile` 复用现有"日志目录内 .log"校验。

## 后端设计（src/WebviewProvider.ts）

新增 `getLatestDeployLog` case，逻辑四步（建议拆两个私有助手：定位最新日志文件、解析头部）：

1. `configManager.getProjects()` 按 id 查项目；查不到 → `found:false`。
2. **定位最新日志**：`readdir(logDir)`，用锚定正则过滤：
   `^deploy-{escapeRegExp(sanitizeName(name))}-\d{8}-\d{6}\.log$`，按 mtime 降序取第一个。
   - **不能只用 `startsWith`**：项目 `app` 与 `app-2` 共享前缀 `deploy-app-`，startsWith 会让 `app` 的详情页错误展示 `app-2` 的日志；时间戳段 `\d{8}-\d{6}` 锚定消除这类歧义。
   - `logDir` 不存在（从未部署过）→ `found:false`。
3. **只读文件头**：`fs.open` + 读前 4KB 即止。单文件构建日志可能几十 MB，**严禁整读**。逐行按 `键: 值` 匹配（以每行**第一个**冒号切分，避免 `构建命令`/`摘要` 值内含冒号被切错），遇 `=`×40 分隔线停止，`close(fd)`。
4. 返回 `latestDeployLog`；**任何一步抛错（目录缺失、读失败、解析不出"结果:"行）一律 `found:false` 兜底**，前端显示空态。

### 已知限制（明确接受）

- 项目改名后，旧日志按新名字匹配不到 → 详情页显示空态。根治需日志文件名带项目 id，本次不做。
- 两个项目 sanitize 后同名 → 展示两者中较新的一条。
- `pruneLogs` 是全局 50 文件计数，长期不部署的老项目日志可能被清掉 → 空态文案已提示该可能。

## 测试计划

项目无自动化测试基建。验证 = `npm run compile` 通过 + F5 Extension Development Host 手动过场景清单：

1. 部署成功一次、失败一次 → 点名字 → 横幅、开始时间、耗时、分支、目标、摘要正确；"打开完整日志"打开的是对应那次。
2. 建两个相似名项目 `app` / `app-2`，各部署一次 → 详情页互相不串。
3. 从未部署的项目 → 空态文案。
4. 部署进行中点其他项目名 → 不影响进行中的部署视图与流水线。
5. 部署后改名再点名字 → 空态（确认已知限制表现符合预期）。
6. 构建输出很长的项目（日志 >10MB）→ 详情页秒开（只读 4KB）。
7. 拖拽排序后点击项目名 → 进入的是排序后对应项目的详情（id 绑定正确）。

## 范围外（YAGNI）

- 部署历史列表（只看"最近一次"）。
- 分步骤时间线（需把 steps 数组落盘到 globalState，将来有需求另起设计）。
- 日志文件名带项目 id 的命名迁移。

## 改动文件清单

| 文件 | 改动 |
|---|---|
| `webview/index.html` | 新增 `#viewDetail` 视图节点 |
| `webview/app.js` | `.name` 点击绑定、`showDetail()`、`latestDeployLog` 处理、`showView()` 选择器补 `#viewDetail` |
| `webview/style.css` | `.name` 可点击样式 |
| `src/types.ts` | 2 个消息变体 + `DeployLogInfo` |
| `src/WebviewProvider.ts` | `getLatestDeployLog` case + 定位/解析助手 |
