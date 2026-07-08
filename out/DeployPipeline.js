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
const fs = __importStar(require("fs"));
const simple_git_1 = require("simple-git");
function findSshpass() {
    // 优先尝试 PATH 中的 sshpass
    try {
        const result = cp.execSync('where sshpass 2>nul', { encoding: 'utf-8', shell: 'cmd.exe' });
        const lines = result.trim().split('\n');
        if (lines.length > 0 && lines[0].trim()) {
            return lines[0].trim();
        }
    }
    catch { }
    // 回退: winget 默认安装路径
    const wingetBase = process.env.LOCALAPPDATA
        ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages`
        : '';
    if (wingetBase && fs.existsSync(wingetBase)) {
        try {
            const dirs = fs.readdirSync(wingetBase);
            for (const dir of dirs) {
                if (dir.startsWith('xhcoding.sshpass-win32')) {
                    const path = `${wingetBase}\\${dir}\\sshpass.exe`;
                    if (fs.existsSync(path))
                        return path;
                }
            }
        }
        catch { }
    }
    return 'sshpass'; // 最后回退，让系统报错
}
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
    uploadViaScp(project, password, cbs) {
        return new Promise((resolve, reject) => {
            const scpArgs = this.buildScpArgs(project);
            const localPath = project.uploadDir.replace(/\/\*$/, '').replace(/\\$/, '');
            const remoteTarget = `${project.server.user}@${project.server.host}:${project.server.remotePath}`;
            const scpCmd = `scp ${scpArgs} "${localPath}" ${remoteTarget}`;
            cbs.onLog(`$ sshpass -p ****** ${scpCmd}`);
            cbs.onStep({
                step: 'upload',
                label: 'SCP 上传',
                status: 'running',
                detail: `连接 ${project.server.user}@${project.server.host}:${project.server.port}`
            });
            const sshpassPath = findSshpass();
            cbs.onLog(`[sshpass: ${sshpassPath}]`);
            const child = cp.spawn(sshpassPath, [
                '-p', password,
                'scp', ...scpArgs.split(/\s+/).filter(a => a.length > 0),
                localPath,
                remoteTarget
            ], {
                shell: false,
                env: { ...process.env }
            });
            child.stdout.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach((line) => {
                    if (line.trim())
                        cbs.onLog(line.trim());
                });
            });
            child.stderr.on('data', (data) => {
                const lines = data.toString().trim().split('\n');
                lines.forEach((line) => {
                    if (line.trim())
                        cbs.onLog(line.trim());
                });
            });
            child.on('close', (code) => {
                if (code !== 0) {
                    cbs.onStep({
                        step: 'upload',
                        label: 'SCP 上传',
                        status: 'error',
                        detail: `scp 退出码 ${code}`
                    });
                    reject(new Error(`上传失败，scp 退出码 ${code}`));
                }
                else {
                    cbs.onLog('上传完成');
                    cbs.onStep({
                        step: 'upload',
                        label: 'SCP 上传',
                        status: 'done',
                        detail: '上传成功'
                    });
                    resolve();
                }
            });
            child.on('error', (err) => {
                cbs.onLog(`执行失败: ${err.message}`);
                cbs.onStep({
                    step: 'upload',
                    label: 'SCP 上传',
                    status: 'error',
                    detail: err.message
                });
                reject(new Error(`上传失败: ${err.message}`));
            });
        });
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