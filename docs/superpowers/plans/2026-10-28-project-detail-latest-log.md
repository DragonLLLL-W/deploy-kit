# 项目详情页（点击项目名回显最近部署日志摘要）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 项目列表卡片的项目名变为可点击入口，点击进入新详情页，回显该项目最近一次部署日志的文件头摘要，并提供"打开完整日志"与"再次部署"。

**Architecture:** 后端新增纯逻辑模块 `src/logRecord.ts`（定位最新日志 + 解析文件头，零 vscode 依赖、node 可直接单测）；`WebviewProvider` 增加 `getLatestDeployLog` 消息处理，只读文件前 4KB；webview 新增第 4 个视图容器 `#viewDetail`，前端只渲染后端返回的结构化 JSON。

**Tech Stack:** TypeScript（VS Code 扩展）、原生 HTML/JS/CSS（webview，无框架无构建）、node 内置 `assert` 测试（无新依赖）。

**Spec:** `docs/superpowers/specs/2026-10-28-project-detail-latest-log-design.md`

## Global Constraints

- `tsconfig.json`：`target: ES2022`、`module: commonjs`、`strict: true`、`include: src/**/*`（`test/` 目录不会被编译，勿动 tsconfig）。
- 运行时依赖仅 `simple-git`，**不得引入任何新依赖**；测试用 node 内置 `assert`。
- Webview ↔ 扩展通信必须走 `src/types.ts` 的 `WebviewMessage` / `ExtensionMessage` 联合类型，不允许裸消息。
- 日志文件名格式（`WebviewProvider.finalizeLog` 写死）：`deploy-{sanitize(name)}-{yyyyMMdd}-{HHmmss}.log`；头部为若干 `键: 值` 行，以 `=`×40 分隔线结束。`sanitize` 规则：`replace(/[\\/:*?"<>|]/g, '_').slice(0, 50)`。
- 详情页**严禁整读日志文件**（单文件可能几十 MB），只读前 4096 字节。
- UI 文案一律中文；新样式复用现有 VS Code 主题变量（`--vscode-*`）。
- 明确不做（YAGNI）：部署历史列表、分步骤时间线、日志文件名带项目 id 的迁移。

---

### Task 1: 类型定义 + 纯逻辑模块 logRecord.ts + 自动化测试（TDD）

**Files:**
- Modify: `src/types.ts`（新增 `DeployLogInfo` 接口与 3 个消息变体）
- Create: `src/logRecord.ts`
- Create: `test/logRecord.test.js`
- Modify: `package.json`（scripts 增加 `pretest` / `test`）
- Modify: `.vscodeignore`（排除 `test/**`）
- Modify: `src/WebviewProvider.ts`（删除私有 `sanitizeName` 方法，改用共享实现，保证读写同规则）

**Interfaces:**
- Consumes: 无（首个任务）。
- Produces:
  - `sanitizeName(name: string): string` —— `src/logRecord.ts` 导出，Task 2 不直接用，但 `WebviewProvider.finalizeLog` 必须改用它。
  - `matchLatestLogFile(entries: { name: string; mtimeMs: number }[], projectName: string): string | null` —— Task 2 调用。
  - `parseLogHeader(text: string): DeployLogInfo | null` —— Task 2 调用。
  - 类型 `DeployLogInfo`；消息 `{ type: 'getLatestDeployLog'; id: string }`（前端→后端）与 `{ type: 'latestDeployLog'; projectId: string; found: boolean; logPath?: string; info?: DeployLogInfo }` 语义的两个判别变体（后端→前端）—— Task 2、Task 3 使用。

- [ ] **Step 1: 修改 `src/types.ts`，新增接口与消息变体**

在 `DeployProgress` 接口定义之后（`// ========== 消息通信协议 ==========` 注释之前）插入：

```ts
export interface DeployLogInfo {
  projectName: string;
  target?: string;       // user@host:remotePath（老日志可能缺省）
  branch?: string;
  buildCommand?: string;
  startedAt: string;     // 文件头原文（zh-CN 本地时间串）
  success: boolean;      // "结果: 成功/失败"
  duration: string;
  summary: string;
}
```

