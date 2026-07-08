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
exports.DeployPipeline = void 0;
const cp = __importStar(require("child_process"));
const simple_git_1 = require("simple-git");
const node_ssh_1 = require("node-ssh");
class DeployPipeline {
    cancelled = false;
    cancel() {
        this.cancelled = true;
    }
    async deploy(project, password, callbacks) {
        const startTime = Date.now();
        this.cancelled = false;
        try {
            // Step 1: 切换分支
            await this.checkoutBranch(project, callbacks);
            if (this.cancelled || callbacks.onCancel?.())
                throw new Error('用户取消部署');
            // Step 2: 拉取代码
            await this.pullCode(project, callbacks);
            if (this.cancelled || callbacks.onCancel?.())
                throw new Error('用户取消部署');
            // Step 3: 构建
            await this.runBuild(project, callbacks);
            if (this.cancelled || callbacks.onCancel?.())
                throw new Error('用户取消部署');
            // Step 4: SCP 上传
            await this.uploadViaScp(project, password, callbacks);
            if (this.cancelled || callbacks.onCancel?.())
                throw new Error('用户取消部署');
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
        }
        catch (err) {
            const duration = this.formatDuration(Date.now() - startTime);
            return {
                success: false,
                duration,
                summary: err.message || '部署失败'
            };
        }
    }
    // ========== Step 1: 切换分支 ==========
    async checkoutBranch(project, cbs) {
        cbs.onStep({
            step: 'checkout',
            label: '切换分支',
            status: 'running',
            detail: `切换到 ${project.branch}`
        });
        const git = (0, simple_git_1.simpleGit)(project.localPath);
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
        }
        catch (err) {
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
    async pullCode(project, cbs) {
        cbs.onStep({
            step: 'pull',
            label: '拉取代码',
            status: 'running',
            detail: 'git pull'
        });
        const git = (0, simple_git_1.simpleGit)(project.localPath);
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
        }
        catch (err) {
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
    runBuild(project, cbs) {
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
            child.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach((line) => cbs.onLog(line));
            });
            child.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach((line) => cbs.onLog(line));
            });
            child.on('close', (code) => {
                if (code !== 0) {
                    cbs.onStep({
                        step: 'build',
                        label: '构建',
                        status: 'error',
                        detail: `构建失败，退出码 ${code}`
                    });
                    reject(new Error(`构建失败，退出码 ${code}`));
                }
                else {
                    cbs.onStep({
                        step: 'build',
                        label: '构建',
                        status: 'done',
                        detail: '构建成功'
                    });
                    resolve();
                }
            });
            child.on('error', (err) => {
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
    async uploadViaScp(project, password, cbs) {
        const ssh = new node_ssh_1.NodeSSH();
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
            const failed = [];
            const successful = [];
            await ssh.putDirectory(localDir, project.server.remotePath, {
                recursive: true,
                concurrency: 4,
                tick: (localPath, remotePath, error) => {
                    if (error) {
                        failed.push({ local: localPath, remote: remotePath, error });
                    }
                    else {
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
        }
        catch (err) {
            cbs.onLog(`连接失败: ${err.message}`);
            try {
                ssh.dispose();
            }
            catch { }
            cbs.onStep({
                step: 'upload',
                label: 'SCP 上传',
                status: 'error',
                detail: err.message
            });
            throw new Error(`上传失败: ${err.message}`);
        }
    }
    buildScpArgs(project) {
        const opts = project.scpOptions;
        const args = [];
        if (opts.recursive)
            args.push('-r');
        if (opts.legacyProtocol)
            args.push('-O');
        if (opts.preserve)
            args.push('-p');
        if (opts.compress)
            args.push('-C');
        if (opts.verbose)
            args.push('-v');
        if (project.server.port !== 22)
            args.push(`-P ${project.server.port}`);
        return args.join(' ');
    }
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60)
            return `${seconds} 秒`;
        const minutes = Math.floor(seconds / 60);
        const remainSeconds = seconds % 60;
        return `${minutes} 分 ${remainSeconds} 秒`;
    }
}
exports.DeployPipeline = DeployPipeline;
//# sourceMappingURL=DeployPipeline.js.map