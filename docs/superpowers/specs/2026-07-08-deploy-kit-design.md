# Deploy Kit — 设计文档

**日期**: 2026-07-08  
**状态**: 待审阅  
**目标**: 构建一个 VS Code/Trae 扩展，将「切分支 → git pull → 构建 → SCP 上传」流程简化为一键操作。

---

## 1. 项目背景

### 1.1 当前痛点

- 每次部署需要手动复制粘贴 SCP 命令和密码，效率低
- 多个项目同时开发时容易用错命令
- 每次部署前需要手动切分支、拉代码、构建，步骤繁琐
- 配置信息散落在个人笔记文件中，不便于管理

### 1.2 目标用户

个人前端开发者，使用 VS Code 或 Trae 编辑器，需要频繁将前端构建产物部署到测试服务器。

### 1.3 非目标

- 不需要回滚功能（生产环境有专人管理，本工具仅用于测试环境）
- 不需要发布到 VS Code Marketplace（仅打包 VSIX 分发）
- 不需要团队协作特性（配置存储在用户级，对同事不可见）

---

## 2. 功能需求

### 2.1 核心功能：一键部署

用户点击项目卡片上的「一键部署」按钮后，自动按序执行：

| 步骤 | 操作 | 失败处理 |
|------|------|----------|
| 1. 切换分支 | `git checkout <branch>` | 失败则终止，提示未提交的更改 |
| 2. 拉取代码 | `git pull` | 失败则终止，提示冲突 |
| 3. 构建 | 执行用户配置的构建命令（如 `pnpm test`） | 失败则终止，显示构建错误 |
| 4. SCP 上传 | 将构建产物通过 SCP 上传到服务器 | 失败则终止，提示网络/认证错误 |
| 5. 完成 | 显示部署摘要 | - |

### 2.2 项目管理

- 支持添加多个项目，每个项目独立配置
- 项目卡片展示：项目名、本地目录、目标分支、构建命令、服务器地址
- 支持编辑、删除已有项目

### 2.3 配置存储

- 所有配置存储在 VS Code 用户级 `globalState` 中
- 密码使用 `SecretStorage` API 加密存储
- 配置不随项目文件进入 Git，对同事完全不可见

### 2.4 实时反馈

- 部署时显示 5 步进度状态（等待中 / 进行中 / 成功 / 失败）
- 实时展示 shell 命令输出日志
- SCP 上传步骤显示百分比进度条

### 2.5 分发方式

- 打包为 `.vsix` 文件
- 在 VS Code 和 Trae 中均可通过 `--install-extension` 安装
- 不上架 VS Code Marketplace

---

## 3. 配置结构

### 3.1 存储位置

- **项目配置**: `globalState` — key: `deploy.projects`
- **密码**: `SecretStorage` — key: `deploy.password.{host}.{user}`

### 3.2 数据模型

```typescript
interface Project {
  id: string;                    // 唯一标识，UUID
  name: string;                  // 项目名称，如 "web_seller（测试环境）"
  localPath: string;             // 本地项目根目录
  branch: string;                // 目标分支，如 "test"
  buildCommand: string;          // 构建命令，如 "pnpm test"
  uploadDir: string;             // 上传目录，如 "C:/Users/admin/Desktop/web_seller/dist/*"
  server: ServerConfig;
  scpOptions: ScpOptions;
}

interface ServerConfig {
  host: string;                  // 服务器 IP 或域名
  user: string;                  // SSH 用户名
  remotePath: string;            // 远程目标路径，如 "testseller_website/"
  port: number;                  // SSH 端口，默认 22
}

interface ScpOptions {
  recursive: boolean;            // -r  递归复制目录（默认 true）
  legacyProtocol: boolean;       // -O  旧版 SCP 协议（默认 true）
  preserve: boolean;             // -p  保留文件时间戳和权限（默认 false）
  compress: boolean;             // -C  传输时压缩（默认 false）
  verbose: boolean;              // -v  详细调试输出（默认 false）
}
```

