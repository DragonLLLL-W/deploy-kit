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
    deploying = false;
    _disposables = [];
    logDir;
    /** 日志目录最大保留文件数，超出自动清理最旧的 */
    static MAX_LOG_FILES = 50;
    constructor(_extensionUri, context) {
        this._extensionUri = _extensionUri;
        this.configManager = new ConfigManager_1.ConfigManager(context);
        this.pipeline = new DeployPipeline_1.DeployPipeline();
        this.logDir = vscode.Uri.joinPath(context.globalStorageUri, 'logs').fsPath;
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
        const disposable = webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this._disposables);
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
                const password = await this.configManager.getPassword(project.server.host, project.server.user);
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
                const logLines = [];
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
                }
                finally {
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
                }
                catch { }
                await vscode.env.openExternal(vscode.Uri.file(this.logDir));
                break;
            }
        }
    }
    // ========== 日志落盘 ==========
    /**
     * 把本次执行累积的日志行写入 globalStorage/logs/ 下，返回日志文件绝对路径；
     * 写入失败返回 undefined（不影响主流程）。
     */
    finalizeLog(logLines, project, result, startedAt) {
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
        }
        catch (err) {
            return undefined;
        }
    }
    /** 只保留最近 MAX_LOG_FILES 个日志文件，删除更旧的 */
    pruneLogs() {
        try {
            const files = fs.readdirSync(this.logDir).filter(f => f.startsWith('deploy-') && f.endsWith('.log'));
            if (files.length <= DeployViewProvider.MAX_LOG_FILES) {
                return;
            }
            const withTime = files.map(f => {
                const full = path.join(this.logDir, f);
                let mtime = 0;
                try {
                    mtime = fs.statSync(full).mtimeMs;
                }
                catch { }
                return { f, mtime };
            });
            withTime.sort((a, b) => b.mtime - a.mtime); // 新 → 旧
            for (const item of withTime.slice(DeployViewProvider.MAX_LOG_FILES)) {
                try {
                    fs.unlinkSync(path.join(this.logDir, item.f));
                }
                catch { }
            }
        }
        catch { }
    }
    sanitizeName(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    }
    stamp(d) {
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    }
    postMessage(message) {
        this._view?.webview.postMessage(message);
    }
    dispose() {
        this.pipeline.cancel();
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables = [];
    }
}
exports.DeployViewProvider = DeployViewProvider;
//# sourceMappingURL=WebviewProvider.js.map