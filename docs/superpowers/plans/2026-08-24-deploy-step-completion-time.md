# 部署阶段完成时间显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Deploy Kit 部署进度视图中，为每个已完成的阶段同时展示「完成时刻（HH:MM:SS）」和「步骤耗时」。

**Architecture:** 在 `DeployStep` 消息协议中新增 `completedAt` 和 `duration` 两个可选字符串字段；`DeployPipeline` 在每个步骤开始时记录时间戳，成功结束时计算并填充这两个字段；Webview 的 `updateStep` 在步骤完成时动态创建 `.step-time` 元素展示时间信息，并用新增 CSS 控制样式。

**Tech Stack:** TypeScript, VS Code Extension API, 纯 HTML/CSS/JS Webview

## Global Constraints

- VS Code 引擎版本 ≥ 1.85.0
- 运行时依赖: `simple-git`
- 开发依赖: `@types/vscode`, `@vscode/vsce`, `typescript`
- 配置存储: `globalState` (项目配置) + `SecretStorage` (密码)
- Webview 前端: 无框架，纯 HTML/CSS/JS
- 平台: Windows 主要，兼容 macOS/Linux
- 时间格式: `completedAt` 为 24 小时制 `HH:MM:SS`；`duration` 沿用现有 `formatDuration` 格式（"N 秒" 或 "N 分 N 秒"）
- 仅在 `status === 'done'` 时填充时间字段；`error` / `running` / `pending` 不填充

---

## File Structure

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `src/types.ts` | 修改 | 扩展 `DeployStep` 接口，新增 `completedAt?` 和 `duration?` 字段 |
| `src/DeployPipeline.ts` | 修改 | 每个步骤记录开始时间，成功结束时填充时间字段；新增 `formatTime` 辅助方法 |
| `webview/app.js` | 修改 | `updateStep` 在步骤完成时渲染 `.step-time` 元素 |
| `webview/style.css` | 修改 | 新增 `.step-time` 样式 |

---

### Task 1: 扩展 DeployStep 类型

**Files:**
- Modify: `src/types.ts:33-38`

**Interfaces:**
- Consumes: 现有 `StepStatus` 类型
- Produces: `DeployStep` 新增可选字段 `completedAt?: string` 和 `duration?: string`

- [ ] **Step 1: 修改 types.ts**

在 `src/types.ts` 中，将 `DeployStep` 接口修改为：

```typescript
export interface DeployStep {
  step: 'checkout' | 'pull' | 'build' | 'upload' | 'complete';
  label: string;
  status: StepStatus;
  detail: string;
  completedAt?: string; // 格式：HH:MM:SS（24 小时制）
  duration?: string;    // 格式：例如 "12 秒" / "1 分 12 秒"
}
```

- [ ] **Step 2: 编译验证**

Run:
```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc --noEmit
```