在 `WebviewMessage` 联合的 `| { type: 'openLogFile'; path: string }` 之后追加一行：

```ts
  | { type: 'getLatestDeployLog'; id: string };
```

（注意原最后一行末尾的分号挪到新行。）

在 `ExtensionMessage` 联合的 `| { type: 'deployBusy' };` 之前插入两行，并把原 `deployBusy` 行末尾改为 `;`：

```ts
  | { type: 'latestDeployLog'; projectId: string; found: false }
  | { type: 'latestDeployLog'; projectId: string; found: true;
      logPath: string; info: DeployLogInfo }
```

- [ ] **Step 2: 写失败测试 `test/logRecord.test.js`**

完整内容（目录 `test/` 不存在则先创建）：

```js
'use strict';
const assert = require('assert');
const { matchLatestLogFile, parseLogHeader } = require('../out/logRecord');

let n = 0;
function t(name, fn) {
  n++;
  try { fn(); } catch (e) {
    console.error(`FAIL #${n} ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

// ===== matchLatestLogFile =====

t('按 mtime 取同项目最新文件', () => {
  const files = [
    { name: 'deploy-web-20260101-100000.log', mtimeMs: 100 },
    { name: 'deploy-web-20260201-100000.log', mtimeMs: 300 },
    { name: 'deploy-web-20260115-100000.log', mtimeMs: 200 }
  ];
  assert.strictEqual(matchLatestLogFile(files, 'web'), 'deploy-web-20260201-100000.log');
});

t('app 不得匹配到 app-2 的日志（锚定正则的核心用例）', () => {
  const files = [{ name: 'deploy-app-2-20260101-100000.log', mtimeMs: 999 }];
  assert.strictEqual(matchLatestLogFile(files, 'app'), null);
});

t('app-2 能匹配到自己的日志', () => {
  const files = [{ name: 'deploy-app-2-20260101-100000.log', mtimeMs: 999 }];
  assert.strictEqual(matchLatestLogFile(files, 'app-2'), 'deploy-app-2-20260101-100000.log');
});

t('忽略格式不符或外来的文件', () => {
  const files = [
    { name: 'deploy-web-notes.log', mtimeMs: 10 },
    { name: 'notes.txt', mtimeMs: 10 },
    { name: 'deploy-web.log', mtimeMs: 10 }
  ];
  assert.strictEqual(matchLatestLogFile(files, 'web'), null);
});

t('项目名含正则特殊字符时按字面匹配', () => {
  const hit = [{ name: 'deploy-my.app+1-20260101-100000.log', mtimeMs: 5 }];
  assert.strictEqual(matchLatestLogFile(hit, 'my.app+1'), 'deploy-my.app+1-20260101-100000.log');
  const miss = [{ name: 'deploy-myaappx1-20260101-100000.log', mtimeMs: 5 }];
  assert.strictEqual(matchLatestLogFile(miss, 'my.app+1'), null);
});

t('含非法文件名字符的项目名先 sanitize 再匹配', () => {
  const files = [{ name: 'deploy-web_api-20260101-100000.log', mtimeMs: 5 }];
  assert.strictEqual(matchLatestLogFile(files, 'web:api'), 'deploy-web_api-20260101-100000.log');
});

// ===== parseLogHeader =====

const header = [
  '项目: web_seller（测试环境）',
  '目标: deploy@192.168.1.10:/var/www/html',
  '分支: test',
  '构建命令: npm run build:prod',
  '开始时间: 2026/10/28 14:30:00',
  '结果: 成功',
  '耗时: 1 分 12 秒',
  '摘要: 上传 25 个文件',
  '========================================',
  '$ git checkout test',
  ''
].join('\n');

