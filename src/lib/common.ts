import { accessSync, readFileSync } from "fs";
import {
  FileDeleteEvent,
  TextDocument,
  TextDocumentChangeEvent,
  window,
  workspace,
  TreeItem,
  Command,
  TreeItemCollapsibleState,
} from "vscode";
import { join, resolve, dirname, basename, sep } from "path";

import { CAPACITOR_PATH, ROOT_PATH } from "./constant";
import { verdaccioHelper } from "./verdaccio";

type ObserveType = "save" | "change" | "delete" | "create";

interface PackageJsonContent {
  name?: string;
  scripts?: { [script: string]: string };
  dependencies?: { [packName: string]: string };
  devDependencies?: { [packName: string]: string };
}

export interface PluginInfo {
  id: string;
  name: string;
  version: any;
  rootPath: string;
  repository: any;
  manifest?: undefined;
  local: boolean;
}
export interface TextDocumentInfo {
  col: number;
  row: number;
  colend: number;
  rowend: number;
  text: string;
  path: string;
}

const supportedOS = ["darwin", "win32", "linux"];

class CommonModule {
  workspace = false;
  packageJson?: PackageJsonContent;
  capacitorConfig?: { [key: string]: any };
  plugins?: PluginInfo[];
  os: NodeJS.Platform = "linux";

  private getPluginsTimeout?: number;

  private mutations: { [type: string]: Set<Function> } = {
    save: new Set(),
    change: new Set(),
    delete: new Set(),
    create: new Set(),
  };

  constructor() {
    if (!ROOT_PATH) {
      window.showInformationMessage("No dependency in empty workspace");
      return;
    }

    const currentOS = process.platform;

    if (supportedOS.includes(currentOS)) {
      this.os = currentOS;
    } else {
      window.showErrorMessage("Unsupported OS");
      return;
    }

    this.workspace = true;
    this.getPackageJson(ROOT_PATH);
    this.getPluginsArray();
    if (!this.packageJson) {
      window.showErrorMessage("Workspace has no package.json");
    }

    workspace.onDidSaveTextDocument(this.getListener("save").bind(this));
    workspace.onDidChangeTextDocument(
      this.getListener("change", false).bind(this)
    );
    workspace.onDidDeleteFiles(this.getListener("delete").bind(this));
    workspace.onDidCreateFiles(this.getListener("create").bind(this));

    workspace.onDidSaveTextDocument(this.getPackageJson.bind(this, ROOT_PATH));

    verdaccioHelper.getVerdaccioConfig();
  }

  addFileMutation(type: ObserveType, callback: Function) {
    this.mutations[type].add(callback);
  }

  /**
   * Returns a listener function that executes callbacks for a specific observe type.
   * @param type - The observe type.
   * @param debounce - Whether to debounce the execution of callbacks.
   * @returns The listener function.
   */
  getListener(type: ObserveType, debounce: boolean = true) {
    let timer: NodeJS.Timeout;

    /**
     * Executes the callbacks for the specified file.
     * @param file - The file to pass to the callbacks.
     */
    const executeCallbacks = (
      file: TextDocument | TextDocumentChangeEvent | FileDeleteEvent
    ) => {
      this.mutations[type].forEach((callback) => callback(file));
    };

    /**
     * Debounces the execution of the callbacks for the specified file.
     * @param file - The file to pass to the callbacks.
     */
    const debouncedExecuteCallbacks = (
      file: TextDocument | TextDocumentChangeEvent | FileDeleteEvent
    ) => {
      timer && clearTimeout(timer);
      timer = setTimeout(() => {
        executeCallbacks(file);
      }, 500);
    };

    /**
     * Handles the file events and executes the appropriate callbacks.
     * @param file - The file to pass to the callbacks.
     */
    const listener = (
      file: TextDocument | TextDocumentChangeEvent | FileDeleteEvent
    ) => {
      if (debounce) {
        debouncedExecuteCallbacks(file);
      } else {
        executeCallbacks(file);
      }
    };

    return listener;
  }

