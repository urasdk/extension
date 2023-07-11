import { accessSync, readFileSync } from "fs";
import {
  FileDeleteEvent,
  TextDocument,
  TextDocumentChangeEvent,
  window,
  workspace,
} from "vscode";
import { join, resolve, dirname, basename } from "path";

import { ROOT_PATH } from "./constant";

type ObserveType = "save" | "change" | "delete" | "create";

interface PackageJsonContent {
  name?: string;
  scripts?: { [script: string]: string };
  dependencies?: { [packName: string]: string };
  devDependencies?: { [packName: string]: string };
}

interface PluginInfo {
  id: string;
  name: string;
  version: any;
  rootPath: string;
  repository: any;
  manifest?: undefined;
}

class CommonModule {
  workspace = false;
  packageJson?: PackageJsonContent;
  capacitorConfig?: { [key: string]: any };
  plugins: PluginInfo[] = [];

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

    this.workspace = true;
    this.getPackageJson(ROOT_PATH);

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
  }

  addFileMutation(type: ObserveType, callback: Function) {
    this.mutations[type].add(callback);
  }

  getListener(type: ObserveType, debounce: boolean = true) {
    let timer: NodeJS.Timeout;
    return (file: TextDocument | TextDocumentChangeEvent | FileDeleteEvent) => {
      if (debounce) {
        timer && clearTimeout(timer);
        timer = setTimeout(() => {
          this.mutations[type].forEach((callback) => callback(file));
        }, 500);
      } else {
        this.mutations[type].forEach((callback) => callback(file));
      }
    };
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
   * Locates a text document based on the given file path and regular expression.
   *
   * @param {string} filePath - The path of the text document.
   * @param {string | RegExp} regexp - The regular expression used to locate the text.
   * @return {Promise<{ col: number, row: number, colend: number, rowend: number, text: string, path: string } | undefined>} A promise that resolves with the location of the text document, or undefined if not found.
   */
  async locateTextDocument(filePath: string, regexp: string | RegExp) {
    if (typeof regexp === "string") {
      regexp = new RegExp(regexp);
    }
    let col!: number,
      row!: number,
      colend!: number,
      rowend!: number,
      text!: string;

    const doc = await workspace.openTextDocument(filePath);
    const textLines = doc.getText().split("\n");
    const result = textLines.find((line, i) => {
      const matches = line.match(regexp);
      if (matches) {
        row = i;
        col = matches.index!;

        const matchStr = matches[0].split("\n");
        const spanRow = matchStr.length - 1;
        const lastRowLength = matchStr[spanRow].length;

        text = matches[0];
        colend = col + lastRowLength;
        rowend = row + spanRow;
      }

      return !!matches;
    });
    if (result) {
      return { col, row, colend, rowend, text, path: filePath };
    }
  }

  /**
   * Retrieves an array of plugins.
   *
   * @returns {PluginInfo[]} An array of plugins.
   */
  async getPluginsArray() {
    try {
      // Load the capacitor.config.ts file
      const { default: capacitorConfig } = await this.loadTSFile(
        join(ROOT_PATH!, "capacitor.config.ts")
      );
      this.capacitorConfig = capacitorConfig;
    } catch (error) {}

    // Get the local plugins from the `capacitorConfig` object
    const localPlugins =
      this.capacitorConfig?.android?.localPlugins ||
      this.capacitorConfig?.localPlugins ||
      [];

    const plugins: PluginInfo[] = [];

    // Array of possible plugin names.
    const possible = [
      ...Object.keys(this.packageJson!.dependencies || {}),
      ...Object.keys(this.packageJson!.devDependencies || {}),
      ...localPlugins,
    ];

    // Iterate over the possible plugin names and resolve each plugin.
    for (const key of possible) {
      const info = this.resolvePlugin(key);
      // If the plugin was resolved, push it to the `plugins` array.
      info && plugins.push(info);
    }

    this.plugins = plugins;

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
      const fullpath = join(ROOT_PATH!, nameOrPath, "package.json");
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
          name: this.fixName(nameOrPath),
          version: meta.version,
          rootPath,
          repository: meta.repository,
          manifest: meta.capacitor,
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  fixName(name: string): string {
    if (name.startsWith(".") || name.startsWith("~") || name.startsWith("/")) {
      name = basename(name);
    }
    name = name
      .replace(/\//g, "_")
      .replace(/-/g, "_")
      .replace(/@/g, "")
      .replace(/_\w/g, (m) => m[1].toUpperCase());

    return name.charAt(0).toUpperCase() + name.slice(1);
  }
}

export const common = new CommonModule();
