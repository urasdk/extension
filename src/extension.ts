import { ExtensionContext } from "vscode";

import { UraCli } from "./entry/uraCli";
import { DepNodeProvider } from "./entry/dependencies";

export function activate(context: ExtensionContext) {
  new DepNodeProvider();
  new UraCli(context);
}

export function deactivate() {}
