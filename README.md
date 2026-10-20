# M-Team 资源助手

[![Build and release](https://github.com/jerboy/mteam/actions/workflows/build.yml/badge.svg)](https://github.com/jerboy/mteam/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

简约的 Chrome / Edge 浏览器扩展。搜索 M-Team 资源，并直接发送到自己的 qBittorrent 下载器。无需服务端或运行依赖。

- 搜索、筛选、排序、Markdown 简介与 BBCode 图片；图片预览支持滚轮缩放、拖动和左右切换。
- 多台 qBittorrent，默认使用用户名和密码，也支持 qBittorrent 5.2+ API Key。
- 可编辑的默认下载路径，远程目录补全、Tab 逐层选择与最近路径建议。
- 下载任务中心：进度、速度、状态，以及确认后删除任务及文件。
- 复制下载链接、保存种子文件、手动与定时刷新结果。
- 可选的定期打开官网，以及最近网页浏览时间检查。

## 安装

1. 在 [Releases](https://github.com/jerboy/mteam/releases/latest) 下载 `mteam-extension-*.zip` 并解压。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的 `mteam-extension` 文件夹。
4. 在扩展设置中填写自己的 M-Team API Key，按需添加下载器。

更新时将新版文件覆盖到原安装目录，再点击「重新加载」，即可保留原扩展 ID 和设置。也可以直接加载仓库的 [extension/](extension/) 目录。

详细使用、认证和权限说明见 [扩展文档](extension/README.md)。配置保存在本机浏览器中；发布包不包含账号凭据。网页访问沿用浏览器登录态，API 刷新不等同于网页登录，定期访问不保证账号保留。

## 开发

需要 Node.js 20.19+ 和 `zip` 命令：

```sh
npm ci --ignore-scripts
npm test
npm run package
```

打包结果为 `release/mteam-extension-<版本>.zip` 和对应的 `.sha256` 校验文件。

Markdown 使用 [Marked](https://marked.js.org/using_pro) 的词法解析器，再通过受限 DOM 节点渲染；不插入站点提供的 HTML。Marked 18.1.1 与 MIT 许可证随扩展本地分发。升级锁定依赖后运行 `npm run vendor` 同步文件；单元测试会校验一致性。LinkeDOM 仅用于内存 DOM 单元测试，不进入扩展包。

CI 另外使用 Python 3.10+ 和 `google-re2` 运行认证规则单元测试，覆盖 Chromium 的 RE2 编译内存限制。该依赖只用于测试，不包含在插件包内。本地运行方式：

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: -r scripts/tests/requirements.txt
.venv/bin/python -m unittest discover -s scripts/tests -p '*_test.py'
```

同步到已加载的其他本地目录：

```sh
npm run install:local -- /原先加载的扩展目录 1.6.0
```

最后一个参数是原安装版本，用来防止误覆盖。同步后在浏览器扩展管理页重新加载。

界面样式与组件约定见 [UI 设计规范](docs/ui.md)。

## 自动构建与发布

[GitHub Actions](https://github.com/jerboy/mteam/actions/workflows/build.yml) 在提交到 `main`、提交 Pull Request 或手动触发时运行单元测试并上传插件包。测试使用模拟数据，不访问真实账号或下载资源。

发布新版本时，同步修改 `extension/manifest.json`、根目录和扩展目录的 `package.json` 中的版本号，然后提交并推送对应标签：

```sh
git push origin main
git tag -a v1.7.0 -m "Release v1.7.0"
git push origin v1.7.0
```

将示例版本替换为尚未发布的新版本。标签必须与三个文件中的版本完全一致。标签触发的工作流会在单元测试通过后打包，并自动创建带 ZIP 和 SHA-256 校验文件的 GitHub Release，使用内置 `GITHUB_TOKEN`，无需配置个人令牌。

## 许可证

[MIT](LICENSE)。本项目与 M-Team、qBittorrent 无隶属关系。
