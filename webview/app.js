// ========== 全局状态 ==========
const vscode = acquireVsCodeApi();
let projects = [];
let editingProjectId = null;
const stepLabels = {
  checkout: '切换分支',
  pull: '拉取代码',
  build: '构建',
  upload: 'SCP 上传',
  complete: '完成'
};

// ========== 视图切换 ==========
function showView(viewId) {
  document.querySelectorAll('#viewList, #viewForm, #viewProgress, #viewComplete')
    .forEach(el => el.classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}

// ========== 项目列表 ==========
function renderProjectList() {
  const container = document.getElementById('projectList');
  if (projects.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无项目，点击右上角 + 添加</div>';
    return;
  }

  container.innerHTML = projects.map((p, i) => `
    <div class="project-card" draggable="true" data-index="${i}" data-id="${p.id}">
      <span class="drag-handle" title="拖动排序">⠿</span>
      <div class="card-body">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="meta">
          📂 ${escapeHtml(p.localPath)}<br>
          🌿 ${escapeHtml(p.branch)} &nbsp; 📦 ${escapeHtml(p.buildCommand)}<br>
          ➡ ${escapeHtml(p.server.user)}@${escapeHtml(p.server.host)}:${escapeHtml(p.server.remotePath)}
        </div>
        <div class="actions">
          <button class="btn-sm" onclick="editProject('${p.id}')">✏️ 编辑</button>
          <button class="btn-sm danger" onclick="deleteProject('${p.id}')">🗑️ 删除</button>
          <button class="btn-sm deploy" onclick="startDeploy('${p.id}')">🚀 一键部署</button>
        </div>
      </div>
    </div>
  `).join('');

  // 绑定拖拽事件
  bindDragEvents();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========== 拖拽排序 ==========
let dragSrcIndex = -1;

function bindDragEvents() {
  const cards = document.querySelectorAll('.project-card');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragSrcIndex = parseInt(card.dataset.index);
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', (e) => {
      card.classList.remove('dragging');
      cards.forEach(c => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('dragenter', (e) => {
      e.preventDefault();
      const targetIndex = parseInt(card.dataset.index);
      if (targetIndex !== dragSrcIndex) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');

      const srcIndex = dragSrcIndex;
      const targetIndex = parseInt(card.dataset.index);

      if (srcIndex !== targetIndex && srcIndex >= 0) {
        // 重排数组
        const item = projects.splice(srcIndex, 1)[0];
        projects.splice(targetIndex, 0, item);

        // 重绘
        renderProjectList();

        // 通知后端保存新顺序
        vscode.postMessage({
          type: 'reorderProjects',
          ids: projects.map(p => p.id)
        });
      }

      dragSrcIndex = -1;
    });
  });
}

// ========== 表单逻辑 ==========
function showForm(project) {
  editingProjectId = project ? project.id : null;
  document.getElementById('formTitle').textContent = project ? '编辑项目' : '添加项目';

  document.getElementById('fName').value = project ? project.name : '';
  document.getElementById('fLocalPath').value = project ? project.localPath : '';
  document.getElementById('fBranch').value = project ? project.branch : '';
  document.getElementById('fBuildCmd').value = project ? project.buildCommand : '';
  document.getElementById('fUploadDir').value = project ? project.uploadDir : '';
  document.getElementById('fHost').value = project ? project.server.host : '';
  document.getElementById('fUser').value = project ? project.server.user : '';
  document.getElementById('fPassword').value = '';
  document.getElementById('fRemotePath').value = project ? project.server.remotePath : '';
  document.getElementById('fPort').value = project ? project.server.port : 22;

  const opts = project ? project.scpOptions : { recursive: true, legacyProtocol: true, preserve: false, compress: false, verbose: false };
  document.getElementById('fScpR').checked = opts.recursive;
  document.getElementById('fScpO').checked = opts.legacyProtocol;
  document.getElementById('fScpP').checked = opts.preserve;
  document.getElementById('fScpC').checked = opts.compress;
  document.getElementById('fScpV').checked = opts.verbose;

  showView('viewForm');
}

function saveProject() {
  const name = document.getElementById('fName').value.trim();
  const localPath = document.getElementById('fLocalPath').value.trim();
  const branch = document.getElementById('fBranch').value.trim();
  const buildCommand = document.getElementById('fBuildCmd').value.trim();
  const uploadDir = document.getElementById('fUploadDir').value.trim();
  const host = document.getElementById('fHost').value.trim();
  const user = document.getElementById('fUser').value.trim();
  const password = document.getElementById('fPassword').value;
  const remotePath = document.getElementById('fRemotePath').value.trim();
  const port = parseInt(document.getElementById('fPort').value) || 22;

  if (!name || !localPath || !branch || !buildCommand || !uploadDir || !host || !user || !remotePath) {
    alert('请填写所有必填字段');
    return;
  }

  const project = {
    id: editingProjectId || '',
    name,
    localPath,
    branch,
    buildCommand,
    uploadDir,
    server: { host, user, remotePath, port },
    scpOptions: {
      recursive: document.getElementById('fScpR').checked,
      legacyProtocol: document.getElementById('fScpO').checked,
      preserve: document.getElementById('fScpP').checked,
      compress: document.getElementById('fScpC').checked,
      verbose: document.getElementById('fScpV').checked
    }
  };

  vscode.postMessage({ type: 'saveProject', project });

  // 如果有密码，单独发送保存密码请求
  if (password) {
    vscode.postMessage({ type: 'savePassword', host, user, password });
  }

  showView('viewList');
}

function editProject(id) {
  const project = projects.find(p => p.id === id);
  if (project) showForm(project);
}

function deleteProject(id) {
  if (confirm('确定要删除这个项目吗？')) {
    vscode.postMessage({ type: 'deleteProject', id });
  }
}

// ========== 部署进度 ==========
function startDeploy(id) {
  showView('viewProgress');
  document.getElementById('progressTitle').textContent = '部署中';
  document.getElementById('stepList').innerHTML = '';
  document.getElementById('logContent').textContent = '';

  // 初始化 5 个步骤
  const steps = ['checkout', 'pull', 'build', 'upload', 'complete'];
  const stepList = document.getElementById('stepList');
  steps.forEach(s => {
    const div = document.createElement('div');
    div.className = 'step-item';
    div.id = `step-${s}`;
    div.innerHTML = `
      <div class="step-header">
        <span class="step-icon pending">⏳</span>
        <span>${stepLabels[s]}</span>
      </div>
      <div class="step-detail"></div>
    `;
    stepList.appendChild(div);
  });

  vscode.postMessage({ type: 'startDeploy', id });
}

function updateStep(step) {
  const el = document.getElementById(`step-${step.step}`);
  if (!el) return;

  const iconMap = { pending: '⏳', running: '🔄', done: '✅', error: '❌' };
  const icon = el.querySelector('.step-icon');
  icon.textContent = iconMap[step.status] || '⏳';
  icon.className = `step-icon ${step.status}`;

  const detail = el.querySelector('.step-detail');
  detail.textContent = step.detail || '';

  // 如果是上传步骤且正在运行，添加进度条
  if (step.step === 'upload' && step.status === 'running') {
    let bar = el.querySelector('.progress-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.innerHTML = '<div class="fill" style="width:0%"></div>';
      el.appendChild(bar);
    }
  }
}

function appendLog(line) {
  const log = document.getElementById('logContent');
  log.textContent += line + '\n';
  log.scrollTop = log.scrollHeight;
}

function updateProgress(progress) {
  const el = document.getElementById('step-upload');
  if (!el) return;
  const bar = el.querySelector('.progress-bar .fill');
  if (bar) bar.style.width = progress.percent + '%';
  const detail = el.querySelector('.step-detail');
  if (detail) detail.textContent = `${progress.transferred} / ${progress.total}`;
}

function showComplete(result) {
  showView('viewComplete');
  document.getElementById('completeIcon').textContent = result.success ? '✅' : '❌';
  document.getElementById('completeText').textContent = result.success ? '部署成功' : '部署失败';
  document.getElementById('completeSummary').innerHTML = `
    耗时: ${escapeHtml(result.duration)}<br>
    ${escapeHtml(result.summary)}
  `;
}

// ========== 事件绑定 ==========
document.getElementById('btnAdd').addEventListener('click', () => showForm());
document.getElementById('btnBack').addEventListener('click', () => showView('viewList'));
document.getElementById('btnSave').addEventListener('click', saveProject);
document.getElementById('btnCancel').addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelDeploy' });
  showView('viewList');
});
document.getElementById('btnBackToList').addEventListener('click', () => showView('viewList'));
document.getElementById('btnTogglePwd').addEventListener('click', () => {
  const input = document.getElementById('fPassword');
  input.type = input.type === 'password' ? 'text' : 'password';
});
document.getElementById('btnBrowseLocal').addEventListener('click', () => {
  vscode.postMessage({ type: 'browseFolder', field: 'localPath' });
});
document.getElementById('btnBrowseUpload').addEventListener('click', () => {
  vscode.postMessage({ type: 'browseFolder', field: 'uploadDir' });
});

