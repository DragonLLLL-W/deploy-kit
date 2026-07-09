// ========== 数据模型 ==========

export interface ServerConfig {
  host: string;
  user: string;
  remotePath: string;
  port: number;
}

export interface ScpOptions {
  recursive: boolean;
  legacyProtocol: boolean;
  preserve: boolean;
  compress: boolean;
  verbose: boolean;
}

export interface Project {
  id: string;
  name: string;
  localPath: string;
  branch: string;
  buildCommand: string;
  uploadDir: string;
  server: ServerConfig;
  scpOptions: ScpOptions;
}

// ========== 部署状态 ==========

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface DeployStep {
  step: 'checkout' | 'pull' | 'build' | 'upload' | 'complete';
  label: string;
  status: StepStatus;
  detail: string;
}

export interface DeployProgress {
  percent: number;
  transferred: string;
  total: string;
}

// ========== 消息通信协议 ==========

// 前端 → 后端
export type WebviewMessage =
  | { type: 'getProjects' }
  | { type: 'saveProject'; project: Project }
  | { type: 'deleteProject'; id: string }
  | { type: 'reorderProjects'; ids: string[] }
  | { type: 'startDeploy'; id: string }
  | { type: 'cancelDeploy' }
  | { type: 'savePassword'; host: string; user: string; password: string }
  | { type: 'browseFolder'; field: string };

// 后端 → 前端
export type ExtensionMessage =
  | { type: 'projectsList'; projects: Project[] }
  | { type: 'deployStep'; step: DeployStep }
  | { type: 'deployLog'; line: string }
  | { type: 'deployProgress'; progress: DeployProgress }
  | { type: 'deployComplete'; success: boolean; duration: string; summary: string }
  | { type: 'passwordSaved'; success: boolean }
  | { type: 'folderSelected'; field: string; path: string };