# Deploy Kit — 完成卡片操作按钮美化 + 日志一键打开

**日期**: 2026-10-26  
**状态**: 待审阅  
**目标**: 去掉完成卡片按钮的 emoji、建立主次按钮层次；日志文件名变为可点击链接，一键打开本次部署的日志文件。

---

## 1. 背景

部署完成卡片（resultBanner）目前有两个并排的实心按钮：

```html
<button id="btnRedeploy" class="btn-primary">🔄 再次部署</button>
<button id="btnOpenLog" class="btn-secondary">📁 打开日志文件夹</button>
```

问题：

- 彩色 emoji（🔄/📁）与 VS Code 深色扁平 UI 风格冲突，小尺寸下渲染成色块，观感差
- 两个实心按钮并排、视觉权重相同，主操作（再次部署）与辅助操作（找日志）没有层次
- 卡片中「日志: xxx.log」只是纯文本；查看本次日志要点开文件夹再在几十个文件里人肉找

日志功能本身无需改动：成功/失败均已落盘完整日志（用户确认）。

## 2. 方案

### 2.1 按钮层次（webview/index.html + style.css）

- 「再次部署」保留 `btn-primary`（蓝色实心），去掉 🔄 emoji，纯文本
- 「打开日志文件夹」改用新的 `btn-link` 样式：透明背景、`--vscode-textLink-foreground` 文字色、去掉 📁 emoji；hover 时显示下划线与淡底色
- 两按钮仍左对齐排在 `result-actions` 中，间距不变

### 2.2 日志文件链接（webview/app.js + types.ts + WebviewProvider.ts）

- 当 `deployComplete` 携带 `logPath` 时，「日志: xxx.log」渲染为可点击链接（复用 `btn-link` 视觉语言），点击发送新消息 `{ type: 'openLogFile'; path: string }`
- `WebviewMessage` 联合类型增加该消息；`WebviewProvider.handleMessage` 新增分支：校验 path 经 `path.resolve` 后仍位于 `this.logDir` 之内（防 webview 传入任意路径），通过则用 `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument` 在当前 IDE 编辑器中打开（不走系统文件关联，避免落到记事本）
- `logPath` 缺失（落盘失败）时不渲染该行，行为与现状一致

## 3. 不做的事（YAGNI）

- 不改动日志文件的生成、命名、内容
- 不替换进度步骤（⏳✅❌）、表单（📁/👁）等其他 emoji —— 本次只处理用户指出的完成卡片区域
- 不引入图标库或手绘 SVG

## 4. 验收标准

1. 完成卡片（成功与失败两种状态）不再出现任何 emoji 图标
2. 「再次部署」为唯一实心按钮；「打开日志文件夹」呈低调文字链接状
3. 点击「日志: xxx.log」直接打开本次日志文件，不弹文件夹窗口
4. 部署失败于日志落盘之前（无 logPath）时，卡片不显示日志行、不报错
5. `npm run compile` 通过
