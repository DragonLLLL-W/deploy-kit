# Deploy Kit 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 VS Code 扩展 Deploy Kit，将「切分支 → git pull → 构建 → SCP 上传」简化为一键部署。

**Architecture:** VS Code Extension API + Webview 侧边栏面板。后端用 TypeScript 实现配置管理（globalState + SecretStorage）和部署流水线（simple-git + node-ssh），前端用纯 HTML/CSS/JS 实现项目列表、配置表单、部署进度三个视图。

**Tech Stack:** TypeScript, VS Code Extension API, simple-git v3.25+, node-ssh v13.2+, 纯 HTML/CSS/JS Webview

## Global Constraints

- VS Code 引擎版本 ≥ 1.85.0
- 运行时依赖: `simple-git`, `node-ssh`
- 开发依赖: `@types/vscode`, `@vscode/vsce`, `typescript`
- 配置存储: `globalState` (项目配置) + `SecretStorage` (密码)
- Webview 前端: 无框架，纯 HTML/CSS/JS
- 平台: Windows 主要，兼容 macOS/Linux
- 分发: 仅 VSIX，不上 Marketplace

---

### Task 1: 项目脚手架

**Files:**
- Create: `deploy-kit/package.json`
- Create: `deploy-kit/tsconfig.json`
- Create: `deploy-kit/.vscodeignore`

**Interfaces:**
- Produces: npm 项目结构，供后续所有 Task 使用

