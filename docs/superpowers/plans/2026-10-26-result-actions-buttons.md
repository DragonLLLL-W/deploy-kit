# 完成卡片按钮美化 + 日志一键打开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉部署完成卡片按钮的 emoji、用文字链接样式建立主次按钮层次，并把「日志: xxx.log」变为可点击链接，在 IDE 编辑器内直接打开本次日志。

**Architecture:** 纯表现层调整（index.html / style.css / app.js 的 showResult）+ 一条新的前端→后端消息 `openLogFile`（types.ts 协议 + WebviewProvider.ts 处理，带日志目录路径校验）。不涉及 DeployPipeline 与日志落盘逻辑。

**Tech Stack:** TypeScript、VS Code Extension API、无框架 HTML/CSS/JS Webview

**Spec:** `docs/superpowers/specs/2026-10-26-result-actions-buttons-design.md`

## Global Constraints

- 颜色一律使用 `--vscode-*` 主题变量（可带 fallback），禁止硬编码新色值
- 不新增任何运行时依赖、不引入图标库、不手绘 SVG
- 其他区域 emoji（步骤状态 ⏳✅❌、表单 📁/👁、标题 🚀）本次不动
- 后端代码改动后 `npm run compile` 必须通过；webview 三件套为静态文件不参与编译
- 本项目无自动化测试框架，每个任务的"测试"= 编译/静态检查通过 + 用户在 IDE 内人工核对验收清单（对应 spec 第 4 节）
- 提交信息用中文 conventional commits（参考 git log 现有风格）

---

## File Structure

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `webview/index.html` | 修改 `:117-120` | 按钮去 emoji，`btnOpenLog` 换 `btn-link` 类 |
| `webview/style.css` | 修改 `:62-82` | 删 `.btn-secondary`/`.log-hint`，新增 `.btn-link`/`.log-link` |
| `webview/app.js` | 修改 `:299-315` | 日志文件名渲染为可点击链接并绑定 `openLogFile` 消息 |
| `src/types.ts` | 修改 `:51-60` | `WebviewMessage` 联合类型追加 `openLogFile` |
| `src/WebviewProvider.ts` | 修改 `:208-214` 后 | 新增 `openLogFile` case：路径校验 + 编辑器打开 |

---

### Task 1: 按钮去 emoji 并建立主次层次（纯前端，可独立验收）

**Files:**
- Modify: `webview/index.html:117-120`
- Modify: `webview/style.css:62-71`（删 `.btn-secondary`）并在原位置加 `.btn-link`

**Interfaces:**
- Consumes: 现有 `#btnRedeploy` / `#btnOpenLog` 的 id 与事件绑定（app.js:326-331 不动）
- Produces: CSS 类 `.btn-link`（Task 2 的日志链接复用同一视觉语言，但 Task 2 用的是 `.log-link` span，二者互不依赖）

- [ ] **Step 1: 修改 index.html 按钮**

将 `webview/index.html:117-120`：

```html
      <div class="result-actions">
        <button id="btnRedeploy" class="btn-primary">🔄 再次部署</button>
        <button id="btnOpenLog" class="btn-secondary">📁 打开日志文件夹</button>
      </div>
```

替换为：

```html
      <div class="result-actions">
        <button id="btnRedeploy" class="btn-primary">再次部署</button>
        <button id="btnOpenLog" class="btn-link">打开日志文件夹</button>
      </div>
```

- [ ] **Step 2: 确认 btn-secondary 无其他引用**

Run: `grep -rn "btn-secondary" webview/`
Expected: 仅 `style.css` 中样式定义两处（`:62` 与 `:71`），HTML 无引用

- [ ] **Step 3: 替换 style.css 样式**

删除 `webview/style.css:62-71` 的：

```css
.btn-secondary {
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ffffff);
  border: none;
  padding: 6px 14px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}
.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
```

在原位置写入：

```css
.btn-link {
  background: transparent;
  border: none;
  color: var(--vscode-textLink-foreground);
  padding: 6px 8px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}
.btn-link:hover {
  text-decoration: underline;
  background: var(--vscode-toolbar-hoverBackground);
}
```

注：`.btn-icon-sm`（表单区按钮）仍引用 `--vscode-button-secondaryBackground`，与本删除无关，不动。

- [ ] **Step 4: 静态自查**

Run: `grep -rn "🔄\|" webview/index.html`
Expected: 仅命中表单区 `btnBrowseLocal`/`btnBrowseUpload` 两个 📁（`:46`、`:58`），`result-actions` 区域无 emoji

- [ ] **Step 5: Commit**

```bash
git add webview/index.html webview/style.css
git commit -m "style(webview): 完成卡片按钮去 emoji，次按钮改为文字链接样式"
```