t('解析完整头部', () => {
  const info = parseLogHeader(header);
  assert.strictEqual(info.projectName, 'web_seller（测试环境）');
  assert.strictEqual(info.target, 'deploy@192.168.1.10:/var/www/html');
  assert.strictEqual(info.branch, 'test');
  assert.strictEqual(info.buildCommand, 'npm run build:prod');
  assert.strictEqual(info.startedAt, '2026/10/28 14:30:00');
  assert.strictEqual(info.success, true);
  assert.strictEqual(info.duration, '1 分 12 秒');
  assert.strictEqual(info.summary, '上传 25 个文件');
});

t('缺"结果"行返回 null', () => {
  assert.strictEqual(parseLogHeader('项目: a\n分支: b\n'), null);
});

t('分隔线之后的正文行不参与解析', () => {
  const info = parseLogHeader(header + 'debug1: 伪字段\n');
  assert.strictEqual(info.summary, '上传 25 个文件');
  assert.strictEqual(info.startedAt, '2026/10/28 14:30:00');
});

t('可缺字段（目标/分支/构建命令）解析为 undefined', () => {
  const minimal = [
    '项目: x', '开始时间: t', '结果: 失败', '耗时: 3 秒', '摘要: 失败原因',
    '========================================', ''
  ].join('\n');
  const info = parseLogHeader(minimal);
  assert.strictEqual(info.success, false);
  assert.strictEqual(info.target, undefined);
  assert.strictEqual(info.branch, undefined);
  assert.strictEqual(info.buildCommand, undefined);
});

console.log(process.exitCode ? 'SOME TESTS FAILED' : `all ${n} logRecord tests passed`);
```

- [ ] **Step 3: 修改 `package.json` scripts**

```json
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "package": "vsce package",
    "pretest": "npm run compile",
    "test": "node test/logRecord.test.js"
  },
```

- [ ] **Step 4: 运行测试，确认失败**

Run: `npm test`
Expected: `pretest` 编译通过，随后测试进程报 `Error: Cannot find module '...\out\logRecord'`，退出码非 0。

- [ ] **Step 5: 实现 `src/logRecord.ts`**

```ts
import { DeployLogInfo } from './types';

/**
 * 日志文件名中的项目名净化：非法字符换 _，截断 50 字符。
 * 唯一实现点——finalizeLog 写文件名与此处读匹配必须共用，规则变更只改这一处。
 */
export function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从候选文件中找属于 projectName 的最新日志文件名。
 * 文件名格式：deploy-{sanitize(name)}-{yyyyMMdd}-{HHmmss}.log。
 * 必须锚定整段时间戳：若只按前缀匹配，"app" 会吞掉 "app-2" 的文件。
 */
export function matchLatestLogFile(
  entries: { name: string; mtimeMs: number }[],
  projectName: string
): string | null {
  const re = new RegExp(
    '^deploy-' + escapeRegExp(sanitizeName(projectName)) + '-\\d{8}-\\d{6}\\.log$'
  );
  let best: { name: string; mtimeMs: number } | null = null;
  for (const e of entries) {
    if (!re.test(e.name)) continue;
    if (!best || e.mtimeMs > best.mtimeMs) best = e;
  }
  return best ? best.name : null;
}

/**
 * 解析日志文件头部（==== 分隔线之前的 "键: 值" 块）。
 * 按每行第一个冒号切分，值内含冒号（构建命令、目标路径）不会被切错。
 * 解析不出"项目"或"结果"行时返回 null（调用方兜底为空态）。
 */