- [ ] **Step 1: 初始化 package.json**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npm init -y
```

- [ ] **Step 2: 写入完整的 package.json**

```json
{
  "name": "deploy-kit",
  "displayName": "Deploy Kit",
  "description": "一键部署前端项目到 Linux 服务器",
  "version": "1.0.0",
  "publisher": "deploy-kit",
  "private": true,
  "license": "MIT",
  "engines": {
    "vscode": "^1.85.0"
  },
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "deploy-kit-sidebar",
          "title": "Deploy Kit",
          "icon": "media/icon.svg"
        }
      ]
    },
    "views": {
      "deploy-kit-sidebar": [
        {
          "type": "webview",
          "id": "deploy-kit.view",
          "name": "项目列表"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.2.0",
    "typescript": "^5.3.0"
  },
  "dependencies": {
    "simple-git": "^3.25.0",
    "node-ssh": "^13.2.0"
  }
}
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "lib": ["ES2022"],
    "sourceMap": true,
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "out", "webview"]
}
```

- [ ] **Step 4: 创建 .vscodeignore**

```
.vscode/**
src/**
tsconfig.json
node_modules/.cache
```

- [ ] **Step 5: 安装依赖并验证**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npm install
```

- [ ] **Step 6: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git init
git add package.json tsconfig.json .vscodeignore
git commit -m "chore: scaffold deploy-kit project"
```

---

### Task 2: 类型定义

**Files:**
- Create: `deploy-kit/src/types.ts`

**Interfaces:**
- Produces: `Project`, `ServerConfig`, `ScpOptions`, `DeployStep`, `StepStatus`, `WebviewMessage`, `ExtensionMessage` 等类型，供所有后续模块使用

- [ ] **Step 1: 编写 types.ts**

```typescript
// ========== 数据模型 ==========

export interface ServerConfig {
  host: string;
  user: string;
  remotePath: string;
  port: number;
}

export interface ScpOptions {
  recursive: boolean;
  legacyProtocol: boolean;
  preserve: boolean;
  compress: boolean;
  verbose: boolean;
}

export interface Project {
  id: string;
  name: string;
  localPath: string;
  branch: string;
  buildCommand: string;
  uploadDir: string;
  server: ServerConfig;
  scpOptions: ScpOptions;
}

// ========== 部署状态 ==========

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface DeployStep {
  step: 'checkout' | 'pull' | 'build' | 'upload' | 'complete';
  label: string;
  status: StepStatus;
  detail: string;
}

export interface DeployProgress {
  percent: number;
  transferred: string;
  total: string;
}

// ========== 消息通信协议 ==========

// 前端 → 后端
export type WebviewMessage =
  | { type: 'getProjects' }
  | { type: 'saveProject'; project: Project }
  | { type: 'deleteProject'; id: string }
  | { type: 'startDeploy'; id: string }
  | { type: 'cancelDeploy' };

// 后端 → 前端
export type ExtensionMessage =
  | { type: 'projectsList'; projects: Project[] }
  | { type: 'deployStep'; step: DeployStep }
  | { type: 'deployLog'; line: string }
  | { type: 'deployProgress'; progress: DeployProgress }
  | { type: 'deployComplete'; success: boolean; duration: string; summary: string };
```

- [ ] **Step 2: 编译验证**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/types.ts
git commit -m "feat: add type definitions for deploy-kit"
```

---

### Task 3: 配置管理器 ConfigManager

**Files:**
- Create: `deploy-kit/src/ConfigManager.ts`

**Interfaces:**
- Consumes: `Project` from `types.ts`
- Produces: `ConfigManager` 类，提供 `getProjects()`, `saveProject(project)`, `deleteProject(id)`, `getPassword(host, user)`, `storePassword(host, user, password)`, `generateId()` 方法

- [ ] **Step 1: 编写 ConfigManager.ts**

```typescript
import * as vscode from 'vscode';
import { Project } from './types';

const PROJECTS_KEY = 'deploy.projects';

function passwordKey(host: string, user: string): string {
  return `deploy.password.${host}.${user}`;
}

export class ConfigManager {
  constructor(private context: vscode.ExtensionContext) {}

  getProjects(): Project[] {
    return this.context.globalState.get<Project[]>(PROJECTS_KEY, []);
  }

  async saveProject(project: Project): Promise<void> {
    const projects = this.getProjects();
    const index = projects.findIndex(p => p.id === project.id);
    if (index >= 0) {
      projects[index] = project;
    } else {
      projects.push(project);
    }
    await this.context.globalState.update(PROJECTS_KEY, projects);
  }

  async deleteProject(id: string): Promise<void> {
    const projects = this.getProjects().filter(p => p.id !== id);
    await this.context.globalState.update(PROJECTS_KEY, projects);
  }

  async getPassword(host: string, user: string): Promise<string | undefined> {
    return this.context.secrets.get(passwordKey(host, user));
  }

  async storePassword(host: string, user: string, password: string): Promise<void> {
    await this.context.secrets.store(passwordKey(host, user), password);
  }

  async deletePassword(host: string, user: string): Promise<void> {
    await this.context.secrets.delete(passwordKey(host, user));
  }

  generateId(): string {
    return `proj-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/ConfigManager.ts
git commit -m "feat: add ConfigManager for user-level config and password storage"
```

---

### Task 4: 部署流水线 DeployPipeline

**Files:**
- Create: `deploy-kit/src/DeployPipeline.ts`

**Interfaces:**
- Consumes: `Project`, `DeployStep`, `DeployProgress` from `types.ts`
- Produces: `DeployPipeline` 类，提供 `deploy(project, password, callbacks)` 方法，返回 `{ success, duration, summary }`

- [ ] **Step 1: 编写 DeployPipeline.ts**

```typescript
import * as cp from 'child_process';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { NodeSSH } from 'node-ssh';
import { Project, DeployStep, StepStatus, DeployProgress } from './types';

export interface DeployCallbacks {
  onStep: (step: DeployStep) => void;
  onLog: (line: string) => void;
  onProgress: (progress: DeployProgress) => void;
  onCancel?: () => boolean; // 返回 true 表示已取消
}

export class DeployPipeline {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  async deploy(
    project: Project,
    password: string,
    callbacks: DeployCallbacks
  ): Promise<{ success: boolean; duration: string; summary: string }> {
    const startTime = Date.now();
    this.cancelled = false;

    try {
      // Step 1: 切换分支
      await this.checkoutBranch(project, callbacks);
      if (this.cancelled) throw new Error('用户取消部署');

      // Step 2: 拉取代码
      await this.pullCode(project, callbacks);
      if (this.cancelled) throw new Error('用户取消部署');

      // Step 3: 构建
      await this.runBuild(project, callbacks);
      if (this.cancelled) throw new Error('用户取消部署');

      // Step 4: SCP 上传
      await this.uploadViaScp(project, password, callbacks);
      if (this.cancelled) throw new Error('用户取消部署');

      // Step 5: 完成
      const duration = this.formatDuration(Date.now() - startTime);
      callbacks.onStep({
        step: 'complete',
        label: '部署完成',
        status: 'done',
        detail: `总耗时 ${duration}`
      });

      return {
        success: true,
        duration,
        summary: `${project.name} → ${project.server.user}@${project.server.host}:${project.server.remotePath}`
      };
    } catch (err: any) {
      const duration = this.formatDuration(Date.now() - startTime);
      return {
        success: false,
        duration,
        summary: err.message || '部署失败'
      };
    }
  }

  // ========== Step 1: 切换分支 ==========
  private async checkoutBranch(project: Project, cbs: DeployCallbacks): Promise<void> {
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

      cbs.onStep({
        step: 'checkout',
        label: '切换分支',
        status: 'done',
        detail: `已切换到 ${project.branch}`
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

  // ========== Step 2: 拉取代码 ==========
  private async pullCode(project: Project, cbs: DeployCallbacks): Promise<void> {
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

      cbs.onStep({
        step: 'pull',
        label: '拉取代码',
        status: 'done',
        detail: summary
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

  // ========== Step 3: 构建 ==========
  private runBuild(project: Project, cbs: DeployCallbacks): Promise<void> {
    return new Promise((resolve, reject) => {
      cbs.onStep({
        step: 'build',
        label: '构建',
        status: 'running',
        detail: project.buildCommand
      });

      cbs.onLog(`$ ${project.buildCommand}`);

      const [cmd, ...args] = project.buildCommand.split(/\s+/);
      const child = cp.spawn(cmd, args, {
        cwd: project.localPath,
        shell: true,
        env: { ...process.env }
      });

      child.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => cbs.onLog(line));
      });

      child.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => cbs.onLog(line));
      });

      child.on('close', (code: number) => {
        if (code !== 0) {
          cbs.onStep({
            step: 'build',
            label: '构建',
            status: 'error',
            detail: `构建失败，退出码 ${code}`
          });
          reject(new Error(`构建失败，退出码 ${code}`));
        } else {
          cbs.onStep({
            step: 'build',
            label: '构建',
            status: 'done',
            detail: '构建成功'
          });
          resolve();
        }
      });

      child.on('error', (err: Error) => {
        cbs.onStep({
          step: 'build',
          label: '构建',
          status: 'error',
          detail: err.message
        });
        reject(new Error(`构建命令执行失败: ${err.message}`));
      });
    });
  }

  // ========== Step 4: SCP 上传 ==========
  private async uploadViaScp(
    project: Project,
    password: string,
    cbs: DeployCallbacks
  ): Promise<void> {
    const ssh = new NodeSSH();

    cbs.onStep({
      step: 'upload',
      label: 'SCP 上传',
      status: 'running',
      detail: `连接 ${project.server.user}@${project.server.host}:${project.server.port}`
    });

    cbs.onLog(`$ scp ${this.buildScpArgs(project)} ${project.uploadDir} ${project.server.user}@${project.server.host}:${project.server.remotePath}`);

    try {
      await ssh.connect({
        host: project.server.host,
        username: project.server.user,
        password: password,
        port: project.server.port,
        tryKeyboard: true,
        readyTimeout: 30000
      });

      cbs.onLog('SSH 连接成功');

      // 上传目录
      const localDir = project.uploadDir.replace(/\/\*$/, '');
      const failed: Array<{ local: string; remote: string; error: Error }> = [];
      const successful: Array<{ local: string; remote: string }> = [];

      await ssh.putDirectory(localDir, project.server.remotePath, {
        recursive: true,
        concurrency: 4,
        tick: (localPath: string, remotePath: string, error: Error | null) => {
          if (error) {
            failed.push({ local: localPath, remote: remotePath, error });
          } else {
            successful.push({ local: localPath, remote: remotePath });
          }
          const total = failed.length + successful.length;
          if (total > 0) {
            cbs.onProgress({
              percent: 0,
              transferred: `${successful.length} 个文件`,
              total: `${total} 个文件已处理`
            });
          }
        }
      });

      if (failed.length > 0) {
        cbs.onLog(`${failed.length} 个文件上传失败`);
        failed.forEach(f => cbs.onLog(`  ✗ ${f.local}: ${f.error.message}`));
      }

      cbs.onLog(`${successful.length} 个文件上传成功`);
      ssh.dispose();

      cbs.onStep({
        step: 'upload',
        label: 'SCP 上传',
        status: 'done',
        detail: `${successful.length} 个文件上传成功`
      });
    } catch (err: any) {
      cbs.onLog(`连接失败: ${err.message}`);
      try { ssh.dispose(); } catch {}
      cbs.onStep({
        step: 'upload',
        label: 'SCP 上传',
        status: 'error',
        detail: err.message
      });
      throw new Error(`上传失败: ${err.message}`);
    }
  }

  private buildScpArgs(project: Project): string {
    const opts = project.scpOptions;
    const args: string[] = [];
    if (opts.recursive) args.push('-r');
    if (opts.legacyProtocol) args.push('-O');
    if (opts.preserve) args.push('-p');
    if (opts.compress) args.push('-C');
    if (opts.verbose) args.push('-v');
    if (project.server.port !== 22) args.push(`-P ${project.server.port}`);
    return args.join(' ');
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return `${minutes} 分 ${remainSeconds} 秒`;
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/DeployPipeline.ts
git commit -m "feat: add DeployPipeline with 5-step deploy flow"
```

---

### Task 5: Webview Provider

**Files:**
- Create: `deploy-kit/src/WebviewProvider.ts`

**Interfaces:**
- Consumes: `Project`, `WebviewMessage`, `ExtensionMessage` from `types.ts`; `ConfigManager` from `ConfigManager.ts`; `DeployPipeline` from `DeployPipeline.ts`
- Produces: `DeployViewProvider` 类（implements `vscode.WebviewViewProvider`），管理 Webview 生命周期和消息路由

- [ ] **Step 1: 编写 WebviewProvider.ts**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './ConfigManager';
import { DeployPipeline } from './DeployPipeline';
import { Project, WebviewMessage } from './types';

export class DeployViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'deploy-kit.view';
  private _view?: vscode.WebviewView;
  private configManager: ConfigManager;
  private pipeline: DeployPipeline;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this.configManager = new ConfigManager(context);
    this.pipeline = new DeployPipeline();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'webview')
      ]
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // 监听来自 Webview 的消息
    webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      []
    );
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'style.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webview', 'app.js')
    );

    html = html.replace('${styleUri}', styleUri.toString());
    html = html.replace('${scriptUri}', scriptUri.toString());

    return html;
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'getProjects': {
        const projects = this.configManager.getProjects();
        this.postMessage({ type: 'projectsList', projects });
        break;
      }

      case 'saveProject': {
        const project = message.project;
        if (!project.id) {
          project.id = this.configManager.generateId();
        }
        await this.configManager.saveProject(project);

        // 保存密码
        if (project.server.host && project.server.user) {
          // 密码从 Webview 单独发送，这里暂不处理
        }

        const projects = this.configManager.getProjects();
        this.postMessage({ type: 'projectsList', projects });
        break;
      }

      case 'deleteProject': {
        await this.configManager.deleteProject(message.id);
        const projects = this.configManager.getProjects();
        this.postMessage({ type: 'projectsList', projects });
        break;
      }

      case 'startDeploy': {
        const project = this.configManager.getProjects().find(p => p.id === message.id);
        if (!project) {
          this.postMessage({
            type: 'deployComplete',
            success: false,
            duration: '0 秒',
            summary: '项目不存在'
          });
          return;
        }

        // 获取密码
        const password = await this.configManager.getPassword(
          project.server.host,
          project.server.user
        );
        if (!password) {
          this.postMessage({
            type: 'deployComplete',
            success: false,
            duration: '0 秒',
            summary: '未找到服务器密码，请编辑项目重新输入密码'
          });
          return;
        }

        const result = await this.pipeline.deploy(project, password, {
          onStep: (step) => this.postMessage({ type: 'deployStep', step }),
          onLog: (line) => this.postMessage({ type: 'deployLog', line }),
          onProgress: (progress) => this.postMessage({ type: 'deployProgress', progress }),
          onCancel: () => false
        });

        this.postMessage({ type: 'deployComplete', ...result });
        break;
      }

      case 'cancelDeploy': {
        this.pipeline.cancel();
        break;
      }
    }
  }

  private postMessage(message: any): void {
    this._view?.webview.postMessage(message);
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/WebviewProvider.ts
git commit -m "feat: add WebviewProvider with message routing"
```

---

### Task 6: 扩展入口 extension.ts

**Files:**
- Create: `deploy-kit/src/extension.ts`

**Interfaces:**
- Consumes: `DeployViewProvider` from `WebviewProvider.ts`
- Produces: `activate` 和 `deactivate` 函数，注册 provider

- [ ] **Step 1: 编写 extension.ts**

```typescript
import * as vscode from 'vscode';
import { DeployViewProvider } from './WebviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DeployViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeployViewProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    )
  );
}

export function deactivate(): void {
  // 清理逻辑（如有需要）
}
```

- [ ] **Step 2: 编译整个项目**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc -p ./
```

验证 `out/` 目录下生成了 `extension.js`, `WebviewProvider.js`, `DeployPipeline.js`, `ConfigManager.js`, `types.js`。

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add src/extension.ts out/
git commit -m "feat: add extension entry point"
```

---

### Task 7: Webview 前端 — HTML + CSS

**Files:**
- Create: `deploy-kit/webview/index.html`
- Create: `deploy-kit/webview/style.css`

**Interfaces:**
- Consumes: 无（独立前端）
- Produces: Webview UI 骨架和样式，供 Task 8 的 `app.js` 操作 DOM

- [ ] **Step 1: 编写 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Deploy Kit</title>
</head>
<body>
  <!-- 标题栏 -->
  <div id="header">
    <h2 id="headerTitle">🚀 部署</h2>
    <button id="btnAdd" class="btn-icon" title="添加项目">+</button>
  </div>

  <!-- 项目列表视图 -->
  <div id="viewList">
    <div id="projectList"></div>
  </div>

  <!-- 表单视图 -->
  <div id="viewForm" class="hidden">
    <div class="form-header">
      <button id="btnBack" class="btn-text">← 返回</button>
      <span id="formTitle">添加项目</span>
      <button id="btnSave" class="btn-primary">保存</button>
    </div>
    <div class="form-body">
      <label>项目名称</label>
      <input id="fName" type="text" placeholder="如：web_seller（测试环境）" />

      <label>本地路径</label>
      <div class="input-row">
        <input id="fLocalPath" type="text" placeholder="C:/Users/admin/Desktop/web_seller" />
        <button id="btnBrowseLocal" class="btn-icon-sm">📁</button>
      </div>

      <label>目标分支</label>
      <input id="fBranch" type="text" placeholder="test" />

      <label>构建命令</label>
      <input id="fBuildCmd" type="text" placeholder="pnpm test" />

      <label>上传目录</label>
      <div class="input-row">
        <input id="fUploadDir" type="text" placeholder="dist/*" />
        <button id="btnBrowseUpload" class="btn-icon-sm">📁</button>
      </div>

      <div class="section-title">服务器配置</div>

      <label>主机地址</label>
      <input id="fHost" type="text" placeholder="118.31.49.88" />

      <label>用户名</label>
      <input id="fUser" type="text" placeholder="frontend_user" />

      <label>密码</label>
      <div class="input-row">
        <input id="fPassword" type="password" placeholder="输入服务器密码" />
        <button id="btnTogglePwd" class="btn-icon-sm">👁</button>
      </div>

      <label>远程路径</label>
      <input id="fRemotePath" type="text" placeholder="testseller_website/" />

      <label>端口</label>
      <input id="fPort" type="number" value="22" placeholder="22" />

      <div class="section-title">SCP 选项</div>

      <label class="checkbox-label">
        <input id="fScpR" type="checkbox" checked /> -r 递归复制目录
      </label>
      <label class="checkbox-label">
        <input id="fScpO" type="checkbox" checked /> -O 旧版 SCP 协议
      </label>
      <label class="checkbox-label">
        <input id="fScpP" type="checkbox" /> -p 保留文件时间戳
      </label>
      <label class="checkbox-label">
        <input id="fScpC" type="checkbox" /> -C 传输压缩
      </label>
      <label class="checkbox-label">
        <input id="fScpV" type="checkbox" /> -v 详细输出
      </label>
    </div>
  </div>

  <!-- 部署进度视图 -->
  <div id="viewProgress" class="hidden">
    <div class="progress-header">
      <button id="btnCancel" class="btn-text">← 取消</button>
      <span id="progressTitle">部署中</span>
    </div>
    <div id="stepList"></div>
    <div class="log-area">
      <div class="log-title">[部署日志]</div>
      <pre id="logContent"></pre>
    </div>
  </div>

  <!-- 部署完成视图 -->
  <div id="viewComplete" class="hidden">
    <div id="completeIcon"></div>
    <div id="completeText"></div>
    <div id="completeSummary"></div>
    <button id="btnBackToList" class="btn-primary">返回列表</button>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 style.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  padding: 0;
}

.hidden { display: none !important; }

/* ===== 标题栏 ===== */
#header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}

