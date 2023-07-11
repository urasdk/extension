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
  FileCreateEvent,
  FileDeleteEvent,
  TextDocumentChangeEvent,
} from "vscode";
import { ROOT_PATH, SIDEBAR_CONFIGURATION } from "../lib/constant";
import { readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { common } from "../lib/common";

interface TextDocumentInfo {
  col: number;
  row: number;
  colend: number;
  rowend: number;
  text: string;
}

export class Configuration implements TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData: EventEmitter<TreeItem | undefined | void> =
    new EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData: Event<TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  private static observedFilesRegExp: RegExp[] = [
    new RegExp(join(ROOT_PATH!, "capacitor.config.ts")),
    new RegExp(join(ROOT_PATH!, "package.json")),
    /build.gradle$/,
  ];
  private capacitorConfig: { [key: string]: any } = {};
  private androidConfig: {
    version?: TextDocumentInfo;
    versionCode?: TextDocumentInfo;
  } = {};
  private plugins: any[] = [];

  constructor() {
    this.registerModule();
  }

  private registerModule() {
    if (!common.workspace) {
      return;
    }

    this.resolveProject();

    // Register file mutations
    common.addFileMutation("save", this.onSave.bind(this));
    common.addFileMutation("delete", this.onFileEvent.bind(this));
    common.addFileMutation("create", this.onFileEvent.bind(this));

    // Register tree data provider
    window.registerTreeDataProvider(SIDEBAR_CONFIGURATION, this);

    // Register showText command
    commands.registerCommand(
      SIDEBAR_CONFIGURATION + ".showText",
      (showTextInfo) => this.showText(showTextInfo)
    );

    // Register refresh command
    commands.registerCommand(
      SIDEBAR_CONFIGURATION + ".refresh",
      this.refresh.bind(this)
    );
  }

  onSave(docu: TextDocument) {
    this.shouldBeObserved(docu.fileName) && this.refresh();
  }

  onFileEvent(fileEvent: FileDeleteEvent) {
    const obFiles = fileEvent.files.filter((filepath) =>
      this.shouldBeObserved(filepath.path)
    );
    if (obFiles.length) {
      this.refresh();
    }
  }

  async resolveProject() {
    if (!common.packageJson) {
      return;
    }

    if (
      !common.pathExists(join(ROOT_PATH!, "capacitor.config.ts")) /* &&
      !common.pathExists(join(ROOT_PATH!, "capacitor.config.js")) */
    ) {
      window.showErrorMessage('"capacitor.config.ts"  not found.');
      return;
    }

    await this.getCapacitorConfig();
    this.getPluginsInfo();
    await this.getAndroidConfig();
  }

  private async getCapacitorConfig() {
    try {
      const { default: capacitorConfig } = await common.loadTSFile(
        join(ROOT_PATH!, "capacitor.config.ts")
      );

      this.capacitorConfig = capacitorConfig;
      return capacitorConfig;
    } catch (error) {
      return null;
    }
  }

  /**
   * Retrieves information about the plugins used in the application.
   *
   * @returns {Array} An array containing the information of the plugins.
   */
  private getPluginsInfo() {
    // Get the list of possible plugins
    const possiblePlugins = [
      ...Object.keys(common.packageJson!.dependencies || {}),
      ...(this.capacitorConfig?.android?.localPlugins ||
        this.capacitorConfig?.localPlugins ||
        []),
    ];

    for (const pluginName of possiblePlugins) {
      const info = common.resolvePlugin(pluginName);
      // If the plugin is resolved successfully, add it to the list of plugins
      info && this.plugins.push(info);
    }

    return this.plugins;
  }

  /**
   * Retrieves the Android configuration.
   */
  private async getAndroidConfig() {
    const buildGradlePath = join(ROOT_PATH!, "android", "app", "build.gradle");

    if (common.pathExists(buildGradlePath)) {
      // Locate the versionName and versionCode properties in the build.gradle file
      await Promise.all([
        common.locateTextDocument(buildGradlePath, /versionName .*/),
        common.locateTextDocument(buildGradlePath, /versionCode .*/),
      ]).then(([version, versionCode]) => {
        if (version) {
          version.text = version.text.replace(/versionName /g, "");
          this.androidConfig.version = version;
        }
        if (versionCode) {
          versionCode.text = versionCode.text.replace(/versionCode /g, "");
          this.androidConfig.versionCode = versionCode;
        }
      });
    }
  }

  private shouldBeObserved(filePathOrName: string) {
    return !!Configuration.observedFilesRegExp.find((reg) =>
      reg.test(filePathOrName)
    );
  }

  /**
   * Show the specified text in a text document at the given position range.
   *
   * @param textInfo - The information of the text to be shown.
   * @param textInfo.col - The starting column of the text.
   * @param textInfo.row - The starting row of the text.
   * @param textInfo.colend - The ending column of the text.
   * @param textInfo.rowend - The ending row of the text.
   * @param textInfo.text - The text to be shown.
   * @param textInfo.path - The path of the text document.
   */
  showText(textInfo: {
    col: number;
    row: number;
    colend: number;
    rowend: number;
    text: string;
    path: string;
  }) {
    const { col, row, colend, rowend, path } = textInfo;
    let uri = Uri.file(path);

    // Create an options object with the specified selection range
    let options = { selection: new Range(row, col, rowend, colend) };

    // Show the text document with the specified uri and options
    window.showTextDocument(uri, options);
  }

  getTreeItem(element: TreeItem): TreeItem | Thenable<TreeItem> {
    return element;
  }

  async getChildren(
    element?: TreeItem | undefined
  ): Promise<(TreeItem | ConItem)[]> {
    if (
      !common.packageJson ||
      !common.pathExists(join(ROOT_PATH!, "capacitor.config.ts"))
    ) {
      return [];
    }

    if (element) {
      return await this.generateChild(element.label as "Project" | "Plugins");
    } else {
      return Promise.resolve([
        new TreeItem("Project", TreeItemCollapsibleState.Collapsed),
        // new TreeItem("Plugins", TreeItemCollapsibleState.Collapsed),
      ]);
    }
  }

  /**
   * Generates a child based on the provided label.
   *
   * @param { "Project" | "Plugins" } label - The label to determine which child to generate.
   * @return { ConItem[] } An array of generated child items.
   */
  async generateChild(label: "Project" | "Plugins") {
    const children: ConItem[] = [];
    if (label === "Project") {
      const { appId, appName } = this.capacitorConfig;
      const { versionCode, version } = this.androidConfig;

      // Create an object containing the necessary information for child items
      const childrenObj = { appId, appName, versionCode, version };
      const textInfo = {
        appId: await common.locateTextDocument(
          join(ROOT_PATH!, "capacitor.config.ts"),
          /appId: ?['"](.*)?['"]/
        ),
        appName: await common.locateTextDocument(
          join(ROOT_PATH!, "capacitor.config.ts"),
          /appName: ?['"](.*)?['"]/
        ),
      };

      // Iterate through the properties of childrenObj
      for (const key in childrenObj) {
        if (Object.prototype.hasOwnProperty.call(childrenObj, key)) {
          const value =
            typeof (childrenObj as any)[key] === "string"
              ? (childrenObj as any)[key]
              : (childrenObj as any)[key]?.text;

          if (value?.text || !value) {
            continue;
          }

          const name =
            key[0].toUpperCase() +
            key.slice(1).replace(/[A-Z]/g, (m) => " " + m.toUpperCase());

          const child = new ConItem(
            name,
            value,
            TreeItemCollapsibleState.None,
            {
              command: SIDEBAR_CONFIGURATION + ".showText",
              title: "Show Text",
              arguments: [
                (textInfo as any)[key] ??
                  this.androidConfig[key as "version" | "versionCode"],
              ],
            }
          );

          children.push(child);
        }
      }
    }

    return children;
  }

  async refresh() {
    await this.getCapacitorConfig();
    this.getPluginsInfo();
    await this.getAndroidConfig();
    this._onDidChangeTreeData.fire();
  }
}

class ConItem extends TreeItem {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly collapsibleState: TreeItemCollapsibleState,
    public command?: Command
  ) {
    super(name, collapsibleState);

    this.tooltip = this.name;
    this.description = this.description;
    command && (this.command = command);
  }
}
