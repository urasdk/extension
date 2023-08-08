import { fork, ChildProcess, execSync, exec } from "child_process";
import { Writable } from "stream";
import * as net from "net";
import { ProgressLocation, commands, window } from "vscode";

interface VerdaccioConfig {
  configFile: string;
  httpAddress: string;
  htpasswdFile: string;
  username: string;
}

const DEFAULT_ALLOC_SIZE = 32;
const DEFAULT_GROW_SIZE = 16;
const VERDACCIO_SERVER_TIMEOUT = 30000;

const INFO_MSG = {
  canNotFindVerdaccio:
    "Verdaccio not found. Please ensure verdaccio is install globally. You can install it by following commands:\n    $ npm install --global verdaccio",
  canNotQueryUser: "Fail to query the username of package manager tool.",
  queryForInstalling:
    "Verdaccio is not installed. You can choose whether to install it.",
};

const stdoutReg = {
  // verdaccio 的配置文件位置
  configFile: / --- config file  - (.*config.yaml)/,
  // verdaccio 的服务地址
  httpAddress: / --- http address - (.*) - verdaccio/,
  // htpasswd 文件地址
  htpasswdFile: / --- using htpasswd file: (.*htpasswd)/,
};

class WritableStreamBuffer extends Writable {
  _size = 0;
  evtList: { [evt: string]: Function[] } = {};
  buffer!: Buffer;
  growSize = 0;
  constructor() {
    super();
    this.buffer = Buffer.alloc(DEFAULT_ALLOC_SIZE);
    this.growSize = DEFAULT_GROW_SIZE;
  }
  get size() {
    return this._size;
  }
  _write(
    chunk: any,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ) {
    const preLength = this.buffer.length;
    this.buffer = growBufferForAppendedData(
      this.buffer,
      this._size,
      Math.ceil(chunk.length / this.growSize) * this.growSize
    );
    const curLength = this.buffer.length;
    if (curLength - preLength > 0) {
      const newBuf = Buffer.alloc(curLength - preLength);
      chunk.copy(newBuf, 0, 0);
      this.dispatch("bufferchange", newBuf);
    }
    chunk.copy(this.buffer, this._size, 0);
    this._size += chunk.length;
    callback();
  }
  addListener(event: string, listener: Function) {
    if (this.evtList[event]) {
      this.evtList[event].push(listener);
    } else {
      this.evtList[event] = [listener];
    }
    return this;
  }
  dispatch(event: string, data: any) {
    this.evtList[event]?.forEach((cb) => cb(data));
  }
  consume(bytes?: number) {
    bytes = typeof bytes === "number" ? bytes : this._size;
    const data = Buffer.alloc(bytes);
    this.buffer.copy(data, 0, 0, data.length);
    this.buffer.copy(this.buffer, 0, data.length);
    this._size -= data.length;
    return data;
  }
}

function growBufferForAppendedData(
  buf: Buffer,
  actualsize: number,
  appendsize: number
) {
  if (buf.length - actualsize >= appendsize) {
    return buf;
  }
  const newbuffer = Buffer.alloc(buf.length + appendsize);
  buf.copy(newbuffer, 0, 0, actualsize);
  return newbuffer;
}

function checkVerdaccioVersion() {
  return new Promise((res, rej) => {
    try {
      const result = execSync("verdaccio --version", { encoding: "utf-8" });
      res(result);
    } catch (error) {
      rej(error);
      console.error(INFO_MSG.canNotFindVerdaccio);
    }
  });
}

function checkPortIsAvailable(port?: number) {
  return new Promise((resolve, reject) => {
    if (!port) {
      resolve(true);
      return;
    }
    const server = net.createServer();

    server.once("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        resolve(false); // Port is in use
      } else {
        reject(err); // Other error occurred
      }
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true); // Port is available
      });
    });

    server.listen(port);
  });
}

// verdaccio 命令是否全局安装了，是否存在
let cmdExist: boolean | undefined;
class VerdaccioHelper {
  verdaccioProcess?: ChildProcess;
  verdaccioConfig?: VerdaccioConfig;
  verdaccioDone!: Function;
  private verdaccioTimer?: NodeJS.Timeout;

  stdoutBuf!: WritableStreamBuffer;
  binPath!: string;
  taskQueue: { task: (buf: Buffer) => any; blockRes: Function }[] = [];

