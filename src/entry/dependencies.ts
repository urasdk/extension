import {
  TreeDataProvider,
  EventEmitter,
  Event,
  TreeItem,
  window,
  TreeItemCollapsibleState,
  Command,
  commands,
  Uri,
  ProgressLocation,
} from "vscode";
import { join } from "path";
import { exec } from "child_process";

import { ROOT_PATH, SIDEBAR_DEPENDENCIES } from "../lib/constant";
import { common } from "../lib/common";

type Item = Dependency | TreeItem;
export class DepNodeProvider implements TreeDataProvider<Item> {
  private _onDidChangeTreeData: EventEmitter<Item | undefined | void> =
    new EventEmitter<Item | undefined | void>();
  readonly onDidChangeTreeData: Event<Item | undefined | void> =
    this._onDidChangeTreeData.event;

  deps: { dependencies: Dependency[]; devDependencies: Dependency[] } = {
    dependencies: [],
    devDependencies: [],
  };

  constructor() {
    this.registerModule();
  }

  registerModule() {
    if (
      !Object.keys(common.packageJson?.dependencies || {}).length &&
      !Object.keys(common.packageJson?.devDependencies || {}).length
    ) {
      return;
    }

    window.registerTreeDataProvider(SIDEBAR_DEPENDENCIES, this);
    commands.registerCommand(SIDEBAR_DEPENDENCIES + ".refresh", () =>
      this.refresh()
    );

    // Open pacakge page on npm
    commands.registerCommand("extension.openPackageOnNpm", (moduleName) =>
      commands.executeCommand(
        "vscode.open",
        Uri.parse(`https://www.npmjs.com/package/${moduleName}`)
      )
    );

    // Select dependencies version
    commands.registerCommand(
      SIDEBAR_DEPENDENCIES + ".selectVersion",
      async (item) => {
        const pkgName = item.label;
        try {
          const ver = await this.selectVersion(pkgName);
          if (ver?.trim()) {
            this.installPack(pkgName, ver);
          }
        } catch (error) {
          window.showErrorMessage(`Can't get version of ${pkgName}`);
        }
      }
    );

    commands.registerCommand(SIDEBAR_DEPENDENCIES + ".add", () =>
      window.showInformationMessage(`Successfully called add entry.`)
    );
    commands.registerCommand(
      SIDEBAR_DEPENDENCIES + ".edit",
      (node: Dependency) =>
        window.showInformationMessage(
          `Successfully called edit entry on ${node.label}.`
        )
    );
    commands.registerCommand(
      SIDEBAR_DEPENDENCIES + ".delete",
      (node: Dependency) =>
        window.showInformationMessage(
          `Successfully called delete entry on ${node.label}.`
        )
    );
  }

  /**
   * Selects a version of a package.
   * @param pkgName - The name of the package.
   * @returns The selected version of the package, or undefined if no versions are available.
   */
  async selectVersion(pkgName: string): Promise<string | undefined> {
    let versions: string = "[]";
    let resolve!: Function;

    // Create a promise and assign the resolve function to the outer scope variable
    const promise = new Promise((res) => (resolve = res));

    // Show progress notification while fetching package versions
    window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: `npm view ${pkgName} versions`,
      },
      async (progress, token) => {
        progress.report({});

        // Execute 'npm view' command to get package versions
        const subprocess = exec(
          `npm view ${pkgName} versions`,
          async (err, stdout) => {
            if (err) {
              // Show error message if command execution fails
              const errMsg = `npm view ${pkgName} versions failed: ${err.message}`;
              window.showErrorMessage(errMsg);
            } else {
              versions = stdout.replace(/'/g, '"');
            }
            progress.report({ increment: 100 });
            resolve(); // Resolve the promise
          }
        );

        // Handle cancellation of the progress
        token.onCancellationRequested(() => subprocess.kill(0) && resolve());
      }
    );

    await promise; // Wait for fetching package versions

    const arr = JSON.parse(versions); // Parse the versions string as an array
    if (arr.length) {
      const title = `Select version of ${pkgName}`;
      window.showErrorMessage(JSON.stringify(arr.reverse()));
      return await window.showQuickPick(arr.reverse(), { title });
    } else {
      return undefined;
    }
  }

  /**
   * Install a specific package with a given version.
   * @param pkgName - The name of the package to install.
   * @param ver - The version of the package to install.
   */
  installPack(pkgName: string, ver: string) {
    let promise!: Function;

    // Execute the npm install command with the package name and version
    const subprocess = exec(
      `npm install ${pkgName}@${ver}`,
      {
        cwd: ROOT_PATH,
      },
      (err) => {
        // Show error message if npm install failed
        err &&
          window.showErrorMessage(
            `npm install ${pkgName}@${ver} failed: ${err.message}`
          );
        promise();
      }
    );

    // Show progress notification with the package name and version
    window.withProgress(
      {
        location: ProgressLocation.Notification,
        cancellable: true,
        title: `npm install ${pkgName}@${ver}`,
      },
      async (progress, token) => {
        progress.report({});
        token.onCancellationRequested(() => subprocess.kill(0));
        await new Promise((res) => (promise = res));
      }
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Dependency): TreeItem {
    return element;
  }

  async getChildren(element?: Dependency): Promise<(Dependency | TreeItem)[]> {
    if (!common.packageJson) {
      return [];
    }

    if (element?.label === "Dependencies") {
      return this.deps.dependencies;
    }

    if (element?.label === "DevDependencies") {
      return this.deps.devDependencies;
    }
    this.deps = this.getDepsInPackageJson();
    const depsArr: TreeItem[] = [];

    if (this.deps.dependencies.length) {
      depsArr.push(
        new TreeItem("Dependencies", TreeItemCollapsibleState.Collapsed)
      );
    }

    if (this.deps.devDependencies.length) {
      depsArr.push(
        new TreeItem("DevDependencies", TreeItemCollapsibleState.Collapsed)
      );
    }

    return depsArr;
  }

  /**
   * Given the path to package.json, read all its dependencies and devDependencies.
   */
  private getDepsInPackageJson() {
    const packageJson = common.packageJson!;

    const toDepency = (moduleName: string, version: string): Dependency => {
      return new Dependency(
        moduleName,
        version,
        TreeItemCollapsibleState.None,
        {
          command: "extension.openPackageOnNpm",
          title: "",
          arguments: [moduleName],
        }
      );
    };

    const deps = packageJson.dependencies
      ? Object.keys(packageJson.dependencies).map((dep) =>
          toDepency(dep, packageJson.dependencies![dep])
        )
      : [];
    const devDeps = packageJson.devDependencies
      ? Object.keys(packageJson.devDependencies).map((dep) =>
          toDepency(dep, packageJson.devDependencies![dep])
        )
      : [];
    return {
      dependencies: deps,
      devDependencies: devDeps,
    };
  }
}

export class Dependency extends TreeItem {
  constructor(
    public readonly label: string,
    private readonly version: string,
    public readonly collapsibleState: TreeItemCollapsibleState,
    public readonly command?: Command
  ) {
    super(label, collapsibleState);

    this.tooltip = `${this.label}-${this.version}`;
    this.description = this.version;
  }

  iconPaths = {
    light: join(
      __filename,
      "..",
      "..",
      "..",
      "resources",
      "light",
      "dependency.svg"
    ),
    dark: join(
      __filename,
      "..",
      "..",
      "..",
      "resources",
      "dark",
      "dependency.svg"
    ),
  };

  contextValue = "dependency";
}