#header h2 {
  font-size: 14px;
  font-weight: 600;
}

.btn-icon {
  background: none;
  border: none;
  color: var(--vscode-foreground);
  font-size: 20px;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 4px;
}
.btn-icon:hover { background: var(--vscode-toolbar-hoverBackground); }

.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 6px 14px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }

.btn-text {
  background: none;
  border: none;
  color: var(--vscode-textLink-foreground);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 0;
}

/* ===== 项目卡片 ===== */
#projectList {
  padding: 8px;
}

.project-card {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 8px;
}

.project-card .name {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}

.project-card .meta {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.8;
}

.project-card .actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.btn-sm {
  background: none;
  border: 1px solid var(--vscode-panel-border);
  color: var(--vscode-foreground);
  padding: 3px 10px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
}
.btn-sm:hover { background: var(--vscode-toolbar-hoverBackground); }
.btn-sm.deploy {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  padding: 6px 16px;
  font-size: 12px;
}
.btn-sm.deploy:hover { background: var(--vscode-button-hoverBackground); }
.btn-sm.danger { color: var(--vscode-errorForeground); }

/* ===== 表单 ===== */
.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}

.form-header span {
  font-size: 13px;
  font-weight: 600;
}

.form-body {
  padding: 12px 16px;
  overflow-y: auto;
  max-height: calc(100vh - 100px);
}

