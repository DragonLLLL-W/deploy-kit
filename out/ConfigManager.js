"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigManager = void 0;
const PROJECTS_KEY = 'deploy.projects';
function passwordKey(host, user) {
    return `deploy.password.${host}.${user}`;
}
class ConfigManager {
    context;
    constructor(context) {
        this.context = context;
    }
    getProjects() {
        return this.context.globalState.get(PROJECTS_KEY, []);
    }
    async saveProject(project) {
        const projects = this.getProjects();
        const index = projects.findIndex(p => p.id === project.id);
        if (index >= 0) {
            projects[index] = project;
        }
        else {
            projects.push(project);
        }
        await this.context.globalState.update(PROJECTS_KEY, projects);
    }
    async deleteProject(id) {
        const projects = this.getProjects().filter(p => p.id !== id);
        await this.context.globalState.update(PROJECTS_KEY, projects);
    }
    async reorderProjects(ids) {
        const projects = this.getProjects();
        const map = new Map(projects.map(p => [p.id, p]));
        const reordered = ids.map(id => map.get(id)).filter((p) => !!p);
        await this.context.globalState.update(PROJECTS_KEY, reordered);
    }
    async getPassword(host, user) {
        return this.context.secrets.get(passwordKey(host, user));
    }
    async storePassword(host, user, password) {
        await this.context.secrets.store(passwordKey(host, user), password);
    }
    async deletePassword(host, user) {
        await this.context.secrets.delete(passwordKey(host, user));
    }
    generateId() {
        return `proj-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
}
exports.ConfigManager = ConfigManager;
//# sourceMappingURL=ConfigManager.js.map