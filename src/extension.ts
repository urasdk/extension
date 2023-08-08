import { ExtensionContext, Terminal, commands, window } from "vscode";

import { UraCli } from "./entry/uraCli";
import { DepNodeProvider } from "./entry/dependencies";
import { Configuration } from "./entry/configuration";
import { Plugins } from "./entry/plugins";
import { common } from "./lib/common";
import { TERMINAL_NAME, URA_CLI_PACKAGE_NAME } from "./lib/constant";
import { verdaccioHelper } from "./lib/verdaccio";

export function activate(context: ExtensionContext) {
  commands.registerCommand(
    "sidebar.installGlobal",
    async (args: string[] | string) => {
      typeof args === "string" && (args = [args]);
      const terminal =
        (window.terminals.find((t) => t.name === TERMINAL_NAME) as Terminal) ||
        window.createTerminal(TERMINAL_NAME);
      args.unshift("npm", "install", "-g");
      terminal.show();
      if (common.os !== "win32") {
        args.unshift("sudo");
      }

      const verConfig = await verdaccioHelper
        .getVerdaccioConfig()
        .catch((err) => {
          window.showErrorMessage(err);
        });

      if (await verdaccioHelper.checkVerdaccioStatus()) {
        // 如果后台运行着 verdaccio，则优先从后台获取
        const versions = await verdaccioHelper.getPkgVersions(
          URA_CLI_PACKAGE_NAME
        );
        versions.length && args.push("--registry=" + verConfig!.httpAddress);
      }
      terminal.sendText(args.join(" "));
    }
  );

  new DepNodeProvider();
  new UraCli(context);
  new Configuration();
  new Plugins();
}

export function deactivate() {}