export function parseLogHeader(text: string): DeployLogInfo | null {
  // Object.create(null)：避免 "constructor"/"__proto__" 等键名污染普通对象
  const fields: Record<string, string> = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('=')) break;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in fields)) fields[key] = value;
  }
  if (!fields['项目'] || !fields['结果']) return null;
  return {
    projectName: fields['项目'],
    target: fields['目标'],
    branch: fields['分支'],
    buildCommand: fields['构建命令'],
    startedAt: fields['开始时间'] ?? '',
    success: fields['结果'] === '成功',
    duration: fields['耗时'] ?? '',
    summary: fields['摘要'] ?? ''
  };
}
```

- [ ] **Step 6: 运行测试，确认通过**

Run: `npm test`
Expected: 编译无错，末行输出 `all 10 logRecord tests passed`，退出码 0。

- [ ] **Step 7: `src/WebviewProvider.ts` 改用共享 sanitizeName**

文件顶部 import 区（`DeployPipeline` 的 import 附近）加：

```ts
import { sanitizeName } from './logRecord';
```

`finalizeLog` 中（约 249 行）：

```ts
// 改前
const fileName = `deploy-${this.sanitizeName(project?.name || 'unknown')}-${this.stamp(startedAt)}.log`;
// 改后
const fileName = `deploy-${sanitizeName(project?.name || 'unknown')}-${this.stamp(startedAt)}.log`;
```

整体删除私有方法 `sanitizeName`（约 294-296 行）：

```ts
// 删除这三行
private sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
}
```

（`stamp` 保留在 WebviewProvider，不动。）

- [ ] **Step 8: 编译验证**

Run: `npm run compile`
Expected: 无任何输出（tsc 静默成功），退出码 0。

- [ ] **Step 9: 修改 `.vscodeignore`**

```
.vscode/**
src/**
tsconfig.json
node_modules/.cache
test/**
```

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/logRecord.ts src/WebviewProvider.ts test/logRecord.test.js package.json .vscodeignore
git commit -m "feat(logRecord): 日志文件定位与头部解析纯逻辑，附 node 内置 assert 测试"
```

---

### Task 2: WebviewProvider 新增 getLatestDeployLog 消息处理

**Files:**
- Modify: `src/WebviewProvider.ts`（switch 增加 case；日志落盘小节新增两个私有方法）

**Interfaces:**
- Consumes: Task 1 的 `matchLatestLogFile(entries, projectName)`、`parseLogHeader(text)`、`DeployLogInfo`、`latestDeployLog` 消息变体；已有的 `this.configManager.getProjects()`、`this.logDir`、`this.postMessage()`、`fs`/`path` 导入。
- Produces: 后端对 `{ type: 'getLatestDeployLog'; id }` 的应答——Task 3 前端据此渲染。应答形态二选一：`{ type:'latestDeployLog', projectId, found:false }` 或 `{ type:'latestDeployLog', projectId, found:true, logPath, info }`。

- [ ] **Step 1: 扩展 logRecord 的 import**

把 Task 1 加的那行改为：

```ts
import { sanitizeName, matchLatestLogFile, parseLogHeader } from './logRecord';
```

- [ ] **Step 2: 在 handleMessage 的 switch 中加入 case**

锚点：`case 'openLogFolder': {`（约 208 行）。在它**之前**插入：

```ts
      case 'getLatestDeployLog': {
        this.sendLatestDeployLog(message.id);
        break;
      }

```

- [ ] **Step 3: 新增两个私有方法**

锚点：`// ========== 日志落盘 ==========` 小节内、`finalizeLog` 方法之前插入：

```ts
  /**
   * 查找指定项目最近一次部署日志并把头部摘要发回前端。
   * 找不到项目 / 目录不存在 / 无匹配文件 / 头部解析失败，一律 found:false 兜底。
   */
  private sendLatestDeployLog(id: string): void {
    const notFound: ExtensionMessage = { type: 'latestDeployLog', projectId: id, found: false };
    try {
      const project = this.configManager.getProjects().find(p => p.id === id);
      if (!project) {
        this.postMessage(notFound);
        return;
      }

      if (!fs.existsSync(this.logDir)) {
        this.postMessage(notFound);
        return;
      }
      const entries = fs.readdirSync(this.logDir)
        .filter(f => f.startsWith('deploy-') && f.endsWith('.log'))
        .map(name => {
          let mtimeMs = 0;
          try { mtimeMs = fs.statSync(path.join(this.logDir, name)).mtimeMs; } catch {}
          return { name, mtimeMs };
        });

      const fileName = matchLatestLogFile(entries, project.name);
      if (!fileName) {
        this.postMessage(notFound);
        return;
      }

      const logPath = path.join(this.logDir, fileName);
      const info = parseLogHeader(this.readLogHead(logPath, 4096));
      if (!info) {
        this.postMessage(notFound);
        return;
      }

      this.postMessage({ type: 'latestDeployLog', projectId: id, found: true, logPath, info });
    } catch {
      this.postMessage(notFound);
    }
  }

  /** 只读文件前 maxBytes 字节（头部）。单条构建日志可能几十 MB，严禁整读。 */
  private readLogHead(filePath: string, maxBytes: number): string {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.toString('utf-8', 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  }
```

- [ ] **Step 4: 编译验证**

Run: `npm run compile`
Expected: 无输出，退出码 0。（`ExtensionMessage` 已在文件头部 import——若 tsc 报缺类型，检查该 import。）

- [ ] **Step 5: 回归单测**

Run: `npm test`
Expected: `all 10 logRecord tests passed`。

- [ ] **Step 6: Commit**

```bash
git add src/WebviewProvider.ts
git commit -m "feat(WebviewProvider): getLatestDeployLog 定位最近日志并返回头部摘要"
```

---

### Task 3: Webview 前端——viewDetail 视图与可点击项目名

**Files:**
- Modify: `webview/index.html`（`viewProgress` 闭合 div 之后、`<script>` 标签之前插入新视图）
- Modify: `webview/app.js`（全局状态、`showView`、`renderProjectList` 模板、新函数、消息 case、事件绑定）
- Modify: `webview/style.css`（文件末尾追加两段）

**Interfaces:**
- Consumes: Task 2 的 `latestDeployLog` 应答；已有 `openLogFile` 消息（后端已有目录内 `.log` 校验）；已有 `startDeploy(id)` 函数与 `projects` 数组；已有样式类 `.form-header` / `.btn-text` / `.btn-primary` / `.btn-link` / `.result-actions` / `.empty-state` / `.hidden`。
- Produces: 用户可见的详情页；DOM 节点 `#viewDetail` `#detailTitle` `#detailBody` `#detailActions` `#btnBackFromDetail` `#btnDetailOpenLog` `#btnDetailRedeploy`。

- [ ] **Step 1: `webview/index.html` 新增视图节点**

锚点：`</div>`（`#viewProgress` 的闭合标签，紧跟 `</body>` 前 `<script src="${scriptUri}">` 上一段结束处）。在其后、`<script src="${scriptUri}"></script>` 之前插入：

```html
  <!-- 部署详情视图（最近一次日志摘要） -->
  <div id="viewDetail" class="hidden">
    <div class="form-header">
      <button id="btnBackFromDetail" class="btn-text">← 返回</button>
      <span id="detailTitle">部署详情</span>
      <span></span>
    </div>
    <div class="detail-body" id="detailBody"></div>
    <div class="result-actions detail-actions hidden" id="detailActions">
      <button id="btnDetailRedeploy" class="btn-primary">再次部署</button>
      <button id="btnDetailOpenLog" class="btn-link">打开完整日志</button>
    </div>
  </div>
```

- [ ] **Step 2: `webview/app.js` 全局状态与 showView 修正**

顶部全局区（`let currentDeployId = null;` 之后）加：

```js
let currentDetailId = null;   // 详情页当前展示的项目 id
let detailLogPath = null;     // 最近一次查询返回的日志绝对路径
```

`showView()`（第 15-19 行）选择器必须加上新视图：

```js
function showView(viewId) {
  document.querySelectorAll('#viewList, #viewForm, #viewProgress, #viewDetail')
    .forEach(el => el.classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}
```

- [ ] **Step 3: `webview/app.js` 项目名可点击**

`renderProjectList()` 模板中第 33 行：

```js
// 改前
        <div class="name">${escapeHtml(p.name)}</div>
// 改后
        <div class="name clickable" title="查看最近一次部署记录" onclick="showDetail('${p.id}')">${escapeHtml(p.name)}</div>
```

- [ ] **Step 4: `webview/app.js` 新增详情页函数**

锚点：`// ========== 部署进度 ==========` 注释行之前插入整段：

```js
// ========== 部署详情（最近一次日志摘要） ==========
function showDetail(id) {
  currentDetailId = id;
  detailLogPath = null;
  const p = projects.find(x => x.id === id);
  document.getElementById('detailTitle').textContent = p ? p.name : '部署详情';
  document.getElementById('detailBody').innerHTML = '<div class="empty-state">加载中…</div>';
  document.getElementById('detailActions').classList.add('hidden');
  showView('viewDetail');
  vscode.postMessage({ type: 'getLatestDeployLog', id });
}

function renderDetail(msg) {
  const body = document.getElementById('detailBody');
  const actions = document.getElementById('detailActions');
  if (!msg.found) {
    detailLogPath = null;
    body.innerHTML = '<div class="empty-state">未找到部署记录（可能已被自动清理，仅保留最近 50 个日志）</div>';
    actions.classList.add('hidden');
    return;
  }
  const i = msg.info;
  const esc = v => escapeHtml(v == null || v === '' ? '—' : v);
  const row = (k, v) => `<div class="detail-row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>`;
  body.innerHTML = `
    <div class="detail-banner ${i.success ? 'ok' : 'fail'}">${i.success ? '✅ 部署成功' : '❌ 部署失败'}</div>
    ${row('开始时间', i.startedAt)}
    ${row('耗时', i.duration)}
    ${row('分支', i.branch)}
    ${row('构建命令', i.buildCommand)}
    ${row('目标', i.target)}
    <div class="detail-summary">${esc(i.summary)}</div>
  `;
  detailLogPath = msg.logPath;
  actions.classList.remove('hidden');
}
```

- [ ] **Step 5: `webview/app.js` 消息处理**

`window.addEventListener('message', ...)` 的 switch 中，`case 'deployBusy':` 之前加：

```js
    case 'latestDeployLog':
      if (message.projectId === currentDetailId) renderDetail(message);
      break;
