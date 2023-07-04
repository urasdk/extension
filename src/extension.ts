import {
  Terminal,
  ExtensionContext,
  window,
  commands,
} from "vscode";
import { EntryList } from "./entryTree";
import { cli } from "./lib";
import { CLI_TERMINAL_NAME } from "./lib/constant";

let terminal = window.terminals.find((t) => t.name === CLI_TERMINAL_NAME) as Terminal;

export function activate(context: ExtensionContext) {
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

  const entryList = new EntryList();

  window.registerTreeDataProvider("sidebar_id1", entryList);

  context.subscriptions.push(commands.registerCommand("sidebar_id1.execCmd", async (args) => {
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

    if (!terminal || terminal.exitStatus) {
      terminal = window.createTerminal(CLI_TERMINAL_NAME);
    }

    terminal.show();
    terminal.sendText(cmdArgs.join(" "));
  }));
}

export function deactivate() {}