### 3.3 配置示例

```json
{
  "deploy.projects": [
    {
      "id": "proj-001",
      "name": "web_seller（测试环境）",
      "localPath": "C:/Users/admin/Desktop/web_seller",
      "branch": "test",
      "buildCommand": "pnpm test",
      "uploadDir": "C:/Users/admin/Desktop/web_seller/dist/*",
      "server": {
        "host": "118.31.49.88",
        "user": "frontend_user",
        "remotePath": "testseller_website/",
        "port": 22
      },
      "scpOptions": {
        "recursive": true,
        "legacyProtocol": true,
        "preserve": false,
        "compress": false,
        "verbose": false
      }
    }
  ]
}
```

---

## 4. 技术架构

### 4.1 技术栈

| 层 | 技术 | 选型理由 |
|------|------|----------|
| 开发语言 | TypeScript | VS Code 扩展标配 |
| 扩展入口 | VS Code Extension API | 原生 API，无额外框架 |
| Webview 前端 | 纯 HTML + CSS + Vanilla JS | 极简无依赖，加载快，包体积小 |
| Git 操作 | `simple-git` (v3.25+) | 封装完善的 Git Node 库 |
| SSH/SCP | `node-ssh` (v13.2+) | 基于 ssh2，支持密码认证、上传进度 |
| 打包 | `@vscode/vsce` | 官方 VSIX 打包工具 |
| 兼容目标 | VS Code ≥ 1.85 + Trae | Trae 基于 VS Code OSS，API 兼容 |

### 4.2 项目结构

```
deploy-kit/
├── .vscode/
│   ├── launch.json              # 调试配置
│   └── tasks.json               # 编译任务
├── src/
│   ├── extension.ts             # 入口：注册 provider、命令
│   ├── WebviewProvider.ts       # 管理 Webview 面板生命周期
│   ├── DeployPipeline.ts        # 部署流水线（切分支→pull→构建→上传）
│   ├── ConfigManager.ts         # 配置读写（globalState + SecretStorage）
│   └── types.ts                 # 类型定义
├── webview/
│   ├── index.html               # Webview 入口 HTML
│   ├── style.css                # 面板样式（适配 VS Code 主题）
│   └── app.js                   # 前端逻辑（列表、表单、进度）
├── media/
│   └── icon.svg                 # Activity Bar 图标
├── package.json                 # 扩展清单 + contributes
├── tsconfig.json
└── README.md
```

### 4.3 模块职责

| 模块 | 职责 |
|------|------|
| `extension.ts` | 入口，注册 Activity Bar 图标和 Webview Provider |
| `WebviewProvider.ts` | 管理 Webview 面板生命周期，处理消息通信 |
| `DeployPipeline.ts` | 按序执行 5 步部署流程，每步实时回报状态 |
| `ConfigManager.ts` | 读写 `globalState` 配置，管理 `SecretStorage` 密码 |
| `webview/*` | 纯前端 UI，通过 `postMessage` 与后端通信 |

---

## 5. Webview 界面设计

### 5.1 项目列表视图（默认）