  getPackageJson(path: string): PackageJsonContent | undefined {
    const pkgPath = join(path, "package.json");
    let pkgContent!: PackageJsonContent;
    if (this.pathExists(pkgPath)) {
      pkgContent = JSON.parse(readFileSync(pkgPath, "utf-8"));
    }

    this.packageJson = pkgContent;

    return pkgContent;
  }

  /**
   * Loads a TypeScript file and transpiles it into CommonJS module format.
   * @param {string} filePath - The path to the TypeScript file.
   * @param {string} tsPath - The path to the TypeScript module.
   * @returns {any} - The loaded module.
   */
  async loadTSFile(
    filePath: string,
    tsPath: string = require.resolve("typescript", { paths: [ROOT_PATH!] })
  ) {
    // Import the TypeScript module
    const ts = await import(tsPath);

    // Resolve the file path and delete its cache
    const id = resolve(filePath);
    delete require.cache[id];

    // Define a custom require extension for TypeScript files
    require.extensions[".ts"] = (module: any, fileName: string) => {
      let sourceText = readFileSync(fileName, "utf8");

      if (fileName.endsWith(".ts")) {
        // Transpile the TypeScript source code into CommonJS module format
        const tsResults = ts.transpileModule(sourceText, {
          fileName,
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            esModuleInterop: true,
            strict: true,
            target: ts.ScriptTarget.ES2017,
          },
          reportDiagnostics: true,
        });
        sourceText = tsResults.outputText;
      } else {
        // Convert a modern ES module into an old school CommonJS module
        sourceText = sourceText.replace(/export\s+\w+\s+(\w+)/gm, "exports.$1");
      }

      // Compile and load the module
      module._compile?.(sourceText, fileName);
    };

    // Require the module using the resolved file path
    const m = require(id);

    // Delete the require extension for TypeScript files
    delete require.extensions[".ts"];

