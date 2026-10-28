'use strict';
const assert = require('assert');
const { matchLatestLogFile, parseLogHeader } = require('../out/logRecord');

let n = 0;
function t(name, fn) {
  n++;
  try { fn(); } catch (e) {
    console.error(`FAIL #${n} ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

// ===== matchLatestLogFile =====

t('按 mtime 取同项目最新文件', () => {
  const files = [
    { name: 'deploy-web-20260101-100000.log', mtimeMs: 100 },
    { name: 'deploy-web-20260201-100000.log', mtimeMs: 300 },
    { name: 'deploy-web-20260115-100000.log', mtimeMs: 200 }
  ];
  assert.strictEqual(matchLatestLogFile(files, 'web'), 'deploy-web-20260201-100000.log');
});

t('app 不得匹配到 app-2 的日志（锚定正则的核心用例）', () => {
  const files = [{ name: 'deploy-app-2-20260101-100000.log', mtimeMs: 999 }];
  assert.strictEqual(matchLatestLogFile(files, 'app'), null);
});

t('app-2 能匹配到自己的日志', () => {
  const files = [{ name: 'deploy-app-2-20260101-100000.log', mtimeMs: 999 }];
  assert.strictEqual(matchLatestLogFile(files, 'app-2'), 'deploy-app-2-20260101-100000.log');
});

t('忽略格式不符或外来的文件', () => {
  const files = [
    { name: 'deploy-web-notes.log', mtimeMs: 10 },
    { name: 'notes.txt', mtimeMs: 10 },
    { name: 'deploy-web.log', mtimeMs: 10 }
  ];
  assert.strictEqual(matchLatestLogFile(files, 'web'), null);
});

t('项目名含正则特殊字符时按字面匹配', () => {
  const hit = [{ name: 'deploy-my.app+1-20260101-100000.log', mtimeMs: 5 }];
  assert.strictEqual(matchLatestLogFile(hit, 'my.app+1'), 'deploy-my.app+1-20260101-100000.log');
  const miss = [{ name: 'deploy-myaappx1-20260101-100000.log', mtimeMs: 5 }];
  assert.strictEqual(matchLatestLogFile(miss, 'my.app+1'), null);
});

t('含非法文件名字符的项目名先 sanitize 再匹配', () => {
  const files = [{ name: 'deploy-web_api-20260101-100000.log', mtimeMs: 5 }];
  assert.strictEqual(matchLatestLogFile(files, 'web:api'), 'deploy-web_api-20260101-100000.log');
});

// ===== parseLogHeader =====

const header = [
  '项目: web_seller（测试环境）',
  '目标: deploy@192.168.1.10:/var/www/html',
  '分支: test',
  '构建命令: npm run build:prod',
  '开始时间: 2026-10-28 14:30:00',
  '结果: 成功',
  '耗时: 1 分 12 秒',
  '摘要: 上传 25 个文件',
  '========================================',
  '$ git checkout test',
  ''
].join('\n');

t('解析完整头部', () => {
  const info = parseLogHeader(header);
  assert.strictEqual(info.projectName, 'web_seller（测试环境）');
  assert.strictEqual(info.target, 'deploy@192.168.1.10:/var/www/html');
  assert.strictEqual(info.branch, 'test');
  assert.strictEqual(info.buildCommand, 'npm run build:prod');
  assert.strictEqual(info.startedAt, '2026-10-28 14:30:00');
  assert.strictEqual(info.success, true);
  assert.strictEqual(info.duration, '1 分 12 秒');
  assert.strictEqual(info.summary, '上传 25 个文件');
});

t('缺"结果"行返回 null', () => {
  assert.strictEqual(parseLogHeader('项目: a\n分支: b\n'), null);
});

t('分隔线之后的正文行不参与解析', () => {
  const info = parseLogHeader(header + 'debug1: 伪字段\n');
  assert.strictEqual(info.summary, '上传 25 个文件');
  assert.strictEqual(info.startedAt, '2026-10-28 14:30:00');
});

t('可缺字段（目标/分支/构建命令）解析为 undefined', () => {
  const minimal = [
    '项目: x', '开始时间: t', '结果: 失败', '耗时: 3 秒', '摘要: 失败原因',
    '========================================', ''
  ].join('\n');
  const info = parseLogHeader(minimal);
  assert.strictEqual(info.success, false);
  assert.strictEqual(info.target, undefined);
  assert.strictEqual(info.branch, undefined);
  assert.strictEqual(info.buildCommand, undefined);
});

console.log(process.exitCode ? 'SOME TESTS FAILED' : `all ${n} logRecord tests passed`);
