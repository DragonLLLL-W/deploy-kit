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
  private _disposables: vscode.Disposable[] = [];

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
    const disposable = webviewView.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      undefined,
      []
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
        this._cancelled = false;
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
          onCancel: () => this._cancelled
        });

        this.postMessage({ type: 'deployComplete', ...result });
        break;
      }

      case 'cancelDeploy': {
        this.pipeline.cancel();
        this._cancelled = true;
        break;
      }
    }
  }

  private postMessage(message: ExtensionMessage): void {
    this._view?.webview.postMessage(message);
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}