    // Return the loaded module
    return m;
  }

  pathExists(p: string): boolean {
    try {
      accessSync(p);
    } catch (err) {
      return false;
    }

    return true;
  }

  /**
   * Locates occurrences of a regular expression in a text document.
   *
   * @param filePath - The path of the text document.
   * @param regexp - The regular expression to search for.
   * @returns An array of TextDocumentInfo objects representing the occurrences.
   */
  async locateTextDocument(filePath: string, regexp: string | RegExp) {
    if (typeof regexp === "string") {
      regexp = new RegExp(regexp, "g");
    } else if (!regexp.global) {
      regexp = new RegExp(regexp.source, "g");
    }

    // Open the text document
    const doc = await workspace.openTextDocument(filePath);
    const results: TextDocumentInfo[] = [];
    const context = doc.getText();

    // Find all matches of the regular expression in the text document
    const matches = context.matchAll(regexp);

    // Process each match
    for (const value of matches) {
      const text = value[0];
      const preText = context.slice(0, value.index!);

      // Split the text and preText into lines
      const lines = text.split("\n");
      const preLines = preText.split("\n");

      // Get the last line of text and preText
      const lastLine = lines[lines.length - 1];
      const lastPreLine = preLines[preLines.length - 1];

      // Create a TextDocumentInfo object and add it to the results array
      results.push({
        col: lastPreLine.length,
        row: preLines.length - 1,
        colend: lastPreLine.length + lastLine.length,
        rowend: preLines.length + lines.length - 2,
        text,
        path: filePath,
      });
    }

    return results;
  }

  /**
   * Retrieves an array of plugins.
   *
   * @returns {PluginInfo[]} An array of plugins.
   */
  async getPluginsArray() {
    try {
      if (
        !this.capacitorConfig ||
        Date.now() > (this.getPluginsTimeout ?? 0) + 300
      ) {
        // Load the capacitor.config.ts file
        const { default: capacitorConfig } = await this.loadTSFile(
          CAPACITOR_PATH!
        );
        this.capacitorConfig = capacitorConfig;
      }
    } catch (error) {}

    // Get the local plugins from the `capacitorConfig` object
    const localPlugins =
      this.capacitorConfig?.android?.localPlugins ||
      this.capacitorConfig?.localPlugins ||
      [];

    let plugins: PluginInfo[] | undefined;

    // Array of possible plugin names.
    const possible = [
      ...Object.keys(this.packageJson!.dependencies || {}),
      ...Object.keys(this.packageJson!.devDependencies || {}),
      ...localPlugins,
    ];

    // Iterate over the possible plugin names and resolve each plugin.
    for (const key of possible) {
      const info = this.resolvePlugin(key);
      if (info) {
        !plugins && (plugins = []);
        localPlugins.indexOf(key) !== -1 && (info.local = true);
        plugins.push(info);
      }
    }

    this.plugins = plugins;
    this.getPluginsTimeout = Date.now();
    // Return the array of plugins.
    return plugins;
  }

  /**
   * Resolves a plugin by name or path.
   * Returns plugin metadata if found, otherwise returns null.
   * @param nameOrPath - The name or path of the plugin.
   * @returns The plugin metadata if found, otherwise null.
   */
  resolvePlugin(nameOrPath: string) {
    try {
      let local =
        nameOrPath.startsWith("link:") || nameOrPath.startsWith("file:");
      let fullpath = [nameOrPath.replace(/^file:/, ""), "package.json"].join(
        sep
      );
      const packagePath = require.resolve(fullpath, {
        paths: [ROOT_PATH!],
      });

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
          id: nameOrPath,
          name: this.fixName(meta.name),
          version: meta.version,
          rootPath,
          repository: meta.repository,
          manifest: meta.capacitor,
          local: local,
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Fixes the given name according to the specified rules.
   *
   * @param name - The name to be fixed.
   * @returns The fixed name.
   */
  fixName(name: string): string {
    // Check if the name starts with ".", "~", or "/" and remove any leading path separators
    if (name.startsWith(".") || name.startsWith("~") || name.startsWith("/")) {
      name = basename(name);
    }

    name = name
      .replace(/\//g, "_")
      .replace(/-/g, "_")
      .replace(/@/g, "")
      .replace(/_\w/g, (m) => m[1].toUpperCase());

    // Capitalize the first letter of the name
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  /**
   * Retrieves the information of the Capacitor configuration text.
   *
   * @returns {Object} - The information of the Capacitor configuration text.
   */
  async getCapacitorConfigTextInfo() {
    // Check if the Capacitor path exists
    if (!CAPACITOR_PATH || !this.pathExists(CAPACITOR_PATH)) {
      return;
    }

    // Locate the capacitor config Object in the Capacitor config file
    const capacitorObjInfo = (
      await this.locateTextDocument(
        CAPACITOR_PATH!,
        // Match an object with possible nested objects
        /{(?:[^{}]|{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*})*}/
      )
    ).filter((info) => {
      try {
        // Compare the evaluated object with the capacitorConfig
        return this.compareVariables(
          eval("(" + info.text + ")"),
          this.capacitorConfig
        );
      } catch (error) {
        return false;
      }
    })[0];

    return capacitorObjInfo;
  }

  /**
   * Compare two variables and determine if they are equal.
   *
   * @param a - The first variable to compare.
   * @param b - The second variable to compare.
   * @returns True if the variables are equal, false otherwise.
   */
  compareVariables(a: any, b: any): boolean {
    if (typeof a !== typeof b) {
      return false;
    }

    // Check if a and b are both arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        return false;
      }
      // Recursively compare each element of the arrays
      return a.every((value, index) => this.compareVariables(value, b[index]));
    }

    // Check if a and b are both objects
    if (
      typeof a === "object" &&
      a !== null &&
      typeof b === "object" &&
      b !== null
    ) {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) {
        return false;
      }

      // Recursively compare each value of the objects
      return keysA.every((key) => this.compareVariables(a[key], b[key]));
    }

    return a === b;
  }

  /**
   * Saves a file at the specified path.
   *
   * @param {string} path - The path of the file to be saved.
   */
  saveFile(path: string) {
    const doc = workspace.textDocuments.find((doc) => {
      return doc.uri.fsPath === path;
    });

    doc?.save();
  }
}

export const common = new CommonModule();

export class CommonItem extends TreeItem {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly collapsibleState: TreeItemCollapsibleState,
    public command?: Command,
    public args?: { [key: string]: any }
  ) {
    super(name, collapsibleState);

    this.tooltip = this.name;
    this.description = this.description;
  }
}
