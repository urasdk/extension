# ura README

为 Ura Cli 的便捷使用而创建的插件

## 功能

- [Cli commands](#cli-commands): 脚手架命令快捷调用列表
- [Scripts](#scripts): 从 `package.json` 中运行脚本命令
- [Project](#project-confiuration): Ura App 项目的配置
- [NPM Plugins](#npm-plugins): 通过 NPM 管理的在线插件
- [Local Plugins](#local-plugins): 管理代码存储在本地的插件
- [Ignore Plugins](#ignore): 忽略指定的在线或者本地插件
- [Switch Plugin Status](#switch-status): 切换插件的激活状态
- [Dependencies](#dependencies): 项目生产依赖
- [Devdependencies](#dependencies): 项目开发依赖


# 模块

## Cli commands
:::caution
 `CLI` 模块需要全局安装 [`@ura/cli`] 支持
:::note

模块加载时会读取 `ura cli` 的命令，并将每一条命令列举出来

在点击指定命令后，将会根据命令的需求向用户提供输入/选择框并执行命令

## Scripts

模块加载时会读取工作区目录下的 `package.json` 文件中的所有脚本命令，并在点击指定命令后即可根据脚本命令内容执行

## Project Configuration

该模块将会在加载时读取 `capacitor.config.ts` 以及 `android` 文件夹内的配置并以列表的形式在模块中给出

点击配置将会跳转到相应文件的对应位置中

## NPM Plugins

该模块可记录并操作项目的在线插件列表。在加载及文件变动时将会检查 `package.json` 的依赖包，逐一辨别依赖包是否为插件，符合则会被记录并作为列表内容

## Local Plugins

该模块可记录并操作项目的本地插件列表。在加载及文件变动时会读取 `capacitor.config.ts` 的 `android/localPlugins` 或 `localPlugins` 属性内容，当属性存在且属性值所指地址的文件经检查为插件时，将被记录并作为列表内容

## Ignore Plugins

该模块可记录并操作项目的忽略插件列表。在加载及文件变动时会读取 `capacitor.config.ts` 的 `android/ignorePlugins` 或 `ignorePlugins` 属性内容，当属性存在且属性值所指地址的文件经检查为插件时，将被记录并作为列表内容

## Switch Plugin Status

在线插件与本地插件可以通过面板的忽略功能，快捷修改 `capacitor.config.ts` 中 `ignorePlugins` 属性进行选择性的忽略

同样的，被忽略中的组件也可以随时通过面板激活

## Dependencies

该模块记录项目的开发和生产依赖，通过读取工作区根目录下的 `package.json` 列出当前项目的依赖及其版本
