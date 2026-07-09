# Deploy Kit

一键部署前端项目到 Linux 服务器。

## 功能

- 🚀 一键部署：切分支 → git pull → 构建 → SCP 上传
- 📋 多项目管理：支持多个项目独立配置
- 🔒 密码加密存储：使用 VS Code SecretStorage
- 📊 实时进度：5 步部署流程可视化
- 🎛️ SCP 选项：支持 -r, -O, -p, -C, -v

## 安装

```bash
# VS Code 插件安装
code --install-extension deploy-kit-1.0.0.vsix

# Trae 插件安装
trae --install-extension deploy-kit-1.0.0.vsix
```

## 使用

1. 点击左侧 Activity Bar 的部署图标
2. 添加服务器和项目配置
3. 点击「一键部署」

## 配置存储

所有配置存储在 VS Code 用户级，不会随项目进入 Git。