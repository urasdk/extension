import { ExtensionContext } from "vscode";

import { UraCli } from "./entry/uraCli";
import { DepNodeProvider } from "./entry/dependencies";
import { Configuration } from "./entry/configuration";
import { Plugins } from "./entry/plugins";

export function activate(context: ExtensionContext) {
  new DepNodeProvider();
  new UraCli(context);
  new Configuration();
  new Plugins();
}

export function deactivate() {}