// ========== scp 命令解析 ==========
document.getElementById('scpParseToggle').addEventListener('click', () => {
  const content = document.getElementById('scpParseContent');
  const icon = document.getElementById('scpToggleIcon');
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    icon.textContent = '▼';
  } else {
    content.classList.add('hidden');
    icon.textContent = '▶';
  }
});

document.getElementById('btnParseScp').addEventListener('click', () => {
  const raw = document.getElementById('scpTextarea').value.trim();
  if (!raw) {
    alert('请先粘贴 scp 命令');
    return;
  }
  const parsed = parseScpCommand(raw);
  if (!parsed) {
    alert('无法解析命令，请检查格式。\n\n支持格式: scp [选项] <本地路径> <user>@<host>:<远程路径>');
    return;
  }

  // 填入表单（增量覆盖）
  if (parsed.uploadDir) document.getElementById('fUploadDir').value = parsed.uploadDir;
  if (parsed.host) document.getElementById('fHost').value = parsed.host;
  if (parsed.user) document.getElementById('fUser').value = parsed.user;
  if (parsed.remotePath) document.getElementById('fRemotePath').value = parsed.remotePath;
  if (parsed.port) document.getElementById('fPort').value = parsed.port;

  // 选项：命令中出现的勾上，没出现的取消
  const opts = parsed.scpOptions;
  document.getElementById('fScpR').checked = opts.recursive;
  document.getElementById('fScpO').checked = opts.legacyProtocol;
  document.getElementById('fScpP').checked = opts.preserve;
  document.getElementById('fScpC').checked = opts.compress;
  document.getElementById('fScpV').checked = opts.verbose;
});