.form-body label {
  display: block;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin: 10px 0 4px;
}

.form-body input[type="text"],
.form-body input[type="password"],
.form-body input[type="number"] {
  width: 100%;
  padding: 5px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  border-radius: 2px;
  font-size: 12px;
  font-family: var(--vscode-font-family);
}

.form-body input:focus {
  outline: 1px solid var(--vscode-focusBorder);
}

.input-row {
  display: flex;
  gap: 4px;
}
.input-row input { flex: 1; }

.btn-icon-sm {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  padding: 4px 8px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
}
.btn-icon-sm:hover { background: var(--vscode-button-secondaryHoverBackground); }

.section-title {
  font-size: 12px;
  font-weight: 600;
  margin: 16px 0 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
  color: var(--vscode-textLink-foreground);
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 6px;
  font-size: 12px !important;
  color: var(--vscode-foreground) !important;
  cursor: pointer;
  margin: 6px 0 !important;
}

.checkbox-label input[type="checkbox"] {
  accent-color: var(--vscode-focusBorder);
}

/* ===== 进度视图 ===== */
.progress-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
}

.progress-header span {
  font-size: 13px;
  font-weight: 600;
}

#stepList {
  padding: 12px 16px;
}

.step-item {
  margin-bottom: 10px;
}

.step-item .step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.step-item .step-icon {
  width: 16px;
  text-align: center;
  font-size: 12px;
}