- [ ] **Step 6: 人工验收（交给用户）**

在 Trae 中重新加载窗口（扩展 webview 为静态文件，重载即生效，无需重装 vsix）→ 触发一次部署 → 核对 spec 验收标准 1、2。

---

### Task 2: 日志文件名可点击，编辑器内打开本次日志（协议 + 前后端）

**Files:**
- Modify: `src/types.ts:60`
- Modify: `src/WebviewProvider.ts:208-214`（`openLogFolder` case 之后插入新 case）
- Modify: `webview/app.js:303-311`（showResult 内 logHtml 构建处）
- Modify: `webview/style.css:79-82`（`.log-hint` 替换为 `.log-link`）

**Interfaces:**
- Consumes: `deployComplete` 消息已有的 `logPath?: string` 字段（types.ts:68，不动）；`WebviewProvider.logDir` 私有字段
- Produces: 新消息 `{ type: 'openLogFile'; path: string }`（前端→后端）；CSS 类 `.log-link`

- [ ] **Step 1: 扩展消息协议**

`src/types.ts:60`，将：

```typescript
  | { type: 'openLogFolder' };
```

改为：

```typescript
  | { type: 'openLogFolder' }
  | { type: 'openLogFile'; path: string };
```

- [ ] **Step 2: 后端处理 openLogFile（含路径校验）**

`src/WebviewProvider.ts`，在 `case 'openLogFolder': { ... break; }`（`:208-214`）之后新增：

```typescript
      case 'openLogFile': {
        // 纵深防御：只允许打开日志目录内的 .log 文件
        const resolved = path.resolve(message.path);
        const logRoot = path.resolve(this.logDir);
        if (!resolved.startsWith(logRoot + path.sep) || !resolved.endsWith('.log')) {
          break;
        }
        try {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch {
          vscode.window.showWarningMessage(`无法打开日志文件: ${path.basename(resolved)}`);
        }
        break;
      }
```

- [ ] **Step 3: 前端渲染日志链接**

`webview/app.js:303-311`，将：

```javascript
  let logHtml = '';
  if (result.logPath) {
    const base = String(result.logPath).split(/[\\/]/).pop();
    logHtml = `<br><span class="log-hint">日志: ${escapeHtml(base)}</span>`;
  }
  document.getElementById('resultSummary').innerHTML = `
    耗时: ${escapeHtml(result.duration)}<br>
    ${escapeHtml(result.summary)}${logHtml}
  `;
```

替换为：

```javascript
  let logHtml = '';
  if (result.logPath) {
    const base = String(result.logPath).split(/[\\/]/).pop();
    logHtml = `<br><span class="log-link" id="resultLogFile" title="点击打开日志文件">日志: ${escapeHtml(base)}</span>`;
  }
  document.getElementById('resultSummary').innerHTML = `
    耗时: ${escapeHtml(result.duration)}<br>
    ${escapeHtml(result.summary)}${logHtml}
  `;
  const logLink = document.getElementById('resultLogFile');
  if (logLink) {
    logLink.addEventListener('click', () => {
      vscode.postMessage({ type: 'openLogFile', path: result.logPath });
    });
  }
```

（innerHTML 重写会销毁旧节点，监听器必须在赋值之后绑定，无需清理。）

- [ ] **Step 4: 样式替换 .log-hint → .log-link**

先确认无其他引用：Run `grep -rn "log-hint" webview/` → 仅 style.css 定义与 app.js 旧用法（已在 Step 3 移除）。

`webview/style.css:79-82`，将：

```css
.log-hint {
  opacity: 0.7;
  font-size: 12px;
}
```

替换为：

```css
.log-link {
  color: var(--vscode-textLink-foreground);
  font-size: 12px;
  cursor: pointer;
}
.log-link:hover { text-decoration: underline; }
```

- [ ] **Step 5: 编译验证**

Run: `npm run compile`
Expected: 无错误退出（tsc 校验 types.ts 联合类型与 WebviewProvider 的 message 收窄）

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/WebviewProvider.ts webview/app.js webview/style.css out/WebviewProvider.js out/WebviewProvider.js.map
git commit -m "feat: 部署完成卡片日志文件名可点击，直接打开本次日志"
```

（编译产物按仓库惯例随源码提交，见 bf33971；但必须精确指定 out 文件路径，不得 `git add out/` —— 工作区可能存在其他任务遗留的未提交编译产物，如 DeployPipeline.js 的 bug 修复，不可混入本提交。）

- [ ] **Step 7: 人工验收（交给用户）**

`npm run package` 重新打包 → Trae 安装 vsix → 触发部署成功与失败各一次 → 核对 spec 验收标准 3、4、5：点击「日志: xxx.log」在编辑器新标签打开、落盘失败时无日志行且无报错。
