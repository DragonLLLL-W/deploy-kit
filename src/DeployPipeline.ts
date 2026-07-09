import * as cp from 'child_process';
import * as fs from 'fs';
import { simpleGit, SimpleGit } from 'simple-git';
import { Project, DeployStep, DeployProgress } from './types';

function findSshpass(): string {
  // 1. 尝试 PATH
  try {
    const result = cp.execSync('where sshpass', { encoding: 'utf-8', timeout: 3000 });
    const lines = result.trim().split('\n');
    if (lines.length > 0 && lines[0].trim()) {
      return lines[0].trim();
    }
  } catch {}

  // 2. 搜索 winget 安装目录
  const localAppData = process.env.LOCALAPPDATA || '';
  const searchDirs = [
    `${localAppData}\\Microsoft\\WinGet\\Packages`,
    'C:\\Users\\admin\\AppData\\Local\\Microsoft\\WinGet\\Packages',
  ];

  for (const base of searchDirs) {
    try {
      if (!fs.existsSync(base)) continue;
      const dirs = fs.readdirSync(base);
      for (const dir of dirs) {
        if (dir.toLowerCase().startsWith('xhcoding.sshpass-win32')) {
          const exePath = `${base}\\${dir}\\sshpass.exe`;
          if (fs.existsSync(exePath)) return exePath;
        }
      }
    } catch {}
  }

  // 3. 回退
  return 'sshpass';
}

export interface DeployCallbacks {
  onStep: (step: DeployStep) => void;
  onLog: (line: string) => void;
  onProgress: (progress: DeployProgress) => void;
  onCancel?: () => boolean; // 返回 true 表示已取消
}

export class DeployPipeline {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  async deploy(
    project: Project,
    password: string,
    callbacks: DeployCallbacks
  ): Promise<{ success: boolean; duration: string; summary: string }> {
    const startTime = Date.now();
    this.cancelled = false;

    try {
      // Step 1: 切换分支
      await this.checkoutBranch(project, callbacks);
      if (this.cancelled || callbacks.onCancel?.()) throw new Error('用户取消部署');

      // Step 2: 拉取代码
      await this.pullCode(project, callbacks);
      if (this.cancelled || callbacks.onCancel?.()) throw new Error('用户取消部署');

      // Step 3: 构建
      await this.runBuild(project, callbacks);
      if (this.cancelled || callbacks.onCancel?.()) throw new Error('用户取消部署');

      // Step 4: SCP 上传
      await this.uploadViaScp(project, password, callbacks);
      if (this.cancelled || callbacks.onCancel?.()) throw new Error('用户取消部署');

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
    } catch (err: any) {
      const duration = this.formatDuration(Date.now() - startTime);
      return {
        success: false,
        duration,
        summary: err.message || '部署失败'
      };
    }
  }

  // ========== Step 1: 切换分支 ==========
  private async checkoutBranch(project: Project, cbs: DeployCallbacks): Promise<void> {
    cbs.onStep({
      step: 'checkout',
      label: '切换分支',
      status: 'running',
      detail: `切换到 ${project.branch}`
    });

    const git: SimpleGit = simpleGit(project.localPath);
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
    } catch (err: any) {
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
  private async pullCode(project: Project, cbs: DeployCallbacks): Promise<void> {
    cbs.onStep({
      step: 'pull',
      label: '拉取代码',
      status: 'running',
      detail: 'git pull'
    });

    const git: SimpleGit = simpleGit(project.localPath);
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
    } catch (err: any) {
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
  private runBuild(project: Project, cbs: DeployCallbacks): Promise<void> {
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

      child.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => cbs.onLog(line));
      });

      child.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => cbs.onLog(line));
      });

      child.on('close', (code: number) => {
        if (code !== 0) {
          cbs.onStep({
            step: 'build',
            label: '构建',
            status: 'error',
            detail: `构建失败，退出码 ${code}`
          });
          reject(new Error(`构建失败，退出码 ${code}`));
        } else {
          cbs.onStep({
            step: 'build',
            label: '构建',
            status: 'done',
            detail: '构建成功'
          });
          resolve();
        }
      });

      child.on('error', (err: Error) => {
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
  private uploadViaScp(
    project: Project,
    password: string,
    cbs: DeployCallbacks
  ): Promise<void> {
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

      child.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) cbs.onLog(line.trim());
        });
      });

      child.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) cbs.onLog(line.trim());
        });
      });

      child.on('close', (code: number) => {
        if (code !== 0) {
          cbs.onStep({
            step: 'upload',
            label: 'SCP 上传',
            status: 'error',
            detail: `scp 退出码 ${code}`
          });
          reject(new Error(`上传失败，scp 退出码 ${code}`));
        } else {
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

      child.on('error', (err: Error) => {
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

  private buildScpArgs(project: Project): string {
    const opts = project.scpOptions;
    const args: string[] = [];
    if (opts.recursive) args.push('-r');
    if (opts.legacyProtocol) args.push('-O');
    if (opts.preserve) args.push('-p');
    if (opts.compress) args.push('-C');
    if (opts.verbose) args.push('-v');
    if (project.server.port !== 22) args.push(`-P ${project.server.port}`);
    return args.join(' ');
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return `${minutes} 分 ${remainSeconds} 秒`;
  }
}