import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
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
      const now = Date.now();
      callbacks.onStep({
        step: 'complete',
        label: '部署完成',
        status: 'done',
        detail: `总耗时 ${duration}`,
        completedAt: this.formatTime(new Date(now)),
        duration
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
    const stepStartTime = Date.now();
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

      const now = Date.now();
      cbs.onStep({
        step: 'checkout',
        label: '切换分支',
        status: 'done',
        detail: `已切换到 ${project.branch}`,
        completedAt: this.formatTime(new Date(now)),
        duration: this.formatDuration(now - stepStartTime)
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
    const stepStartTime = Date.now();
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

      const now = Date.now();
      cbs.onStep({
        step: 'pull',
        label: '拉取代码',
        status: 'done',
        detail: summary,
        completedAt: this.formatTime(new Date(now)),
        duration: this.formatDuration(now - stepStartTime)
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
      const stepStartTime = Date.now();
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

      const outBuf = { s: '' };
      const errBuf = { s: '' };
      child.stdout.on('data', (d: Buffer) => this.streamToLines(cbs, outBuf, d));
      child.stderr.on('data', (d: Buffer) => this.streamToLines(cbs, errBuf, d));

      child.on('close', (code: number) => {
        if (outBuf.s) cbs.onLog(outBuf.s);
        if (errBuf.s) cbs.onLog(errBuf.s);
        if (code !== 0) {
          cbs.onStep({
            step: 'build',
            label: '构建',
            status: 'error',
            detail: `构建失败，退出码 ${code}`
          });
          reject(new Error(`构建失败，退出码 ${code}`));
        } else {
          const now = Date.now();
          cbs.onStep({
            step: 'build',
            label: '构建',
            status: 'done',
            detail: '构建成功',
            completedAt: this.formatTime(new Date(now)),
            duration: this.formatDuration(now - stepStartTime)
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
      const stepStartTime = Date.now();
      const scpArgs = this.buildScpArgs(project);

      // 统一 uploadDir 语义：无论填 dist / dist/ / dist/*，都传"目录内容"到 remotePath 下，
      // 避免把 dist 作为子目录嵌套进 remotePath/dist（scp -r <dir> host:dest 的默认行为）。
      // 用 `<dir>/.` 作为源 —— scp 会把该目录的内容铺到目标，而非创建同名子目录。
      const localDir = project.uploadDir
        .replace(/[\\/]\*$/, '')   // 去掉末尾 /* 或 \*
        .replace(/[\\/]$/, '');     // 去掉末尾的 / 或 \

      const absLocalDir = path.isAbsolute(localDir)
        ? localDir
        : path.resolve(project.localPath, localDir);

      // 读取目录直接子项作为多个 scp 源逐项传到 remotePath 下。
      // 不用 dist/.（Windows OpenSSH scp 报 "unexpected filename: ."），
      // 也不用 dist/*（cmd/PowerShell 不做 glob 展开），
      // 且避免 scp -r <dir> host:dest 把 dir 嵌套成子目录。
      let entries: string[];
      try {
        entries = fs.readdirSync(absLocalDir).map(name => path.join(absLocalDir, name));
      } catch (err: any) {
        cbs.onLog(`读取上传目录失败: ${absLocalDir} - ${err.message}`);
        cbs.onStep({ step: 'upload', label: 'SCP 上传', status: 'error', detail: '读取上传目录失败' });
        reject(new Error(`读取上传目录失败: ${absLocalDir} - ${err.message}`));
        return;
      }
      if (entries.length === 0) {
        cbs.onLog(`上传目录为空: ${absLocalDir}（请确认构建已产出文件）`);
        cbs.onStep({ step: 'upload', label: 'SCP 上传', status: 'error', detail: '上传目录为空' });
        reject(new Error(`上传目录为空: ${absLocalDir}`));
        return;
      }

      const remotePath = project.server.remotePath.replace(/[\\/]$/, '');
      const remoteTarget = `${project.server.user}@${project.server.host}:${remotePath}/`;

      const scpCmd = `scp ${scpArgs} ${entries.map(e => `"${e}"`).join(' ')} ${remoteTarget}`;
      cbs.onLog(`$ sshpass -p ****** ${scpCmd}`);
      cbs.onLog(`上传 ${entries.length} 项到 ${project.server.host}:${remotePath}/`);

      cbs.onStep({
        step: 'upload',
        label: 'SCP 上传',
        status: 'running',
        detail: `上传 ${entries.length} 项到 ${project.server.host}:${remotePath}/`
      });

      const sshpassPath = findSshpass();
      cbs.onLog(`[sshpass: ${sshpassPath}]`);

      const child = cp.spawn(sshpassPath, [
        '-p', password,
        'scp', ...scpArgs.split(/\s+/).filter(a => a.length > 0),
        ...entries,
        remoteTarget
      ], {
        shell: false,
        env: { ...process.env }
      });

      const outBuf = { s: '' };
      const errBuf = { s: '' };
      child.stdout.on('data', (d: Buffer) => this.streamToLines(cbs, outBuf, d));
      child.stderr.on('data', (d: Buffer) => this.streamToLines(cbs, errBuf, d));

      child.on('close', (code: number) => {
        if (outBuf.s) cbs.onLog(outBuf.s);
        if (errBuf.s) cbs.onLog(errBuf.s);
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
          const now = Date.now();
          cbs.onStep({
            step: 'upload',
            label: 'SCP 上传',
            status: 'done',
            detail: '上传成功',
            completedAt: this.formatTime(new Date(now)),
            duration: this.formatDuration(now - stepStartTime)
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
    // uploadDir 始终是目录（逐项递归上传），必须 -r，故强制开启
    args.push('-r');
    if (opts.legacyProtocol) args.push('-O');
    if (opts.preserve) args.push('-p');
    if (opts.compress) args.push('-C');
    if (opts.verbose) args.push('-v');
    if (project.server.port !== 22) args.push(`-P ${project.server.port}`);
    return args.join(' ');
  }

  private streamToLines(cbs: DeployCallbacks, buf: { s: string }, data: Buffer): void {
    // 统一换行符（构建工具常用 \r 覆盖进度行），按完整行输出，避免半行/破碎/丢失
    buf.s += data.toString().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = buf.s.split('\n');
    buf.s = lines.pop() || '';
    for (const l of lines) {
      if (l.length > 0) cbs.onLog(l);
    }
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return `${minutes} 分 ${remainSeconds} 秒`;
  }
}
