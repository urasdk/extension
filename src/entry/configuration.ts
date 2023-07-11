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

  private static savedFiles: RegExp[] = [
    new RegExp(join(ROOT_PATH!, "capacitor.config.ts")),
    new RegExp(join(ROOT_PATH!, "package.json")),
    /build.gradle$/,
  ];
  private capConfig: { [key: string]: any } = {};
  private andConfig: {
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

    common.addFileMutation("save", this.onSave.bind(this));
    common.addFileMutation("delete", this.onFileEvent.bind(this));
    common.addFileMutation("create", this.onFileEvent.bind(this));

    window.registerTreeDataProvider(SIDEBAR_CONFIGURATION, this);
    commands.registerCommand(
      SIDEBAR_CONFIGURATION + ".showText",
      (showTextInfo) => this.showText(showTextInfo)
    );
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
      !common.pathExists(join(ROOT_PATH!, "capacitor.config.ts")) &&
      !common.pathExists(join(ROOT_PATH!, "capacitor.config.js"))
    ) {
      window.showErrorMessage('"capacitor.config.ts"  not found.');
      return;
    }

    await this.getCapacitorConfig();
    await this.getPluginsInfo();
    await this.getAndroidConfig();
  }

  private async getCapacitorConfig() {
    try {
      const { default: capConfig } = await common.loadTSFile(
        join(ROOT_PATH!, "capacitor.config.ts")
      );

      this.capConfig = capConfig;
      return capConfig;
    } catch (error) {
      return null;
    }
  }

  private async getPluginsInfo() {
    const possiblePlugins = [
      ...Object.keys(common.packageJson!.dependencies || {}),
      ...(this.capConfig?.android?.localPlugins ||
        this.capConfig?.localPlugins ||
        []),
    ];

    for (const pluginName of possiblePlugins) {
      const info = await this.resolvePlugin(pluginName);
      info && this.plugins.push(info);
    }

    return this.plugins;
  }

  private async getAndroidConfig() {
    const buildGradlePath = join(ROOT_PATH!, "android", "app", "build.gradle");
    if (common.pathExists(buildGradlePath)) {
      await Promise.all([
        common.locateTextDocument(buildGradlePath, /versionName .*/),
        common.locateTextDocument(buildGradlePath, /versionCode .*/),
      ]).then(([version, versionCode]) => {
        if (version) {
          version.text = version.text.replace(/versionName /g, "");
          this.andConfig.version = version;
        }
        if (versionCode) {
          versionCode.text = versionCode.text.replace(/versionCode /g, "");
          this.andConfig.versionCode = versionCode;
        }
      });
    }
  }

  private async resolvePlugin(name: string): Promise<any> {
    try {
      const packagePath = this.resolveNode(ROOT_PATH!, name, "package.json");

      if (!packagePath) {
        return null;
      }

      const rootPath = dirname(packagePath);
      const meta = JSON.parse(readFileSync(packagePath, "utf-8"));
      if (!meta) {
        return null;
      }
      if (meta.capacitor) {
        return {
          id: name,
          name: common.fixName(name),
          version: meta.version,
          rootPath,
          repository: meta.repository,
          manifest: meta.capacitor,
        };
      }
      return {
        id: name,
        name: common.fixName(name),
        version: meta.version,
        rootPath: rootPath,
        repository: meta.repository,
      };
    } catch (e) {
      // ignore
    }
    return null;
  }

  private resolveNode(root: string, ...pathSegments: string[]): string | null {
    try {
      return require.resolve(pathSegments.join("/"), { paths: [root] });
    } catch (e) {
      return null;
    }
  }

  private shouldBeObserved(filePathOrName: string) {
    return !!Configuration.savedFiles.find((reg) => reg.test(filePathOrName));
  }

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
    let options = { selection: new Range(row, col, rowend, colend) };
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
      const { appId, appName } = this.capConfig;
      const { versionCode, version } = this.andConfig;
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
                  this.andConfig[key as "version" | "versionCode"],
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
    await this.getPluginsInfo();
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
