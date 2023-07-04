import * as vscode from "vscode";

export const ROOT_PATH =
  vscode.workspace.workspaceFolders &&
  vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

export const CLI_TERMINAL_NAME = "ura cli";