Expected: 无编译错误。

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/types.ts
git commit -m "feat(types): DeployStep 增加 completedAt 和 duration 字段"
```

---

### Task 2: 在 DeployPipeline 中记录步骤时间

**Files:**
- Modify: `src/DeployPipeline.ts`

**Interfaces:**
- Consumes: 扩展后的 `DeployStep` 类型（来自 Task 1）
- Produces: 每个步骤的 `done` 回调均携带 `completedAt` 和 `duration`

- [ ] **Step 1: 新增 formatTime 辅助方法**

在 `src/DeployPipeline.ts` 中，找到 `formatDuration` 方法，在其上方或下方新增：

```typescript
private formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}
```

- [ ] **Step 2: 修改 checkoutBranch 步骤**

将 `checkoutBranch` 方法中的 `try` 块替换为：

```typescript
private async checkoutBranch(project: Project, cbs: DeployCallbacks): Promise<void> {
  const stepStartTime = Date.now();
  cbs.onStep({
    step: 'checkout',
    label: '切换分支',
    status: 'running',
    detail: `切换到 ${project.branch}`
  });

  const git: SimpleGit = simpleGit(project.localPath);
  cbs.onLog(`$ git checkout ${project.branch}`);

  try {
    const result = await git.checkout(project.branch);
    cbs.onLog(result || `Switched to branch '${project.branch}'`);

    const now = Date.now();
    cbs.onStep({
      step: 'checkout',
      label: '切换分支',
      status: 'done',
      detail: `已切换到 ${project.branch}`,
      completedAt: this.formatTime(new Date(now)),
      duration: this.formatDuration(now - stepStartTime)
    });
  } catch (err: any) {
    cbs.onLog(err.message);
    cbs.onStep({
      step: 'checkout',
      label: '切换分支',
      status: 'error',
      detail: err.message
    });
    throw new Error(`切换分支失败: ${err.message}`);
  }
}
```

- [ ] **Step 3: 修改 pullCode 步骤**

将 `pullCode` 方法中的 `try` 块替换为：

```typescript
private async pullCode(project: Project, cbs: DeployCallbacks): Promise<void> {
  const stepStartTime = Date.now();
  cbs.onStep({
    step: 'pull',
    label: '拉取代码',
    status: 'running',
    detail: 'git pull'
  });

  const git: SimpleGit = simpleGit(project.localPath);
  cbs.onLog('$ git pull');

  try {
    const result = await git.pull();
    const summary = result.summary?.changes
      ? `${result.summary.changes} 个文件变更`
      : 'Already up to date';
    cbs.onLog(summary);

    const now = Date.now();
    cbs.onStep({
      step: 'pull',
      label: '拉取代码',
      status: 'done',
      detail: summary,
      completedAt: this.formatTime(new Date(now)),
      duration: this.formatDuration(now - stepStartTime)
    });
  } catch (err: any) {
    cbs.onLog(err.message);
    cbs.onStep({
      step: 'pull',
      label: '拉取代码',
      status: 'error',
      detail: err.message
    });
    throw new Error(`拉取代码失败: ${err.message}`);
  }
}
```

- [ ] **Step 4: 修改 runBuild 步骤**

将 `runBuild` 方法中的 `cbs.onLog(`$ ${project.buildCommand}`);` 之后到 `child.on('close', ...)` 之前的部分保持不变，只修改 `child.on('close', ...)` 中的 `else` 分支：

```typescript
child.on('close', (code: number) => {
  if (outBuf.s) cbs.onLog(outBuf.s);
  if (errBuf.s) cbs.onLog(errBuf.s);
  if (code !== 0) {
    cbs.onStep({
      step: 'build',
      label: '构建',
      status: 'error',
      detail: `构建失败，退出码 ${code}`
    });
    reject(new Error(`构建失败，退出码 ${code}`));
  } else {
    const now = Date.now();
    cbs.onStep({
      step: 'build',
      label: '构建',
      status: 'done',
      detail: '构建成功',
      completedAt: this.formatTime(new Date(now)),
      duration: this.formatDuration(now - stepStartTime)
    });
    resolve();
  }
});
```

同时，在 `runBuild` 方法开头（`return new Promise((resolve, reject) => {` 之后）添加：

```typescript
const stepStartTime = Date.now();
```

- [ ] **Step 5: 修改 uploadViaScp 步骤**

在 `uploadViaScp` 方法开头（`return new Promise((resolve, reject) => {` 之后）添加：

```typescript
const stepStartTime = Date.now();
```

然后修改 `child.on('close', ...)` 中的 `else` 分支：

```typescript
child.on('close', (code: number) => {
  if (outBuf.s) cbs.onLog(outBuf.s);
  if (errBuf.s) cbs.onLog(errBuf.s);
  if (code !== 0) {
    cbs.onStep({
      step: 'upload',
      label: 'SCP 上传',
      status: 'error',
      detail: `scp 退出码 ${code}`
    });
    reject(new Error(`上传失败，scp 退出码 ${code}`));
  } else {
    cbs.onLog('上传完成');
    const now = Date.now();
    cbs.onStep({
      step: 'upload',
      label: 'SCP 上传',
      status: 'done',
      detail: '上传成功',
      completedAt: this.formatTime(new Date(now)),
      duration: this.formatDuration(now - stepStartTime)
    });
    resolve();
  }
});
```

- [ ] **Step 6: 修改完成步骤**

将 `deploy` 方法中最后的完成回调替换为：

```typescript
// Step 5: 完成
const duration = this.formatDuration(Date.now() - startTime);
const now = Date.now();
callbacks.onStep({
  step: 'complete',
  label: '部署完成',
  status: 'done',
  detail: `总耗时 ${duration}`,
  completedAt: this.formatTime(new Date(now)),
  duration
});
```

- [ ] **Step 7: 编译验证**

Run:
```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc --noEmit
```

Expected: 无编译错误。

- [ ] **Step 8: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/DeployPipeline.ts
git commit -m "feat(pipeline): 为每个部署步骤记录完成时刻和耗时"
```

---

### Task 3: 在 Webview 中渲染时间信息

**Files:**
- Modify: `webview/app.js`
- Modify: `webview/style.css`

**Interfaces:**
- Consumes: 扩展后的 `DeployStep` 对象（来自 Task 1 和 Task 2）
- Produces: 每个完成步骤下方显示 `.step-time` 元素

- [ ] **Step 1: 修改 app.js 的 updateStep 函数**

将 `updateStep` 函数中 `detail.textContent = step.detail || '';` 之后的部分替换为：

```javascript
function updateStep(step) {
  const el = document.getElementById(`step-${step.step}`);
  if (!el) return;

  const iconMap = { pending: '⏳', running: '🔄', done: '✅', error: '❌' };
  const icon = el.querySelector('.step-icon');
  icon.textContent = iconMap[step.status] || '⏳';
  icon.className = `step-icon ${step.status}`;

  const detail = el.querySelector('.step-detail');
  detail.textContent = step.detail || '';

  // 步骤完成时显示完成时刻和耗时
  if (step.status === 'done' && (step.completedAt || step.duration)) {
    let timeEl = el.querySelector('.step-time');
    if (!timeEl) {
      timeEl = document.createElement('div');
      timeEl.className = 'step-time';
      el.appendChild(timeEl);
    }
    const parts = [];
    if (step.completedAt) parts.push(step.completedAt);
    if (step.duration) parts.push(`耗时 ${step.duration}`);
    timeEl.textContent = parts.join(' · ');
  }

  // 如果是上传步骤且正在运行，添加进度条
  if (step.step === 'upload' && step.status === 'running') {
    let bar = el.querySelector('.progress-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.innerHTML = '<div class="fill" style="width:0%"></div>';
      el.appendChild(bar);
    }
  }
}
```

- [ ] **Step 2: 新增 .step-time 样式**

在 `webview/style.css` 中，找到 `.step-item .step-detail` 样式块，在其后添加：

```css
.step-item .step-time {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: 22px;
  margin-top: 2px;
}
```

- [ ] **Step 3: 编译验证（TypeScript 后端）**

Run:
```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc -p ./
```

Expected: 无编译错误，`out/` 目录产物更新。

- [ ] **Step 4: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add webview/app.js webview/style.css
git commit -m "feat(webview): 在部署步骤完成时显示完成时刻和耗时"
```

---

### Task 4: 验证与测试

**Files:**
- 无需修改文件

**Interfaces:**
- 验证前面三个 Task 的集成效果

- [ ] **Step 1: 运行完整编译**

Run:
```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc -p ./
```

Expected: 无编译错误。

- [ ] **Step 2: 打包检查**

Run:
```bash
cd C:/Users/admin/Desktop/deploy-kit
npx vsce package
```

Expected: 成功生成 `.vsix` 文件。

- [ ] **Step 3: 在 VS Code 中运行扩展**

按 `F5` 启动 Extension Development Host，或运行：

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx vsce package
code --install-extension deploy-kit-*.vsix
```

Expected: 扩展成功安装。

- [ ] **Step 4: 手动功能验证**

在 Extension Development Host 中：
1. 打开 Deploy Kit 侧边栏
2. 选择一个已配置的项目，点击「一键部署」
3. 观察每个步骤完成后的显示：
   - 每个步骤 `done` 后，下方应出现一行 `HH:MM:SS · 耗时 N 秒`
   - 失败步骤不应出现时间信息
   - 最终结果横幅中的总耗时应与 `complete` 步骤的 `duration` 一致

- [ ] **Step 5: Commit（如测试结果通过）**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add -A
git commit -m "test: 验证部署阶段完成时间显示功能"
```

---

## Self-Review

### 1. Spec coverage

对照设计文档 `docs/superpowers/specs/2026-08-24-deploy-step-completion-time-design.md`：

| 需求 | 覆盖 Task |
|------|-----------|
| `DeployStep` 增加 `completedAt` 和 `duration` | Task 1 |
| 后端每个步骤记录时间并填充字段 | Task 2 |
| 前端在 `done` 状态渲染时间信息 | Task 3 |
| 仅在 `done` 时显示，错误时不显示 | Task 2 + Task 3 |
| `complete` 步骤使用总耗时 | Task 2 |

无遗漏。

### 2. Placeholder scan

检查计划全文：
- 无 "TBD" / "TODO" / "implement later"
- 无 "Add appropriate error handling" 等模糊描述
- 每个代码步骤均给出完整代码块
- 每个命令均给出具体命令和期望输出

无占位符。

### 3. Type consistency

- `completedAt?: string` 和 `duration?: string` 在 Task 1 中定义，Task 2 和 Task 3 中均使用相同字段名和类型。
- `formatTime` 接收 `Date` 返回 `string`，与调用处一致。
- `formatDuration` 沿用现有方法，签名不变。

类型一致。
