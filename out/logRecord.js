"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeName = sanitizeName;
exports.matchLatestLogFile = matchLatestLogFile;
exports.parseLogHeader = parseLogHeader;
/**
 * 日志文件名中的项目名净化：非法字符换 _，截断 50 字符。
 * 唯一实现点——finalizeLog 写文件名与此处读匹配必须共用，规则变更只改这一处。
 */
function sanitizeName(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * 从候选文件中找属于 projectName 的最新日志文件名。
 * 文件名格式：deploy-{sanitize(name)}-{yyyyMMdd}-{HHmmss}.log。
 * 必须锚定整段时间戳：若只按前缀匹配，"app" 会吞掉 "app-2" 的文件。
 */
function matchLatestLogFile(entries, projectName) {
    const re = new RegExp('^deploy-' + escapeRegExp(sanitizeName(projectName)) + '-\\d{8}-\\d{6}\\.log$');
    let best = null;
    for (const e of entries) {
        if (!re.test(e.name))
            continue;
        if (!best || e.mtimeMs > best.mtimeMs)
            best = e;
    }
    return best ? best.name : null;
}
/**
 * 解析日志文件头部（==== 分隔线之前的 "键: 值" 块）。
 * 按每行第一个冒号切分，值内含冒号（构建命令、目标路径）不会被切错。
 * 解析不出"项目"或"结果"行时返回 null（调用方兜底为空态）。
 */
function parseLogHeader(text) {
    // Object.create(null)：避免 "constructor"/"__proto__" 等键名污染普通对象
    const fields = Object.create(null);
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('='))
            break;
        const idx = line.indexOf(':');
        if (idx === -1)
            continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key && !(key in fields))
            fields[key] = value;
    }
    if (!fields['项目'] || !fields['结果'])
        return null;
    return {
        projectName: fields['项目'],
        target: fields['目标'],
        branch: fields['分支'],
        buildCommand: fields['构建命令'],
        startedAt: fields['开始时间'] ?? '',
        success: fields['结果'] === '成功',
        duration: fields['耗时'] ?? '',
        summary: fields['摘要'] ?? ''
    };
}
//# sourceMappingURL=logRecord.js.map