import * as vscode from 'vscode';
import { Project } from './types';

const PROJECTS_KEY = 'deploy.projects';

function passwordKey(host: string, user: string): string {
  return `deploy.password.${host}.${user}`;
}

export class ConfigManager {
  constructor(private context: vscode.ExtensionContext) {}

  getProjects(): Project[] {
    return this.context.globalState.get<Project[]>(PROJECTS_KEY, []);
  }

  async saveProject(project: Project): Promise<void> {
    const projects = this.getProjects();
    const index = projects.findIndex(p => p.id === project.id);
    if (index >= 0) {
      projects[index] = project;
    } else {
      projects.push(project);
    }
    await this.context.globalState.update(PROJECTS_KEY, projects);
  }

  async deleteProject(id: string): Promise<void> {
    const projects = this.getProjects().filter(p => p.id !== id);
    await this.context.globalState.update(PROJECTS_KEY, projects);
  }

  async getPassword(host: string, user: string): Promise<string | undefined> {
    return this.context.secrets.get(passwordKey(host, user));
  }

  async storePassword(host: string, user: string, password: string): Promise<void> {
    await this.context.secrets.store(passwordKey(host, user), password);
  }

  async deletePassword(host: string, user: string): Promise<void> {
    await this.context.secrets.delete(passwordKey(host, user));
  }

  generateId(): string {
    return `proj-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}