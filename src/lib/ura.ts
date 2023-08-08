import { execSync } from "child_process";

class UraCli {
  version: any = undefined;
  _cmds?: {
    [cmd: string]: {
      usage: string;
      args?: string[];
      optArgs?: string[];
      description: string;
    };
  };

  constructor() {
    this.getUraVersion() !== "uninstall" && this.getCommands();
  }

  getUraVersion() {
    try {
      this.version = execSync("ura --version", {
        stdio: ["ignore"],
      });
    } catch (error) {
      this.version = "uninstall";
    }

    return this.version;
  }

  getConfiguration() {}

  getCommands() {
    if (this._cmds) {
      return this._cmds;
    }

    const commandsInfo = execSync("ura --help", {
      stdio: ["ignore"],
      encoding: "utf-8",
    });
    let cmds: {
      [cmd: string]: {
        usage: string;
        args?: string[];
        optArgs?: string[];
        description: string;
      };
    } = {};

    commandsInfo.replace(/Commands:\n(.*\n)*/, (...arg) => {
      arg[0]
        .replace("Commands:\n", "")
        .split("\n")
        .forEach((cmdStr) => {
          cmdStr.replace(
            /([a-zA-Z-]*?)\s*([\[\<].*[\]\>])\s*(.*)/,
            (_, cmd, usage, description) => {
              cmds[cmd] = {
                usage: usage,
                args: usage
                  .match(/\<.*?\>/g)
                  ?.map((str: string) => str.replace(/[\<\>]/g, "")),
                optArgs: usage
                  .match(/\[.*?\]/g)
                  ?.map((str: string) => str.replace(/[\[\]]/g, "")),
                description: description,
              };
              return "";
            }
          );
        });
      return "";
    });

    this._cmds = cmds;
    return cmds;
  }
}

export const cli = new UraCli();