  constructor(private _opts = [], private _childOptions: any = {}) {
    const path =
      process.platform === "win32"
        ? require.resolve("verdaccio")
        : require.resolve("verdaccio", {
            paths: ["/usr/local/lib"],
          });
    this.binPath = path.replace(/verdaccio.*/, "verdaccio/bin/verdaccio");
  }

  /**
   * Checks the status of the Verdaccio service.
   * @returns {Promise<boolean>} - Returns true if the service is running, otherwise false.
   */
  async checkVerdaccioStatus() {
    // Check if the Verdaccio configuration has the httpAddress property
    if (this.verdaccioConfig?.httpAddress) {
      // Extract the port number from the httpAddress using regex
      const port = this.verdaccioConfig.httpAddress.match(/(\d+)/)![0];

      // Check if the port is available by calling the checkPortIsAvailable function
      if (!(await checkPortIsAvailable(Number(port)))) {
        return true; // Return true if the port is not available (service is running)
      }
    }

    return false; // Return false if the port is available (service is not running)
  }

  get childOptions() {
    this._childOptions.stdio = "pipe";
    return this._childOptions;
  }

  get allBuf() {
    return this.stdoutBuf.consume();
  }

  get timer() {
    return this.verdaccioTimer!;
  }

  set timer(num: NodeJS.Timeout) {
    clearTimeout(this.verdaccioTimer);
    this.verdaccioTimer = num;
  }

  /**
   * Starts the verdaccio process.
   *
   * @param callback - Optional callback function to handle the buffer data.
   * @returns A promise that resolves when the verdaccio process is closed.
   * @throws An error if verdaccio command is not found.
   */
  private async start(callback?: (buf: Buffer) => any) {
    const self = this;
    // Check if cmdExist is undefined
    if (cmdExist === undefined) {
      try {
        // Check verdaccio version and set cmdExist to true
        await checkVerdaccioVersion();
        cmdExist = true;
      } catch (error) {
        console.error(INFO_MSG.canNotFindVerdaccio);
        window
          .showInformationMessage(
            INFO_MSG.queryForInstalling,
            "cancel",
            "confirm"
          )
          .then((...arg) => {
            if (arg[0] === "confirm") {
              commands.executeCommand("installGlobal", "verdaccio");
            }
          });
        this.taskQueue[0]?.blockRes();
        this.taskQueue = [];
        this.verdaccioProcess = undefined;
        return;
      }
    }
    // Listener function to handle buffer data
    async function listener(buf: Buffer) {
      // Call the callback function or write to process.stdout
      callback ? await callback(buf) : process.stdout.write(buf.toString());
      self.timer = setTimeout(() => self.stop(), VERDACCIO_SERVER_TIMEOUT);
    }

    return new Promise((res, rej) => {
      // Check if cmdExist is false
      if (!cmdExist) {
        rej(INFO_MSG.canNotFindVerdaccio);
      }

      // Create writable stream buffers
      this.stdoutBuf = new WritableStreamBuffer();
      const stderrBuf = new WritableStreamBuffer();
      const combinedBuf = new WritableStreamBuffer();
      this.stdoutBuf.addListener("bufferchange", listener);

      // Set the callback for when verdaccio process is done
      this.verdaccioDone = (success = true, msg?: string) => {
        this.verdaccioProcess?.stdout?.unpipe(this.stdoutBuf);
        this.verdaccioProcess?.stdout?.unpipe(stderrBuf);
        this.verdaccioProcess?.stdout?.unpipe(combinedBuf);
        this.stdoutBuf.removeListener("bufferchange", listener);

        success ? res(undefined) : rej(msg);
        this.timer = setTimeout(() => this.stop(), VERDACCIO_SERVER_TIMEOUT);
      };

      // Start the verdaccio process
      !this.verdaccioProcess &&
        (this.verdaccioProcess = fork(
          this.binPath,
          this._opts,
          this.childOptions
        ));

      // Pipe the stdout and stderr to the stream buffers
      this.verdaccioProcess.stdout?.pipe(this.stdoutBuf);
      this.verdaccioProcess.stdout?.pipe(combinedBuf);
      this.verdaccioProcess.stderr?.pipe(stderrBuf);
      this.verdaccioProcess.stderr?.pipe(combinedBuf);

      // Handle error event
      this.verdaccioProcess.on("error", (err) => {
        console.log("Verdaccio error:", err);
        rej("Verdaccio error.");
      });

      // Handle message event
      this.verdaccioProcess.on("message", (msg: any) => {
        if (msg.verdaccio_started) {
          // verdaccio process has started
          // console.log("Verdaccio started.");
        }
      });

      // Handle close event
      this.verdaccioProcess.on("close", (code, signal) => {
        console.log("Verdaccio close, code:", code, ", signal:", signal);
        if (code !== 0 || signal) {
          this.verdaccioDone(false, "Verdaccio error.");
        } else {
          this.verdaccioDone();
        }
        this.verdaccioProcess = undefined;
      });

      !this.timer &&
        (this.timer = setTimeout(() => {
          rej("Time out");
          this.stop();
        }, VERDACCIO_SERVER_TIMEOUT));
    });
  }

