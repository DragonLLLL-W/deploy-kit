import * as cp from 'child_process';
import { simpleGit, SimpleGit } from 'simple-git';
import { NodeSSH } from 'node-ssh';
import { Project, DeployStep, DeployProgress } from './types';

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
  private async uploadViaScp(
    project: Project,
    password: string,
    cbs: DeployCallbacks
  ): Promise<void> {
    const ssh = new NodeSSH();

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
      const failed: Array<{ local: string; remote: string; error: Error }> = [];
      const successful: Array<{ local: string; remote: string }> = [];

      await ssh.putDirectory(localDir, project.server.remotePath, {
        recursive: true,
        concurrency: 4,
        tick: (localPath: string, remotePath: string, error: Error | null) => {
          if (error) {
            failed.push({ local: localPath, remote: remotePath, error });
          } else {
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
    } catch (err: any) {
      cbs.onLog(`连接失败: ${err.message}`);
      try { ssh.dispose(); } catch {}
      cbs.onStep({
        step: 'upload',
        label: 'SCP 上传',
        status: 'error',
        detail: err.message
      });
      throw new Error(`上传失败: ${err.message}`);
    }
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