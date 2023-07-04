import * as vscode from "vscode";
import { cli } from "./lib";
// Silebar Entry Tree
export class EntryItem extends vscode.TreeItem {}

// Entry Tree List
export class EntryList implements vscode.TreeDataProvider<EntryItem> {
  onDidChangeTreeData?:
    | vscode.Event<void | EntryItem | null | undefined>
    | undefined;
  getTreeItem(element: EntryItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }
  getChildren(element?: EntryItem): vscode.ProviderResult<EntryItem[]> {
    if (cli.version === "uninstall") {
      return [
        new EntryItem(
          "还没安装Ura Cli，请用 npm 全局安装",
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    if (element) {
      const children = [];
      const cmds = cli.getCommands();

      //  Ura Cli commands
      for (let cmdName of Object.keys(cmds)) {
        let item = new EntryItem(cmdName, vscode.TreeItemCollapsibleState.None);
        item.command = {
          command: "sidebar_id1.execCmd", //命令id
          title: "title",
          arguments: [cmdName], //命令接收的参数
        };
        children.push(item);
      }

      return children;
    } else {
      //根节点
      return [
        new EntryItem(
          "Cli commands",
          vscode.TreeItemCollapsibleState.Collapsed
        ),
      ];
    }
  }
}