```
┌──────────────────────────────────┐
│  🚀 部署                    [+]  │
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │ web_seller（测试环境）       │  │
│  │ 📂 web_seller               │  │
│  │ 🌿 test                     │  │
│  │ 📦 pnpm test                │  │
│  │ ➡ frontend_user@118.31...   │  │
│  │         ✏️ 编辑  🗑️ 删除     │  │
│  │         [ 🚀 一键部署 ]      │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ web_admin（测试环境）        │  │
│  │ ...                         │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### 5.2 添加/编辑项目表单

```
┌──────────────────────────────────┐
│  ← 返回         添加项目    [保存] │
├──────────────────────────────────┤
│  项目名称: [___________________] │
│  本地路径: [___________________] 📁│
│  目标分支: [___________________] │
│  构建命令: [___________________] │
│  上传目录: [___________________] 📁│
│  ──────── 服务器配置 ────────    │
│  主机地址: [___________________] │
│  用户名:   [___________________] │
│  密码:     [___________________] 👁│
│  远程路径: [___________________] │
│  端口:     [22_______________] │
│  ──────── SCP 选项 ────────      │
│  ☑ -r  递归复制目录               │
│  ☑ -O  旧版SCP协议               │
│  ☐ -p  保留文件时间戳             │
│  ☐ -C  传输压缩                  │
│  ☐ -v  详细输出                  │
└──────────────────────────────────┘
```

### 5.3 部署进度视图

```
┌──────────────────────────────────┐
│  ← 取消     web_seller 部署中     │
├──────────────────────────────────┤
│   ✅ 1. 切换分支 → test           │
│   ✅ 2. git pull                 │
│   ✅ 3. 构建 (42.3s)             │
│   🔄 4. SCP 上传中...           │
│      ████████████░░ 78%          │
│      已上传 12.4 MB / 15.8 MB    │
│   ⏳ 5. 完成...                  │
│  ┌────────────────────────────┐  │
│  │ [部署日志]                   │  │
│  │ $ git checkout test         │  │
│  │ Switched to branch 'test'   │  │
│  │ $ git pull                  │  │
│  │ ...                         │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### 5.4 消息通信协议

`postMessage` 双向通信：

| 方向 | 消息类型 | 载荷 | 含义 |
|------|----------|------|------|
| 前端→后端 | `getProjects` | - | 获取所有项目 |
| 前端→后端 | `saveProject` | `Project` | 保存新建/编辑项目 |
| 前端→后端 | `deleteProject` | `{ id }` | 删除项目 |
| 前端→后端 | `startDeploy` | `{ id }` | 开始部署 |
| 前端→后端 | `cancelDeploy` | - | 取消部署 |
| 前端→后端 | `getPassword` | `{ host, user }` | 请求密码（首次或过期） |
| 后端→前端 | `projectsList` | `Project[]` | 返回项目列表 |
| 后端→前端 | `deployStep` | `{ step, status, detail }` | 步骤状态 |
| 后端→前端 | `deployLog` | `{ line }` | 实时日志追加 |
| 后端→前端 | `deployProgress` | `{ percent, transferred, total }` | 上传进度 |
| 后端→前端 | `deployComplete` | `{ success, duration, summary }` | 部署结果 |

---

## 6. 安全设计

| 措施 | 说明 |
|------|------|
| 密码加密存储 | `SecretStorage` API，由 VS Code 底层加密，不落盘 |
| 配置不进入 Git | `globalState` 存在 VS Code 用户目录，与项目文件完全隔离 |
| 路径校验 | 上传路径禁止 `..`、`/` 根目录 |
| 表单验证 | 本地路径必须存在、远程路径必须以字母开头、主机地址不能为空 |
| 命令注入防护 | 构建命令使用 `spawn` 分离参数执行，不做 shell 字符串拼接 |
| 单任务锁 | 同一时间只能有一个部署任务在执行 |

---

## 7. 构建与分发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npx tsc -p ./

# 打包 VSIX
npx vsce package

# 产出: deploy-kit-1.0.0.vsix

# 安装到 VS Code
code --install-extension deploy-kit-1.0.0.vsix

# 安装到 Trae
# Trae 支持相同的 vsix 安装方式
```

---

## 8. 版本兼容性

| 编辑器 | 最低版本 | 备注 |
|--------|----------|------|
| VS Code | 1.85.0 | 稳定版 |
| Trae | 最新版本 | 基于 VS Code OSS，API 兼容 |

---

## 9. 非功能需求

- 扩展激活时间 < 100ms（懒加载，`onView` 激活）
- 部署日志实时刷新，延迟 < 200ms
- Webview 首屏渲染 < 500ms（无框架，静态 HTML）
- 支持 Windows 平台（主要使用环境），理论上兼容 macOS/Linux