```

- [ ] **Step 6: `webview/app.js` 事件绑定**

`// ========== 事件绑定 ==========` 区内（`btnBackFromProgress` 绑定行之后）加：

```js
document.getElementById('btnBackFromDetail').addEventListener('click', () => showView('viewList'));
document.getElementById('btnDetailOpenLog').addEventListener('click', () => {
  if (detailLogPath) vscode.postMessage({ type: 'openLogFile', path: detailLogPath });
});
document.getElementById('btnDetailRedeploy').addEventListener('click', () => {
  if (currentDetailId) startDeploy(currentDetailId);
});
```

- [ ] **Step 7: `webview/style.css` 追加样式**

文件末尾追加：

```css
/* ===== 可点击项目名（进入部署详情） ===== */
.project-card .name.clickable {
  cursor: pointer;
}
.project-card .name.clickable:hover {
  text-decoration: underline;
  color: var(--vscode-textLink-foreground);
}

/* ===== 部署详情视图 ===== */
.detail-body {
  padding: 12px 16px;
}

.detail-banner {
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  padding: 14px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  background: var(--vscode-editor-background);
  margin-bottom: 12px;
}
.detail-banner.ok { border-color: var(--vscode-testing-iconPassed); }
.detail-banner.fail { border-color: var(--vscode-testing-iconFailed); }

.detail-row {
  display: flex;
  gap: 10px;
  font-size: 12px;
  padding: 5px 0;
  border-bottom: 1px dashed var(--vscode-panel-border);
}
.detail-row .k {
  width: 72px;
  flex-shrink: 0;
  color: var(--vscode-descriptionForeground);
}
.detail-row .v {
  word-break: break-all;
}

.detail-summary {
  margin-top: 10px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.6;
  word-break: break-all;
}

.detail-actions {
  padding: 0 16px 16px;
  justify-content: center;
}
```

