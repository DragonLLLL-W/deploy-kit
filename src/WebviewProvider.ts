import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from './ConfigManager';
import { DeployPipeline } from './DeployPipeline';
import { Project, WebviewMessage, ExtensionMessage } from './types';

export class DeployViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'deploy-kit.view';
  private _view?: vscode.WebviewView;
  private configManager: ConfigManager;
  private pipeline: DeployPipeline;
  private _cancelled: boolean = false;
  private deploying: boolean = false;
  private _disposables: vscode.Disposable[] = [];
  private readonly logDir: string;

  /** 日志目录最大保留文件数，超出自动清理最旧的 */
  private static readonly MAX_LOG_FILES = 50;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    context: vscode.ExtensionContext
  ) {
    this.configManager = new ConfigManager(context);
    this.pipeline = new DeployPipeline();
    this.logDir = vscode.Uri.joinPath(context.globalStorageUri, 'logs').fsPath;
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
    const disposable = webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      this._disposables
    );
    this._disposables.push(disposable);
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const htmlPath = path.join(this._extensionUri.fsPath, 'webview', 'index.html');
    let html: string;
    try {
      html = fs.readFileSync(htmlPath, 'utf-8');
    } catch {
      return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Deploy Kit</title></head>
<body><h1>Deploy Kit</h1><p>无法加载 Webview 页面。请检查 webview/index.html 是否存在。</p></body>
</html>`;
    }

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
        const project = { ...message.project };
        if (!project.id) {
          project.id = this.configManager.generateId();
        }
        await this.configManager.saveProject(project);

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

      case 'reorderProjects': {
        await this.configManager.reorderProjects(message.ids);
        const projects = this.configManager.getProjects();
        this.postMessage({ type: 'projectsList', projects });
        break;
      }

      case 'savePassword': {
        try {
          await this.configManager.storePassword(
            message.host,
            message.user,
            message.password
          );
          this.postMessage({ type: 'passwordSaved', success: true });
        } catch {
          this.postMessage({ type: 'passwordSaved', success: false });
        }
        break;
      }

      case 'browseFolder': {
        const result = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: '选择文件夹'
        });
        if (result && result.length > 0) {
          this.postMessage({
            type: 'folderSelected',
            field: message.field,
            path: result[0].fsPath
          });
        }
        break;
      }

      case 'startDeploy': {
        // 并发守卫：正在部署时拒绝新请求，避免重置 cancelled 与 UI 串扰
        if (this.deploying) {
          this.postMessage({ type: 'deployBusy' });
          break;
        }

        const project = this.configManager.getProjects().find(p => p.id === message.id);
        if (!project) {
          this.postMessage({
            type: 'deployComplete',
            success: false,
            duration: '0 秒',
            summary: '项目不存在'
          });
          break;
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
          break;
        }

        this.deploying = true;
        this._cancelled = false;
        const logLines: string[] = [];
        const startedAt = new Date();
        try {
          const result = await this.pipeline.deploy(project, password, {
            onStep: (step) => this.postMessage({ type: 'deployStep', step }),
            onLog: (line) => {
              logLines.push(line);
              this.postMessage({ type: 'deployLog', line });
            },
            onProgress: (progress) => this.postMessage({ type: 'deployProgress', progress }),
            onCancel: () => this._cancelled
          });

          const logPath = this.finalizeLog(logLines, project, result, startedAt);
          this.postMessage({ type: 'deployComplete', ...result, logPath });
        } finally {
          this.deploying = false;
        }
        break;
      }

      case 'cancelDeploy': {
        this.pipeline.cancel();
        this._cancelled = true;
        break;
      }

      case 'openLogFolder': {
        try {
          fs.mkdirSync(this.logDir, { recursive: true });
        } catch {}
        await vscode.env.openExternal(vscode.Uri.file(this.logDir));
        break;
      }

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
    }
  }

  // ========== 日志落盘 ==========

  /**
   * 把本次执行累积的日志行写入 globalStorage/logs/ 下，返回日志文件绝对路径；
   * 写入失败返回 undefined（不影响主流程）。
   */
  private finalizeLog(
    logLines: string[],
    project: Project | undefined,
    result: { success: boolean; duration: string; summary: string },
    startedAt: Date
  ): string | undefined {
    try {
      fs.mkdirSync(this.logDir, { recursive: true });

      const fileName = `deploy-${this.sanitizeName(project?.name || 'unknown')}-${this.stamp(startedAt)}.log`;
      const logPath = path.join(this.logDir, fileName);

      const header = [
        `项目: ${project?.name || '(未知)'}`,
        project ? `目标: ${project.server.user}@${project.server.host}:${project.server.remotePath}` : '',
        project ? `分支: ${project.branch}` : '',
        project ? `构建命令: ${project.buildCommand}` : '',
        `开始时间: ${startedAt.toLocaleString('zh-CN')}`,
        `结果: ${result.success ? '成功' : '失败'}`,
        `耗时: ${result.duration}`,
        `摘要: ${result.summary}`,
        `${'='.repeat(40)}`,
        ''
      ].filter(l => l !== '').join('\n');

      fs.writeFileSync(logPath, header + logLines.join('\n') + '\n', 'utf-8');

      this.pruneLogs();
      return logPath;
    } catch (err) {
      return undefined;
    }
  }

  /** 只保留最近 MAX_LOG_FILES 个日志文件，删除更旧的 */
  private pruneLogs(): void {
    try {
      const files = fs.readdirSync(this.logDir).filter(f => f.startsWith('deploy-') && f.endsWith('.log'));
      if (files.length <= DeployViewProvider.MAX_LOG_FILES) { return; }

      const withTime = files.map(f => {
        const full = path.join(this.logDir, f);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch {}
        return { f, mtime };
      });
      withTime.sort((a, b) => b.mtime - a.mtime); // 新 → 旧

      for (const item of withTime.slice(DeployViewProvider.MAX_LOG_FILES)) {
        try { fs.unlinkSync(path.join(this.logDir, item.f)); } catch {}
      }
    } catch {}
  }

  private sanitizeName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
  }

  private stamp(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  private postMessage(message: ExtensionMessage): void {
    this._view?.webview.postMessage(message);
  }

  dispose(): void {
    this.pipeline.cancel();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}