.step-item .step-icon.pending { color: var(--vscode-descriptionForeground); }
.step-item .step-icon.running { color: var(--vscode-textLink-foreground); }
.step-item .step-icon.done { color: var(--vscode-testing-iconPassed); }
.step-item .step-icon.error { color: var(--vscode-testing-iconFailed); }

.step-item .step-detail {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: 22px;
  margin-top: 2px;
}

.progress-bar {
  height: 4px;
  background: var(--vscode-progressBar-background);
  border-radius: 2px;
  margin: 4px 0 4px 22px;
  overflow: hidden;
}

.progress-bar .fill {
  height: 100%;
  background: var(--vscode-textLink-foreground);
  transition: width 0.3s ease;
}

/* ===== 日志区域 ===== */
.log-area {
  margin: 8px 16px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  overflow: hidden;
}

.log-title {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  background: var(--vscode-editor-background);
  border-bottom: 1px solid var(--vscode-panel-border);
}

#logContent {
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  padding: 8px 10px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}

/* ===== 完成视图 ===== */
#viewComplete {
  padding: 40px 16px;
  text-align: center;
}

#completeIcon {
  font-size: 48px;
  margin-bottom: 16px;
}

#completeText {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}

#completeSummary {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 24px;
  line-height: 1.6;
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 40px 16px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
}
```

- [ ] **Step 3: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add webview/index.html webview/style.css
git commit -m "feat: add webview HTML structure and CSS styles"
```