- [ ] **Step 8: 编译验证**

Run: `npm run compile`
Expected: 无输出，退出码 0（webview 不经 tsc，此步确认扩展侧整体仍健康）。

- [ ] **Step 9: F5 核心场景手动验证**

按 F5 启动 Extension Development Host，依次确认：

1. 对一个已配置好的项目执行一次部署（成功或失败均可）→ 返回列表。
2. 鼠标悬停项目名：出现下划线 + 小手光标。
3. 点击项目名：进入详情页，显示"加载中…"后渲染出结果横幅、开始时间、耗时、分支、构建命令、目标、摘要，与刚才部署实际情况一致。
4. 点"打开完整日志"：编辑器打开对应 `.log` 文件。
5. 点"← 返回"：回到列表；再点"再次部署"入口重复验证一次（进详情页 → 点再次部署 → 进度页正常跑）。

Expected: 以上 5 点全部符合；webview 控制台（Ctrl+Shift+I 在 webview 内）无报错。任何一步失败：修复后重跑本步，不要带病提交。

- [ ] **Step 10: Commit**

```bash
git add webview/index.html webview/app.js webview/style.css
git commit -m "feat(webview): 项目名可点击进入部署详情页，回显最近一次日志摘要"
```

---

### Task 4: 按 spec 场景清单做完整手动回归

