"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployViewProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const ConfigManager_1 = require("./ConfigManager");
const DeployPipeline_1 = require("./DeployPipeline");
class DeployViewProvider {
    _extensionUri;
    static viewType = 'deploy-kit.view';
    _view;
    configManager;
    pipeline;
    _cancelled = false;
    _disposables = [];
    constructor(_extensionUri, context) {
        this._extensionUri = _extensionUri;
        this.configManager = new ConfigManager_1.ConfigManager(context);
        this.pipeline = new DeployPipeline_1.DeployPipeline();
    }
    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'webview')
            ]
        };
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        // 监听来自 Webview 的消息
        const disposable = webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, []);
        this._disposables.push(disposable);
    }
    getHtmlContent(webview) {
        const htmlPath = path.join(this._extensionUri.fsPath, 'webview', 'index.html');
        let html;
        try {
            html = fs.readFileSync(htmlPath, 'utf-8');
        }
        catch {
            return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Deploy Kit</title></head>
<body><h1>Deploy Kit</h1><p>无法加载 Webview 页面。请检查 webview/index.html 是否存在。</p></body>
</html>`;
        }
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'style.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'webview', 'app.js'));
        html = html.replace('${styleUri}', styleUri.toString());
        html = html.replace('${scriptUri}', scriptUri.toString());
        return html;
    }
    async handleMessage(message) {
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
                    await this.configManager.storePassword(message.host, message.user, message.password);
                    this.postMessage({ type: 'passwordSaved', success: true });
                }
                catch {
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
                const password = await this.configManager.getPassword(project.server.host, project.server.user);
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
    postMessage(message) {
        this._view?.webview.postMessage(message);
    }
    dispose() {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}
exports.DeployViewProvider = DeployViewProvider;
//# sourceMappingURL=WebviewProvider.js.map