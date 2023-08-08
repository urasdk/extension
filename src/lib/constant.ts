import { join } from "path";
import * as vscode from "vscode";

export const ROOT_PATH =
  vscode.workspace.workspaceFolders &&
  vscode.workspace.workspaceFolders.length > 0
    ? vscode.workspace.workspaceFolders[0].uri.fsPath
    : undefined;
export const CAPACITOR_PATH = ROOT_PATH
  ? join(ROOT_PATH, "capacitor.config.ts")
  : undefined;
export const PACKAGE_JSON_PATH = ROOT_PATH
  ? join(ROOT_PATH, "package.json")
  : undefined;

export const TERMINAL_NAME = "ura";
export const URA_CLI_PACKAGE_NAME = "@ura/cli";

export const SIDEBAR_SCRIPTS = "sidebar_scripts";
export const SIDEBAR_URA_CLI = "sidebar_ura_cli";
export const SIDEBAR_DEPENDENCIES = "sidebar_dependencies";
export const SIDEBAR_CONFIGURATION = "sidebar_configuration";
export const SIDEBAR_PLUGINS = "sidebar_plugins";
