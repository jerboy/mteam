# M-Team 资源助手 · 1.9.0

Chrome / Edge 的 Manifest V3 浏览器扩展。支持搜索、筛选、排序、分页、海报、资源详情、多台 qBittorrent 下载与任务管理、复制下载链接、下载种子、结果刷新和定期打开官网。无需服务端、无需构建运行依赖。

## 安装或更新

在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 开启开发者模式，加载包含本文件的扩展目录。已经加载此目录时，点击对应扩展的「重新加载」即可更新，原有 API Key 保留。设置页显示版本号。

下载最新版：[GitHub Releases](https://github.com/jerboy/mteam/releases/latest)。源码：[jerboy/mteam](https://github.com/jerboy/mteam)。许可证：MIT。

## 配置与使用

在 M-Team「控制台 → 实验室 → 存取令牌」生成 API Access Token。打开扩展设置，填写 API Key、API 域名和官网地址并保存。插件通过 API Key 请求 API，不读取网站 Cookie 或密码。API Key 保存于 `chrome.storage.local`，不启用同步存储，也不是额外加密的密码保险箱。

关键词留空可浏览最新资源。点击资源名称，在独立标签页打开详情，支持直接刷新与整页滚动；顶部保留返回资源、打开站点、复制链接和下载操作。返回资源列表时恢复已保存的搜索条件、页码和结果。「下载」可选择 qBittorrent，也可保存种子文件。只有复制链接、保存种子或确认发送到下载器时，才生成专属链接。链接可能包含账号令牌，请勿公开分享。

资源简介优先按 BBCode 显示，支持嵌套引用、文字格式、链接、图片、列表、对齐、代码和折叠内容；保留普通文本的星号、下划线、空格及换行。没有识别到 BBCode 时兼容 Markdown 标题、列表、引用、表格、代码、链接与图片；只在 Markdown 代码示例中出现的 BBCode 不会触发格式切换。原始 HTML 作为文本显示，链接与图片仅接受不含用户名密码的 HTTP / HTTPS 地址，访问时不发送来源信息。

点击海报或简介图片打开预览。滚轮围绕指针位置放大或缩小，放大后拖动查看，双击或点击比例还原；键盘 `+` / `-` / `0` 同样可用。两侧箭头或键盘左右键循环切图：简介内按图片顺序，列表海报按当前页顺序；切图恢复适合窗口的大小。单张图片隐藏切换控件。Esc、关闭按钮或遮罩返回，预览期间暂停搜索自动刷新。

## qBittorrent 下载器

设置页的「下载器」可添加多台 qBittorrent，每台保存名称、WebUI URL 和独立凭据。URL 支持 HTTP / HTTPS、端口及反向代理子路径，例如 `http://192.168.1.2:8080` 或 `https://example.com/qbt`。保存时浏览器只向你申请该地址的访问权限；保存本身不发起连接。

认证默认使用 WebUI 用户名和密码，扩展调用 `/api/v2/auth/login` 并由浏览器携带会话 Cookie。也可选择 API Key，适用于 qBittorrent 5.2.0+ / WebAPI 2.14.1+；在 qBittorrent「设置 → WebUI → API Key」生成后填写，扩展使用 `Authorization: Bearer`，不调用登录接口或携带 Cookie。扩展不会生成、轮换或修改 qBittorrent 的密钥及设置。依据：[qBittorrent API Key 官方说明](https://github.com/qbittorrent/qBittorrent/wiki/API-Key-Authentication-%28%E2%89%A5v5.2.0%29)、[WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29)。

资源旁点击「下载」，选择下载器与目录后提交。每次打开或切换下载器时，目录输入框都预填该下载器的默认路径，可直接修改；最近 5 个成功使用的路径只用于补全建议。路径属于下载器所在设备，Docker 部署时使用容器内路径。有分类时，可在目录旁的小菜单主动选择，由 qBittorrent 自动管理分类路径（包括相对路径和子分类继承），提交前再次校验分类。

点击或输入路径时，扩展自己的下拉列表显示当前层级的全部匹配目录，并合并默认目录、分类路径和最近路径。方向键选择，Tab 或 Enter 补全选中项并读取下一层，也可鼠标点击；Esc 收起建议，Shift+Tab 返回上一控件，无候选时 Tab 正常移出输入框。远程查询使用 qBittorrent 的 `app/getDirectoryContent` 目录接口，支持 POSIX、Windows 和 UNC 路径。输入查询有防抖及短时缓存；接口失败时显示简短状态，仍可手动填写，切换下载器时清空旧建议。

目录补全请求设有 10 秒等待上限，失败或超时可直接点击「重试」。关闭面板或切换下载器后，旧请求的迟到结果不会覆盖当前建议。1.3.3 修复了浏览器计时器调用上下文错误导致目录请求没有发出、一直显示「读取中」的问题。

扩展将临时下载链接直接交给所选 qBittorrent，下载器需要能访问 M-Team。成功提示表示接口接受了提交，不表示资源已经下载完成；网络中断导致结果不明时，请先查看下载器，扩展不会自动重试提交。更换下载器 URL 时需重新填写凭据，并清除该实例的旧目录记录。编辑原实例且 URL、认证方式、用户名不变时，凭据留空会保留原值。

下载器凭据仅存于本机 `chrome.storage.local`，不进入搜索缓存、链接或后台返回数据；本地存储不是加密密码保险箱。密码认证使用浏览器的登录 Cookie，但扩展不读取 Cookie 内容。API Key 认证明确省略 Cookie。HTTP 连接适合可信局域网，公网连接建议使用 HTTPS。

弹窗以资源列表为主，搜索压缩为单行；排序位于列表上方，其他条件通过「筛选」展开，按钮角标显示已选条件数。排序变更立即更新已有结果。资源旁的复制图标可复制下载链接，所有图标按钮都带有悬停提示或无障碍标签。搜索、设置、下载和任务中心统一使用灰白底色、品牌绿强调色及相同的字号、控件尺寸与反馈样式。

搜索结果支持手动刷新，以及每 5／15／30 分钟自动刷新（在筛选面板中设置）。手动刷新绕过搜索缓存；刷新保留当前查询、筛选、页码和尚未提交的关键词。仅在搜索面板开启、可见且没有筛选面板或其他弹窗时自动刷新；切到详情标签页后，隐藏的搜索页暂停刷新。遇到认证失败停止，遇到限流按 Retry-After 暂停。搜索刷新不计网页登录。

## 下载任务中心

顶部「任务」打开当前下载器的全部任务，包括从 qBittorrent 或其他工具添加的任务。可切换下载器、筛选下载中或已完成，每页 50 条，最新添加的任务排在前面。进度条、完成百分比、文件大小、下载或上传速度及状态每 5 秒刷新；任务中心关闭、页面隐藏或正在确认删除时暂停轮询。关闭插件不影响 qBittorrent 继续下载。

任务旁的删除图标会先显示资源名称、下载器及内容路径。点击「删除任务及文件」后，通过 qBittorrent 的 `torrents/delete` 接口发送该任务的唯一 hash 和 `deleteFiles=true`，移除任务以及下载器设备上已下载的文件。删除前重新校验任务名称、目录和添加时间；任务或下载器配置变更后需刷新并重新确认。不提供批量删除，不会自动重复发送结果未知的删除请求。

成功响应表示 qBittorrent 接受了删除请求；文件删除由下载器完成，扩展不直接访问文件系统，也不保证磁盘删除已完成。网络中断等导致结果未知时，应到 qBittorrent 确认。此功能不适用于「保存种子文件」发起的浏览器下载。接口依据：[qBittorrent WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-%28qBittorrent-5.0%29#delete-torrents)。

## 网页登录与账号保留

[M-Team 官方账号规则](https://wiki.m-team.cc/account-rules)规定：普通未封存账号连续 40 天不登录会被删除，封存通常为 90 天；部分等级有豁免。做种和第三方工具访问不算网页登录。[官方 API 规则](https://wiki.m-team.cc/api)要求第三方使用 API Key，并警告继续使用 Cookie 调接口可能被停用。

设置页可开启每 7／14／28 天定期打开官网，默认关闭。首次自动访问安排在下一周期，也可点击「访问官网」立即打开。定期访问使用 Chrome / Edge 自带的定时任务，并沿用浏览器自身的登录态，不读取 Cookie、不填密码或验证码。它会新建一个官网标签页，不读取或修改你已有的其他标签页。

打开网页后约一分钟，通过允许的 `/member/profile` 接口对比站点返回的 `memberStatus.lastBrowse`。只显示观察到的时间变化，不能保证满足保号规则；无法确认更新时提示你检查登录，并在开启定期访问时安排隔天重试。验证码或登录过期仍需你自行处理。

浏览器需保持运行；电脑休眠时不会被唤醒，恢复后到期访问最多执行一次。扩展更新或浏览器重启后会从本地设置恢复任务。关闭定期访问、清除或修改账号配置都会取消原计划；更换账号后需要重新开启。卸载扩展会由浏览器移除其定时任务，无需系统 LaunchAgent。

## 权限

- `storage`：保存设置、会话和定时状态。
- `clipboardWrite`、`downloads`：复制下载链接、保存种子文件。
- `alarms`：定期打开官网和延后检查最近浏览时间。
- 固定跨域权限仅包含 `api.m-team.cc` 与 `api.m-team.io`。下载器通过 `optional_host_permissions` 声明 HTTP / HTTPS 可选范围，保存时仅请求填写的地址，不申请整个范围。
- `declarativeNetRequestWithHostAccess`：仅对扩展自身发往当前下载器已知接口的请求设置认证所需的同源请求头；完成后移除临时规则，不修改普通网页请求。
- 不申请 `cookies`、`tabs` 或 `scripting`，不注入内容脚本，不读取其他网页、浏览历史或设备信息。

M-Team API 请求仅带 `x-api-key`，明确省略 Cookie。两类 API 都不跟随带凭据重定向。浏览器普通网页访问使用自己的会话；两者分开处理。详情中的原始 HTML 按文本显示，远端错误不回显敏感内容。

## 单元测试

开发时需要 Node.js 20+，无需安装依赖：

```sh
npm test
```

测试使用模拟 Chrome API、存储和网络响应，不运行界面测试、系统任务实测或真实账号接口测试。GitHub Actions 还会运行 RE2 单元测试，验证认证规则符合 Chromium 每条 2 KB 的编译限制；所有单元测试通过后打包发布。认证规则按接口拆分，并在连接结束后完整清理。

接口依据：[M-Team OpenAPI](https://test2.m-team.cc/api/v3/api-docs)。浏览器定时与标签页依据：[Chrome Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)、[Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)。本扩展与 M-Team 无隶属关系。
