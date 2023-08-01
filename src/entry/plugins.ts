import {
  TreeDataProvider,
  commands,
  EventEmitter,
  Event,
  TreeItem,
  window,
  Uri,
  Range,
  TextDocument,
  TreeItemCollapsibleState,
  Command,
  FileDeleteEvent,
  WorkspaceEdit,
  workspace,
} from "vscode";
import {
  CAPACITOR_PATH,
  ROOT_PATH,
  SIDEBAR_CONFIGURATION,
  SIDEBAR_PLUGINS,
} from "../lib/constant";
import { join } from "path";
import { CommonItem, PluginInfo, common } from "../lib/common";
import { readFileSync } from "fs";

interface TextDocumentInfo {
  col: number;
  row: number;
  colend: number;
  rowend: number;
  text: string;
}

type PluginType = "Local" | "Ignore" | "NPM";

export class Plugins implements TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: EventEmitter<TreeItem | undefined | void> =
    new EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData: Event<TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  constructor() {
    this.registerModule();
  }

  private registerModule() {
    if (!common.workspace) {
      return;
    }

    // Register file mutations
    common.addFileMutation("save", this.onSave.bind(this));
    common.addFileMutation("delete", this.onFileEvent.bind(this));
    common.addFileMutation("create", this.onFileEvent.bind(this));
    common.addFileMutation("change", this.onFileEvent.bind(this));

    // Register tree data provider
    window.registerTreeDataProvider(SIDEBAR_PLUGINS, this);

    commands.registerCommand(
      SIDEBAR_PLUGINS + ".activate",
      this.activatePlugin.bind(this)
    );
    commands.registerCommand(
      SIDEBAR_PLUGINS + ".ignore",
      this.ignorePlugin.bind(this)
    );
    commands.registerCommand(
      SIDEBAR_PLUGINS + ".refresh",
      this.refresh.bind(this)
    );
  }

  onSave(docu: TextDocument) {
    this.refresh();
  }

  onFileEvent(fileEvent: FileDeleteEvent) {
    this.refresh();
  }

  /**
   * Activates a plugin for the application.
   *
   * @param pluginViewItem - The plugin item to activate.
   */
  async activatePlugin(pluginViewItem: CommonItem) {
    const capacitorContext = readFileSync(CAPACITOR_PATH!, "utf-8");
    let includePlugins: string[] = common.capacitorConfig!.includePlugins;

    // Create a new workspace edit to make changes to the file
    const edit = new WorkspaceEdit();
    const uri = Uri.file(CAPACITOR_PATH!);
    const lastLine = (await workspace.openTextDocument(uri)).lineCount;

    // Create a range object that includes the entire file
    const range = new Range(0, 0, lastLine, 0);

    // Find the plugin object with the same name as the pluginViewItem
    const targetPlugin = common.plugins!.find(
      (plugin) => plugin.name === pluginViewItem.name
    );

    // If the plugin cannot be found, show an error message and return
    if (!targetPlugin) {
      window.showErrorMessage("Can not resolve plugin");
      return;
    }
    // If the plugin is already included, return
    else if (includePlugins.includes(targetPlugin.id)) {
      return;
    }

    includePlugins.push(targetPlugin.id);

    // Replace the includePlugins section in the capacitor.config.ts file
    // with the updated includePlugins array
    const text = capacitorContext.replace(
      /( )*includePlugins:[^\]]*\n?\]/,
      (all: string, blank: string) => {
        blank = blank.repeat(2);
        return (
          blank +
          "includePlugins:" +
          JSON.stringify(includePlugins, null, blank.length).replace(
            /\n/g,
            "\n" + blank
          )
        );
      }
    );

    // Replace the range in the file with the updated text
    edit.replace(uri, range, text);

    // Apply the edit to the workspace
    await workspace.applyEdit(edit);
    common.saveFile(CAPACITOR_PATH!);
  }

  async ignorePlugin(pluginViewItem: CommonItem) {
    const includePlugins: string[] = common.capacitorConfig?.includePlugins;
    const id = pluginViewItem.args!.id;
    let targetPlugins!: string[];
    if (includePlugins) {
      const index = includePlugins.indexOf(id);
      includePlugins.splice(index, 1);
      targetPlugins = includePlugins;
    } else {
      targetPlugins = common
        .plugins!.map((plugin) => {
          return plugin.id;
        })
        .filter((pluginId) => pluginId !== id);
    }

    const capacitorContext = readFileSync(CAPACITOR_PATH!, "utf-8");
    const edit = new WorkspaceEdit();
    const uri = Uri.file(CAPACITOR_PATH!);
    let range!: Range;
    let text!: string;

    if (includePlugins) {
      text = capacitorContext.replace(
        /( )*includePlugins:[^\]]*\n?\]/,
        (all: string, blank: string) => {
          blank = blank.repeat(2);
          return (
            blank +
            "includePlugins:" +
            JSON.stringify(includePlugins, null, blank.length).replace(
              /\n/g,
              "\n" + blank
            )
          );
        }
      );
      const lastLine = (await workspace.openTextDocument(uri)).lineCount;
      range = new Range(0, 0, lastLine, 0);
    } else {
      const capacitorTextInfo = await common.getCapacitorConfigTextInfo();
      common.capacitorConfig!.includePlugins = targetPlugins;
      text = JSON.stringify(common.capacitorConfig, null, 2).replace(
        /"([^"]+)":/g,
        "$1:"
      );
      range = new Range(
        capacitorTextInfo!.row,
        capacitorTextInfo!.col,
        capacitorTextInfo!.rowend,
        capacitorTextInfo!.colend
      );
    }

    edit.replace(uri, range, text);
    await workspace.applyEdit(edit);
    common.saveFile(CAPACITOR_PATH!);
  }

  getTreeItem(element: TreeItem): TreeItem | Thenable<TreeItem> {
    return element;
  }

  async getChildren(
    element?: TreeItem | undefined
  ): Promise<(TreeItem | CommonItem)[]> {
    if (!common.packageJson || !common.pathExists(CAPACITOR_PATH!)) {
      return [];
    }

    if (element) {
      return await this.generateChild(element.label as PluginType);
    } else {
      return await this.generateChild();
    }
  }

  async generateChild(label?: PluginType): Promise<(CommonItem | TreeItem)[]> {
    const children: (CommonItem | TreeItem)[] = [];
    const plugins = await common.getPluginsArray();

    if (!plugins || !plugins.length) {
      return [];
    }

    const includePluginIds: string[] | undefined =
      common.capacitorConfig?.android?.includePlugins ||
      common.capacitorConfig?.includePlugins;

    switch (label) {
      case "Ignore":
        if (includePluginIds) {
          const ignorePlugins = common.plugins!.filter((plugin) => {
            return !includePluginIds.includes(plugin.id);
          });

          children.push(
            ...ignorePlugins.map((plugin) => {
              const item = new CommonItem(
                plugin.name,
                "",
                TreeItemCollapsibleState.None,
                undefined,
                { id: plugin.id, local: plugin.local }
              );
              item.contextValue = label;
              return item;
            })
          );
        }
        break;
      case "NPM":
      case "Local":
        const target = plugins
          .filter((plugin) =>
            label === "Local" ? plugin.local : !plugin.local
          )
          .filter((plugin) => {
            return !includePluginIds || includePluginIds.includes(plugin.id);
          });

        children.push(
          ...target.map((localPlugin) => {
            const item = new CommonItem(
              localPlugin.name,
              "",
              TreeItemCollapsibleState.None,
              undefined,
              { id: localPlugin.id, local: localPlugin.local }
            );
            item.contextValue = label;
            return item;
          })
        );
        break;
      default:
        let ignorePlugins!: PluginInfo[];

        if (includePluginIds) {
          ignorePlugins = common.plugins!.filter((plugin) => {
            return !includePluginIds.includes(plugin.id);
          });
        }

        const pluginsTreeData = {
          local: [] as TreeItem[],
          npm: [] as TreeItem[],
        };

        common.plugins!.forEach((plugin) => {
          if (includePluginIds?.includes(plugin.id) || !includePluginIds) {
            if (plugin.local) {
              pluginsTreeData.local.push(plugin);
            } else {
              pluginsTreeData.npm.push(plugin);
            }
          }
        });

        if (pluginsTreeData.local.length) {
          children.push(
            new TreeItem("Local", TreeItemCollapsibleState.Collapsed)
          );
        }

        if (pluginsTreeData.npm.length) {
          children.push(
            new TreeItem("NPM", TreeItemCollapsibleState.Collapsed)
          );
        }

        if (ignorePlugins?.length) {
          children.push(
            new TreeItem("Ignore", TreeItemCollapsibleState.Collapsed)
          );
        }
        break;
    }
    return children;
  }

  private getItemCommand(name: string, type: PluginType): Command {
    if (type === "Ignore") {
      return {
        command: SIDEBAR_PLUGINS + ".activate",
        title: "Activate",
        arguments: [name],
      };
    } else {
      return {
        command: SIDEBAR_PLUGINS + ".ignore",
        title: "Ignore",
        arguments: [name],
      };
    }
  }

  async refresh() {
    this._onDidChangeTreeData.fire();
  }
}