---

### Task 8: Webview 前端 — JS 逻辑

**Files:**
- Create: `deploy-kit/webview/app.js`

**Interfaces:**
- Consumes: DOM 元素（index.html 中定义的 id）；`ExtensionMessage` 类型（通过 postMessage 接收）
- Produces: 三个视图切换、项目 CRUD、部署进度展示、日志滚动

- [ ] **Step 1: 编写 app.js**

```javascript
// ========== 全局状态 ==========
const vscode = acquireVsCodeApi();
let projects = [];
let editingProjectId = null;
const stepLabels = {
  checkout: '切换分支',
  pull: '拉取代码',
  build: '构建',
  upload: 'SCP 上传',
  complete: '完成'
};

// ========== 视图切换 ==========
function showView(viewId) {
  document.querySelectorAll('#viewList, #viewForm, #viewProgress, #viewComplete')
    .forEach(el => el.classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}

// ========== 项目列表 ==========
function renderProjectList() {
  const container = document.getElementById('projectList');
  if (projects.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无项目，点击右上角 + 添加</div>';
    return;
  }

  container.innerHTML = projects.map(p => `
    <div class="project-card">
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="meta">
        📂 ${escapeHtml(p.localPath)}<br>
        🌿 ${escapeHtml(p.branch)} &nbsp; 📦 ${escapeHtml(p.buildCommand)}<br>
        ➡ ${escapeHtml(p.server.user)}@${escapeHtml(p.server.host)}:${escapeHtml(p.server.remotePath)}
      </div>
      <div class="actions">
        <button class="btn-sm" onclick="editProject('${p.id}')">✏️ 编辑</button>
        <button class="btn-sm danger" onclick="deleteProject('${p.id}')">🗑️ 删除</button>
        <button class="btn-sm deploy" onclick="startDeploy('${p.id}')">🚀 一键部署</button>
      </div>
    </div>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 表单逻辑 ==========
function showForm(project) {
  editingProjectId = project ? project.id : null;
  document.getElementById('formTitle').textContent = project ? '编辑项目' : '添加项目';

  document.getElementById('fName').value = project ? project.name : '';
  document.getElementById('fLocalPath').value = project ? project.localPath : '';
  document.getElementById('fBranch').value = project ? project.branch : '';
  document.getElementById('fBuildCmd').value = project ? project.buildCommand : '';
  document.getElementById('fUploadDir').value = project ? project.uploadDir : '';
  document.getElementById('fHost').value = project ? project.server.host : '';
  document.getElementById('fUser').value = project ? project.server.user : '';
  document.getElementById('fPassword').value = '';
  document.getElementById('fRemotePath').value = project ? project.server.remotePath : '';
  document.getElementById('fPort').value = project ? project.server.port : 22;

  const opts = project ? project.scpOptions : { recursive: true, legacyProtocol: true, preserve: false, compress: false, verbose: false };
  document.getElementById('fScpR').checked = opts.recursive;
  document.getElementById('fScpO').checked = opts.legacyProtocol;
  document.getElementById('fScpP').checked = opts.preserve;
  document.getElementById('fScpC').checked = opts.compress;
  document.getElementById('fScpV').checked = opts.verbose;

  showView('viewForm');
}

