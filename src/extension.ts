import * as vscode from 'vscode';
import { DeployViewProvider } from './WebviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DeployViewProvider(context.extensionUri, context);
  // 注册 provider 自身，使其 dispose() 在扩展停用时被调用（终止在跑的子进程、清理监听器）
  context.subscriptions.push(provider);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeployViewProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    )
  );
}

export function deactivate(): void {
  // 清理逻辑（如有需要）
}