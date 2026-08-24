# Deploy Kit — 部署阶段完成时间显示

**日期**: 2026-08-24  
**状态**: 待审阅  
**目标**: 在部署进度视图中，为每个已完成的阶段同时展示「完成时刻」和「步骤耗时」。

---

## 1. 背景

当前部署进度视图仅显示步骤名称与 `detail`（如"已切换到 dev"、"1 个文件变更"）。用户希望每个阶段完成后能直接看到该阶段何时结束、耗时多久，便于排查构建/上传瓶颈，也更容易与服务器日志时间对齐。

---

## 2. 需求

- 每个阶段（切换分支、拉取代码、构建、SCP 上传、完成）在 `status === 'done'` 时，显示：
  - **完成时刻**：本地时间的 `HH:MM:SS`（24 小时制）。
  - **步骤耗时**：例如 "2 秒"、"1 分 12 秒"。
- 失败或取消的步骤不显示时间，避免误导。
- 保持现有消息协议和 UI 结构不变，仅做增量扩展。

---

## 3. 设计

### 3.1 协议扩展（`src/types.ts`）

在 `DeployStep` 中增加两个可选字符串字段：

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

- 仅当 `status === 'done'` 时填充。
- 使用字符串直接展示，减少前端格式化逻辑。

### 3.2 后端时间记录（`src/DeployPipeline.ts`）

在每个步骤函数开始时记录 `stepStartTime = Date.now()`，成功结束时计算耗时与完成时刻：

```typescript
private async checkoutBranch(project: Project, cbs: DeployCallbacks): Promise<void> {
  const stepStartTime = Date.now();
  // ... running 回调保持不变 ...

  const now = Date.now();
  cbs.onStep({
    step: 'checkout',
    label: '切换分支',
    status: 'done',
    detail: `已切换到 ${project.branch}`,
    completedAt: this.formatTime(new Date(now)),
    duration: this.formatDuration(now - stepStartTime)
  });
}
```

新增辅助方法：

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

`pull`、`build`、`upload`、`complete` 四个步骤同理。`complete` 没有独立运行阶段，其 `duration` 取整个部署总耗时，`completedAt` 取最终时间。

### 3.3 前端渲染（`webview/app.js` + `webview/style.css`）

在 `updateStep(step)` 中，当步骤完成且存在时间字段时，追加一行时间信息：

```javascript
function updateStep(step) {
  // ... 现有图标、detail 更新逻辑不变 ...

  const detail = el.querySelector('.step-detail');
  detail.textContent = step.detail || '';

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
}
```

新增样式：

```css
.step-item .step-time {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-left: 22px;
  margin-top: 2px;
}
```

渲染效果示例：

```
✅ 切换分支
   已切换到 dev
   14:32:05 · 耗时 2 秒
```

---

## 4. 边界情况

| 场景 | 处理 |
|------|------|
| 步骤失败 (`error`) | 不填充 `completedAt` 和 `duration`，仅保留错误 `detail`。 |
| 用户取消部署 | 正在运行的步骤不会收到 `done`，已完成的步骤保留原有时间记录。 |
| 重复部署 | `startDeploy` 会清空 `stepList` 重新初始化，旧时间自然消失。 |
| `complete` 步骤 | `duration` 为部署总耗时，`completedAt` 为最终完成时刻，与结果横幅保持一致。 |
| 时区 | 使用 `toLocaleTimeString('zh-CN')`，显示本地系统时间。 |

---

## 5. 影响范围

- `src/types.ts`：新增两个可选字段。
- `src/DeployPipeline.ts`：每个步骤增加时间记录与格式化。
- `webview/app.js`：`updateStep` 增加时间渲染逻辑。
- `webview/style.css`：新增 `.step-time` 样式。
- 不影响配置存储、密码管理、SCP 上传逻辑。