**Files:**
- 无预期改动；发现问题时修改对应文件。

**Interfaces:**
- Consumes: Task 1-3 的全部产物。
- Produces: 验证结论；如有修复则产出 fix 提交。

- [ ] **Step 1: 逐场景验证（F5 到 Extension Development Host）**

| # | 操作 | 预期 |
|---|---|---|
| 1 | 部署成功一次、失败一次（改错分支名制造失败），分别点进详情页 | 两次横幅/耗时/摘要与各自那次一致；"打开完整日志"打开的是对应文件 |
| 2 | 建两个项目 `app` 与 `app-2`，各部署一次 | 详情页互不串日志（各自只显示自己的） |
| 3 | 点一个从未部署过的项目的项目名 | 空态："未找到部署记录（可能已被自动清理，仅保留最近 50 个日志）"，按钮区隐藏 |
| 4 | 部署进行中，点列表里另一个项目的名字 | 进入其详情页，进行中的部署日志与步骤状态不受影响 |
| 5 | 部署成功后把项目改名，再点新名字的详情页 | 空态（spec 已知限制的表现确认） |
| 6 | 若手头有构建输出很大的项目：部署后点详情页 | 秒开不卡顿（后端只读 4KB） |
| 7 | 拖拽卡片改变顺序后，点击其中一张的项目名 | 进入的是拖拽后这张卡对应项目的详情（onclick 绑的是 id，重渲染天然正确） |

- [ ] **Step 2: 有失败则修复**

定位 → 修改 → `npm run compile` + `npm test` 通过 → 重跑对应场景。

```bash
git add <修改的文件>
git commit -m "fix: <一句话说明修复的场景问题>"
```

全部通过则跳过本步（无代码改动，无提交）。

---

## 自检记录（写计划时已做的核对）

- Spec 覆盖：可点击样式/T3S3&S7、showView 补选择器/T3S2、viewDetail 布局五区块/T3S1&S4、空态文案/T3S4、协议/T1S1、后端四步（id 查项目→锚定正则定位→4KB 头读→found:false 兜底）/T2S3、sanitize 单一实现/T1S7、7 条测试场景/T3S9 + T4 表格、范围外三项未混入。
- 类型一致性：`matchLatestLogFile` / `parseLogHeader` 签名在 T1 定义与 T2 调用一致；`latestDeployLog` 字段在 T1 类型、T2 发送、T3 渲染（`msg.found`、`msg.logPath`、`msg.info`）三处一致；`detail-actions` 复用 `.result-actions`（flex）+ `.hidden`（`display:none!important`）无冲突。
