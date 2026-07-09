# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Deploy Kit 是一个 VS Code 扩展，通过侧边栏 Webview 实现前端项目一键部署到 Linux 服务器。部署流程为：切分支 → git pull → 构建 → SCP 上传。

## 构建与运行

```bash
npm run compile        # TypeScript 编译 (tsc -p ./)
npm run watch          # 监听模式编译
npm run package        # 打包为 .vsix (vsce package)
```

按 F5（Run Extension）在 Extension Development Host 中启动调试。`.vscode/launch.json` 已配置好 preLaunchTask 自动编译。

## 架构

```
src/
  extension.ts          # 入口：注册 WebviewViewProvider
  WebviewProvider.ts    # 消息路由中心：转发 Webview ↔ ConfigManager/DeployPipeline
  ConfigManager.ts      # 持久化层：globalState（项目配置）+ SecretStorage（密码）
  DeployPipeline.ts     # 5 步部署流水线：checkout → pull → build → scp
  types.ts              # 纯类型定义 + Webview/Extension 消息协议联合类型
webview/
  index.html / app.js / style.css   # 无框架原生 HTML/JS/CSS 前端
```

### 核心设计

- **消息协议**：`types.ts` 中 `WebviewMessage`（前端→后端）和 `ExtensionMessage`（后端→前端）是完整的联合类型，所有通信都通过 `postMessage` 走这套协议。
- **配置存储**：`ConfigManager` 使用 VS Code `globalState` 存项目列表，`SecretStorage` 存 SSH 密码。密码 key 格式为 `deploy.password.{host}.{user}`。
- **部署流水线**：`DeployPipeline` 5 步串行，每步通过 `DeployCallbacks` 回调实时推送状态。支持取消（`cancel()` 设置标志位）。
- **SCP 上传**：使用 `sshpass -p` 传密码 + 原生 `scp` 命令（非 node-ssh SFTP）。`findSshpass()` 函数按 PATH → winget 目录 → 回退顺序查找 sshpass。
- **依赖**：仅 `simple-git`（Git 操作）。无其他运行时依赖。
- **Webview**：纯 HTML/CSS/JS，无构建工具，通过 `${styleUri}` / `${scriptUri}` 占位符注入资源路径。4 个视图切换：列表、表单、进度、完成。

## 注意事项

- `target` 是 `ES2022`，`module` 是 `commonjs`（VS Code 扩展标准）。
- `out/` 目录是编译产物，`.vscodeignore` 排除 `src/` 和 `tsconfig.json` 不打包进 .vsix。
- 密码只在保存/编辑项目时写入 SecretStorage，部署时读取。如果密码不存在会中止部署。
- 不支持 Windows 远程服务器，仅支持 Linux。