function saveProject() {
  const name = document.getElementById('fName').value.trim();
  const localPath = document.getElementById('fLocalPath').value.trim();
  const branch = document.getElementById('fBranch').value.trim();
  const buildCommand = document.getElementById('fBuildCmd').value.trim();
  const uploadDir = document.getElementById('fUploadDir').value.trim();
  const host = document.getElementById('fHost').value.trim();
  const user = document.getElementById('fUser').value.trim();
  const password = document.getElementById('fPassword').value;
  const remotePath = document.getElementById('fRemotePath').value.trim();
  const port = parseInt(document.getElementById('fPort').value) || 22;

  if (!name || !localPath || !branch || !buildCommand || !uploadDir || !host || !user || !remotePath) {
    alert('请填写所有必填字段');
    return;
  }

  const project = {
    id: editingProjectId || '',
    name,
    localPath,
    branch,
    buildCommand,
    uploadDir,
    server: { host, user, remotePath, port },
    scpOptions: {
      recursive: document.getElementById('fScpR').checked,
      legacyProtocol: document.getElementById('fScpO').checked,
      preserve: document.getElementById('fScpP').checked,
      compress: document.getElementById('fScpC').checked,
      verbose: document.getElementById('fScpV').checked
    }
  };

  vscode.postMessage({ type: 'saveProject', project });

  // 如果有密码，单独发送保存密码请求
  if (password) {
    vscode.postMessage({ type: 'savePassword', host, user, password });
  }

  showView('viewList');
}

function editProject(id) {
  const project = projects.find(p => p.id === id);
  if (project) showForm(project);
}

function deleteProject(id) {
  if (confirm('确定要删除这个项目吗？')) {
    vscode.postMessage({ type: 'deleteProject', id });
  }
}

// ========== 部署进度 ==========
function startDeploy(id) {
  showView('viewProgress');
  document.getElementById('progressTitle').textContent = '部署中';
  document.getElementById('stepList').innerHTML = '';
  document.getElementById('logContent').textContent = '';

  // 初始化 5 个步骤
  const steps = ['checkout', 'pull', 'build', 'upload', 'complete'];
  const stepList = document.getElementById('stepList');
  steps.forEach(s => {
    const div = document.createElement('div');
    div.className = 'step-item';
    div.id = `step-${s}`;
    div.innerHTML = `
      <div class="step-header">
        <span class="step-icon pending">⏳</span>
        <span>${stepLabels[s]}</span>
      </div>
      <div class="step-detail"></div>
    `;
    stepList.appendChild(div);
  });

  vscode.postMessage({ type: 'startDeploy', id });
}

function updateStep(step) {
  const el = document.getElementById(`step-${step.step}`);
  if (!el) return;

  const iconMap = { pending: '⏳', running: '🔄', done: '✅', error: '❌' };
  const icon = el.querySelector('.step-icon');
  icon.textContent = iconMap[step.status] || '⏳';
  icon.className = `step-icon ${step.status}`;

  const detail = el.querySelector('.step-detail');
  detail.textContent = step.detail || '';

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

function appendLog(line) {
  const log = document.getElementById('logContent');
  log.textContent += line + '\n';
  log.scrollTop = log.scrollHeight;
}

function updateProgress(progress) {
  const el = document.getElementById('step-upload');
  if (!el) return;
  const bar = el.querySelector('.progress-bar .fill');
  if (bar) bar.style.width = progress.percent + '%';
  const detail = el.querySelector('.step-detail');
  if (detail) detail.textContent = `${progress.transferred} / ${progress.total}`;
}

function showComplete(result) {
  showView('viewComplete');
  document.getElementById('completeIcon').textContent = result.success ? '✅' : '❌';
  document.getElementById('completeText').textContent = result.success ? '部署成功' : '部署失败';
  document.getElementById('completeSummary').innerHTML = `
    耗时: ${escapeHtml(result.duration)}<br>
    ${escapeHtml(result.summary)}
  `;
}

// ========== 事件绑定 ==========
document.getElementById('btnAdd').addEventListener('click', () => showForm());
document.getElementById('btnBack').addEventListener('click', () => showView('viewList'));
document.getElementById('btnSave').addEventListener('click', saveProject);
document.getElementById('btnCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelDeploy' });
  showView('viewList');
});
document.getElementById('btnBackToList').addEventListener('click', () => showView('viewList'));
document.getElementById('btnTogglePwd').addEventListener('click', () => {
  const input = document.getElementById('fPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
});
document.getElementById('btnBrowseLocal').addEventListener('click', () => {
  vscode.postMessage({ type: 'browseFolder', field: 'localPath' });
});
document.getElementById('btnBrowseUpload').addEventListener('click', () => {
  vscode.postMessage({ type: 'browseFolder', field: 'uploadDir' });
});

// ========== 接收来自 Extension 的消息 ==========
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'projectsList':
      projects = message.projects;
      renderProjectList();
      break;
    case 'deployStep':
      updateStep(message.step);
      break;
    case 'deployLog':
      appendLog(message.line);
      break;
    case 'deployProgress':
      updateProgress(message.progress);
      break;
    case 'deployComplete':
      showComplete(message);
      break;
  }
});