  stop = () => {
    if (!this.verdaccioProcess) {
      return;
    }

    this.verdaccioProcess?.kill(2);
  };

  async run(callback: (buf: Buffer) => any, continued = false) {
    if (this.verdaccioProcess) {
      let res!: Function;
      const promise = new Promise((resolve) => {
        res = resolve;
      });
      this.taskQueue.push({ task: callback, blockRes: res });
      await promise;
    }

    try {
      await this.start(callback);
      if (this.taskQueue.length) {
        this.taskQueue.shift()!.blockRes();
      } else if (!continued) {
        this.stop();
      }
      return undefined;
    } catch (error) {
      throw new Error("Run callback error:" + String(error));
    }
  }

  async getVerdaccioConfig(): Promise<VerdaccioConfig> {
    if (this.verdaccioConfig) {
      return Promise.resolve(this.verdaccioConfig);
    }

    const verdaccioConfig = {} as VerdaccioConfig;
    return new Promise((res, rej) => {
      this.run((buf: Buffer) => {
        const stdoutStr = buf.toString();
        const keys = Object.keys(stdoutReg) as Array<keyof typeof stdoutReg>;

        keys.forEach((key) => {
          // 获取 verdaccio 的服务配置信息
          if (!verdaccioConfig[key]) {
            const matches = stdoutStr.match(stdoutReg[key])!;
            matches?.length > 1 && (verdaccioConfig[key] = matches[1]);
          }
        });
        if (Object.keys(verdaccioConfig).length === keys.length) {
          // 获取服务配置完毕，最后查询是否有用户登录了 verdaccio
          const cmd = "npm whoami --registry=" + verdaccioConfig.httpAddress;
          try {
            const result = execSync(cmd, { encoding: "utf-8" });
            // 获取用户名成功，Verdaccio 相关配置获取完毕
            verdaccioConfig.username = result.trim();
            if (!verdaccioConfig.username) {
              throw new Error("Username can not be empty");
            }
            this.verdaccioConfig = verdaccioConfig;
            res(verdaccioConfig);
          } catch (error) {
            // 获取用户名失败，需要提醒用户在使用前登录包管理工具
            console.error(INFO_MSG.canNotQueryUser);
            console.log("\nYou can login whit the following command:\n");
            console.log(
              `$ npm login --registry= ${verdaccioConfig.httpAddress}\n`
            );
            rej(error);
          }
          this.verdaccioDone();
        }
      }).catch((err) => {
        rej(err);
      });
    });
  }

  async getPkgVersions(pkgName: string) {
    if (!this.verdaccioConfig) {
      await this.getVerdaccioConfig();
      if (!this.verdaccioConfig) {
        console.log("Can not get verdaccio config");
        return [];
      }
    }

    const cmd = `npm view ${pkgName} versions --registry=${this.verdaccioConfig.httpAddress}`;
    let result: string[] = [];

    this.run(() => {}, true);

    await new Promise((res) => {
      window.withProgress(
        {
          location: ProgressLocation.Notification,
          cancellable: true,
          title: cmd,
        },
        async (progress, token) => {
          progress.report({});
          // Execute 'npm view' command to get package versions
          const subprocess = exec(cmd, async (err, stdout) => {
            if (err) {
              // Show error message if command execution fails
              const errMsg = `${cmd} failed: ${err.message}`;
              window.showErrorMessage(errMsg);
            } else {
              result = JSON.parse(stdout.replace(/'/g, '"'));
            }
            progress.report({ increment: 100 });
            res(undefined);
          });

          // Handle cancellation of the progress
          token.onCancellationRequested(
            () => subprocess.kill(0) && res(undefined)
          );
        }
      );
    });

    return result;
  }
}

export const verdaccioHelper = new VerdaccioHelper();
