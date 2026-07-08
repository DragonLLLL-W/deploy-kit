import * as vscode from 'vscode';
import { DeployViewProvider } from './WebviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DeployViewProvider(context.extensionUri, context);

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