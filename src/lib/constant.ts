import * as vscode from "vscode";

export const ROOT_PATH =
  vscode.workspace.workspaceFolders &&
  vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;

export const CLI_TERMINAL_NAME = "ura cli";

export const SIDEBAR_SCRIPTS = "sidebar_scripts";
export const SIDEBAR_URA_CLI = "sidebar_ura_cli";
export const SIDEBAR_DEPENDENCIES = "sidebar_dependencies";
export const SIDEBAR_CONFIGURATION = "sidebar_configuration";