// ========== 初始化 ==========
vscode.postMessage({ type: 'getProjects' });
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add webview/app.js
git commit -m "feat: add webview JS logic with three views and message handling"
```

---

### Task 9: 图标、调试配置、README

**Files:**
- Create: `deploy-kit/media/icon.svg`
- Create: `deploy-kit/.vscode/launch.json`
- Create: `deploy-kit/.vscode/tasks.json`
- Create: `deploy-kit/README.md`

**Interfaces:**
- 无代码依赖，纯资源文件

- [ ] **Step 1: 创建 Activity Bar 图标 media/icon.svg**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="7 10 12 15 17 10"/>
  <line x1="12" y1="15" x2="12" y2="3"/>
</svg>
```

- [ ] **Step 2: 创建调试配置 .vscode/launch.json**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}"
      ],
      "outFiles": [
        "${workspaceFolder}/out/**/*.js"
      ],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

- [ ] **Step 3: 创建编译任务 .vscode/tasks.json**

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "compile",
      "group": {
        "kind": "build",
        "isDefault": true
      },
      "problemMatcher": ["$tsc"],
      "label": "npm: compile"
    }
  ]
}
```

- [ ] **Step 4: 创建 README.md**

```markdown
# Deploy Kit

一键部署前端项目到 Linux 服务器。

## 功能

- 🚀 一键部署：切分支 → git pull → 构建 → SCP 上传
- 📋 多项目管理：支持多个项目独立配置
- 🔒 密码加密存储：使用 VS Code SecretStorage
- 📊 实时进度：5 步部署流程可视化
- 🎛️ SCP 选项：支持 -r, -O, -p, -C, -v

## 安装

```bash
code --install-extension deploy-kit-1.0.0.vsix
```

## 使用

1. 点击左侧 Activity Bar 的部署图标
2. 添加服务器和项目配置
3. 点击「一键部署」

## 配置存储

所有配置存储在 VS Code 用户级，不会随项目进入 Git。
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add media/icon.svg .vscode/launch.json .vscode/tasks.json README.md
git commit -m "chore: add icon, debug config, and README"
```

---

### Task 10: 集成测试与打包

**Files:**
- Modify: `deploy-kit/package.json`（验证完整性）
- Modify: `deploy-kit/src/WebviewProvider.ts`（补充 savePassword 消息处理）

**Interfaces:**
- 无新增接口，最终集成验证

- [ ] **Step 1: 补充 WebviewProvider 的 savePassword 处理**

在 `WebviewProvider.ts` 的 `handleMessage` 方法中，`switch` 语句的 `case 'saveProject':` 之后添加：

```typescript
case 'savePassword': {
  const { host, user, password } = message as any;
  if (host && user && password) {
    await this.configManager.storePassword(host, user, password);
  }
  break;
}
```

同时在 `types.ts` 的 `WebviewMessage` 类型中添加：

```typescript
| { type: 'savePassword'; host: string; user: string; password: string }
| { type: 'browseFolder'; field: string }
```

- [ ] **Step 2: 完整编译**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx tsc -p ./
```

确保无编译错误，`out/` 目录下所有 `.js` 文件生成正确。

- [ ] **Step 3: 打包 VSIX**

```bash
cd C:/Users/admin/Desktop/deploy-kit
npx vsce package
```

应输出 `deploy-kit-1.0.0.vsix`。

- [ ] **Step 4: 验证 VSIX 内容**

```bash
cd C:/Users/admin/Desktop/deploy-kit
# 检查包内文件
npx vsce ls
```

确认包含 `out/extension.js`, `webview/`, `media/icon.svg`, `package.json`, `README.md`。

- [ ] **Step 5: 在 VS Code 中安装测试**

```bash
code --install-extension deploy-kit-1.0.0.vsix
```

重启 VS Code，检查：
- Activity Bar 左侧是否出现部署图标
- 点击图标是否打开侧边栏面板
- 添加项目、编辑、删除是否正常
- 点击「一键部署」是否按序执行

- [ ] **Step 6: Commit**

```bash
cd C:/Users/admin/Desktop/deploy-kit
git add -A
git commit -m "feat: finalize deploy-kit with VSIX packaging"
```