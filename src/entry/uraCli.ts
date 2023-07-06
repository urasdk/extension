import {
  TreeItem,
  TreeDataProvider,
  TreeItemCollapsibleState,
  Event,
  ProviderResult,
  window,
  ExtensionContext,
  commands,
  Terminal,
  EventEmitter,
} from "vscode";
import { join } from "path";
import { readFileSync, accessSync } from "fs";

import { cli } from "../lib/ura";
import { SIDEBAR_URA_CLI, CLI_TERMINAL_NAME, ROOT_PATH } from "../lib/constant";

// Entry Tree List
export class UraCli implements TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: EventEmitter<TreeItem | undefined | void> =
    new EventEmitter<TreeItem | undefined | void>();
  onDidChangeTreeData: Event<void | TreeItem | null | undefined> =
    this._onDidChangeTreeData.event;

  terminal = window.terminals.find(
    (t) => t.name === CLI_TERMINAL_NAME
  ) as Terminal;

  constructor(context: ExtensionContext) {
    this.registerModule(context);
  }

  registerModule(context: ExtensionContext) {
    window.registerTreeDataProvider(SIDEBAR_URA_CLI, this);
    commands.registerCommand(SIDEBAR_URA_CLI + ".refresh", () =>
      this.refresh()
    );
    context.subscriptions.push(
      commands.registerCommand(SIDEBAR_URA_CLI + ".execCmd", async (args) => {
        const command = cli.getCommands()[args];
        const cmdArgs = ["ura", args];

        if (command.args?.length) {
          for (const arg of command.args) {
            let ans: string | undefined;
            if (arg === "platform") {
              ans = await window.showQuickPick(["web", "android"], {
                placeHolder: "platform",
              });
            } else {
              ans = await window.showInputBox({
                placeHolder: arg,
                validateInput: (value) => (value.trim() ? null : "invalid"),
              });
            }
            cmdArgs.push(ans);
          }
        }

        if (!this.terminal || this.terminal.exitStatus) {
          this.terminal = window.createTerminal(CLI_TERMINAL_NAME);
        }

        this.terminal.show();
        this.terminal.sendText(cmdArgs.join(" "));
      })
    );

    context.subscriptions.push(
      commands.registerCommand(
        SIDEBAR_URA_CLI + ".execScript",
        async (args) => {
          const cmdArgs = ["npm run", args];
          if (!this.terminal || this.terminal.exitStatus) {
            this.terminal = window.createTerminal(CLI_TERMINAL_NAME);
          }

          this.terminal.show();
          this.terminal.sendText(cmdArgs.join(" "));
        }
      )
    );
  }
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(element: TreeItem): TreeItem | Thenable<TreeItem> {
    return element;
  }

  getChildren(element?: TreeItem): ProviderResult<TreeItem[]> {
    if (!ROOT_PATH) {
      return [];
    }

    if (cli.version === "uninstall") {
      window
        .showInformationMessage(
          "Ura cli is uninstall, please install with npm",
          "confirm",
          "cancel"
        )
        .then((...arg) => {
          if (arg[0] === "confirm") {
            // TODO: 提醒用户全局安装
          }
        });
    }
    const packageJsonPath = join(ROOT_PATH, "package.json");
    if (!this.pathExists(packageJsonPath)) {
      window.showErrorMessage("Workspace has no package.json");
      return [];
    }

    if (element) {
      const children: TreeItem[] = [];
      if (element.label === "Cli commands") {
        const cmds = cli.getCommands();

        //  Ura Cli commands
        for (let cmdName of Object.keys(cmds)) {
          let item = new TreeItem(cmdName, TreeItemCollapsibleState.None);
          item.command = {
            command: SIDEBAR_URA_CLI + ".execCmd", //命令id
            title: "Ura Command",
            arguments: [cmdName], //命令接收的参数
          };
          children.push(item);
        }

        return children;
      } else {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        for (const script in packageJson.scripts) {
          let item = new TreeItem(script, TreeItemCollapsibleState.None);
          // const iconRootPath = join(__filename, "../../..", "resources");
          // item.iconPath = {
          //   light: join(iconRootPath, "light", "play.svg"),
          //   dark: join(iconRootPath, "dark", "play.svg"),
          // };
          item.command = {
            command: SIDEBAR_URA_CLI + ".execScript",
            title: "Script",
            arguments: [script],
          };
          children.push(item);
        }
        return children;
      }
    } else {
      //根节点
      return [
        new TreeItem("Cli commands", TreeItemCollapsibleState.Collapsed),
        new TreeItem("Scripts", TreeItemCollapsibleState.Collapsed),
      ];
    }
  }
  private pathExists(p: string): boolean {
    try {
      accessSync(p);
    } catch (err) {
      return false;
    }

    return true;
  }
}