function parseScpCommand(raw) {
  // 去掉行首的 scp 关键字
  let str = raw.replace(/^scp\s+/i, '').trim();

  // 提取选项
  const opts = {
    recursive: false,
    legacyProtocol: false,
    preserve: false,
    compress: false,
    verbose: false
  };
  let port = null;

  // 匹配 -P <port>
  const portMatch = str.match(/(?:^|\s)-P\s+(\d+)/);
  if (portMatch) {
    port = parseInt(portMatch[1]);
    str = str.replace(portMatch[0], '');
  }

  // 匹配布尔选项
  const optFlags = str.match(/(?:^|\s)-[rOpCv]+/g);
  if (optFlags) {
    optFlags.forEach(flag => {
      flag = flag.trim().slice(1); // 去掉前导空格和 -
      if (flag.includes('r')) opts.recursive = true;
      if (flag.includes('O')) opts.legacyProtocol = true;
      if (flag.includes('p')) opts.preserve = true;
      if (flag.includes('C')) opts.compress = true;
      if (flag.includes('v')) opts.verbose = true;
    });
    // 移除已解析的选项
    str = str.replace(/(?:^|\s)-[rOpCv]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // 提取 user@host:remotePath
  const remoteMatch = str.match(/(\S+?)@(\S+?):(.+)/);
  if (!remoteMatch) return null;

  const user = remoteMatch[1];
  const host = remoteMatch[2];
  const remotePath = remoteMatch[3];

  // 本地路径 = remote 之前的部分
  const localPath = str.substring(0, str.indexOf(remoteMatch[0])).trim();

  if (!localPath || !host || !remotePath) return null;

  return {
    uploadDir: localPath,
    host,
    user,
    remotePath,
    port,
    scpOptions: opts
  };
}

// ========== 接收来自 Extension 的消息 ==========
window.addEventListener('message', event => {
  const message = event.data;
  switch (message.type) {
    case 'projectsList':
      projects = message.projects;
      renderProjectList();
      break;
    case 'deployStep':
      updateStep(message.step);
      break;
    case 'deployLog':
      appendLog(message.line);
      break;
    case 'deployProgress':
      updateProgress(message.progress);
      break;
    case 'deployComplete':
      showComplete(message);
      break;
    case 'passwordSaved':
      if (!message.success) {
        alert('密码保存失败');
      }
      break;
    case 'folderSelected':
      if (message.field === 'localPath') {
        document.getElementById('fLocalPath').value = message.path;
      } else if (message.field === 'uploadDir') {
        document.getElementById('fUploadDir').value = message.path;
      }
      break;
  }
});

// ========== 初始化 ==========
vscode.postMessage({ type: 'getProjects' });