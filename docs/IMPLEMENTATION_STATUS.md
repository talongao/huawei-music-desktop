# 实现进度

更新时间：2026-10-18。当前以 **Linux 真实 Electron 环境**完成共享 API、业务逻辑、页面和播放器验证；新增 macOS arm64 本地构建与有限真机验证，范围见下文。Windows/macOS 不阻塞共享功能开发，不使用 Wine 作为运行/验收依赖。

## macOS arm64 本地验证（2026-10-18）

- verified：macOS 27.0.1 / Apple Silicon，140 项离线单测、typecheck/build、未签名 arm64 App/DMG 构建、实际打包 App 启动、设置写回与 renderer 隔离检查通过。所有运行使用独立临时 profile，未导入研究凭据。
- verified：现有 Electron UI、业务、965 首收藏回归在该 Mac 通过，音频及账号均为合成夹具；不能据此宣称真实华为音源播放或私人音乐库验收完成。
- verified（图标修复）：用户初步试用反馈基本功能未见异常，并提供菜单栏图标异常截图。原 `capturePage` 生成方式将浏览器滚动条固化进 App/托盘 PNG；已改用 SVG → Canvas 直接栅格化、透明背景，并为 macOS 提供 18pt 单色 template 与 1×/2× 位图。尺寸、透明度及原生 Tray 布局检查通过；扩展屏真实菜单栏截图确认音符显示完整。内屏被菜单栏工具折叠，未改动其设置。
- verified（烟测修复）：原 `test:electron` 统一要求应用菜单为 null，与 macOS 最小角色菜单冲突。现按平台验证：macOS 只保留 app/edit/window 角色，Windows/Linux 继续要求无应用菜单和窗口内菜单栏。修正后完整 macOS 烟测与代理回归通过，覆盖合成 MP3/FLAC 播放、seek、ended、单 Audio、safeStorage 合成会话加密/解密/清理、导航/权限限制及媒体 allowlist。
- pending：真实账号 MP3/FLAC 全曲、重启恢复、物理媒体键、睡眠唤醒，以及 macOS x64；未逐项取得证据的能力仍待验收。

## M0–M6

| 里程碑 | 状态 | 当前证据与剩余验收 |
|---|---|---|
| M0 工程与安全边界 | verified | 锁定依赖；`npm ci`、typecheck、134 项离线单测、构建通过。Linux Electron 验证 renderer 无 Node/通用 IPC、精确来源与导航限制；app.asar 白名单检查通过。 |
| M1 登录与播放 | in-progress | 历史本人扫码已在正式 Electron 完成 CAS → OAuth → 音乐会话 → 首批 50 首收藏，无写操作。当前 Linux 本地合成 MP3/FLAC 实测播放、seek、ended、页面切换不中断通过。**真实华为 CDN 音源 MP3/FLAC 在 Electron 全曲播放、可用系统 safeStorage 下重启恢复仍待验收**。当前系统 backend=basic_text，应用正确 memory-only。 |
| M2 音乐库只读 | in-progress | 收藏、个人歌单/详情、搜索、专辑/歌手、历史已实现；歌单/专辑有分页。新增收藏总数后台索引 + 滚动分页 + 失败重试 + 切页/位置保留。965 首合成库在正式主进程与真实 renderer 分别通过；**不是本人 960+ 首的本轮实测**。收藏/歌单只在网络失败时回退 5MB 有标记缓存；400 不误判失效。 |
| M3 播放器日用能力 | in-progress | 单 Audio、顺序/随机/循环、音量/seek、音质选择、歌词高亮/手动滚动暂停跟随、队列恢复不自动播放。设置同步、媒体键旧闭包与初始化队列竞态已修。965 首队列真实磁盘读回完整且无播放 URL。真实 CDN/听播、过期资源和睡眠恢复仍未验收。 |
| M4 受控写操作 | in-progress | 主进程串行写，收藏幂等读回；简介/删除先确认当前账号 owned，再读回核对。创建保留本次基线与未决意图，超时不重发，进程重启仍阻止盲目重复创建。生产业务集成测试使用合成响应通过。历史真实接口写验证及 added=0/removed=0 证据仍有效；**新桌面写路径没有当前授权下的真实写验收**。 |
| M5 视觉与系统集成 | in-progress | Linux Electron 实际截图覆盖 1180×760、960×640、歌词/队列互斥、固定播放器/侧栏。中文字体测试缓存隔离修复，不修改系统。托盘/关闭/媒体键有代码，物理媒体键、无托盘桌面及睡眠恢复仍待验。四方向样机已提供，**用户尚未选择，不宣称视觉定稿**。 |
| M6 发行工程 | in-progress | Linux x64 AppImage 已构建；从实际 AppImage 提取二进制并启动隔离 profile，核对打包文件与当前 out 一致、renderer 无 Node、设置可保存，全部通过。Windows x64 单文件 portable EXE 已按后续用户要求在 Linux 交叉打包成功（99,522,256 字节，未用 Wine）；静态拆包确认内嵌 x64、无私有目录/源码、与当前 out 一致。启动速度/Windows 登录恢复/媒体仍未验收。原生 NSIS 安装包与 macOS arm64/x64 DMG 入口保留；不把历史失败的 NSIS 中间产物当安装包。deb 等待真实主页/维护者身份，不编造。 |

## 开源准备（README 重写）

- README 按开源项目结构重写：现状表（区分已实测/未验证）、截图（合成数据）、快速开始、功能范围与非目标、构建与打包（Windows 便携版 / Linux AppImage / macOS DMG / 交叉构建说明）、CI、测试、架构与安全边界、数据与隐私、已知限制、参与贡献、第三方组件、许可、免责声明。
- 原“Linux 内部构建 / Windows 单文件便携版（内部测试、未签名）/ GitHub Actions 自动打包”三节改为面向外部读者的构建与 CI 说明；不再以“内部”为标题，但保留未签名、未真机验收等事实说明。
- 新增 `docs/assets/` 三张合成数据截图；`test:release-contents` 确认它们不进入发行包。
- 许可已定为 **AGPL-3.0-only**：加入 `LICENSE`（GNU 官方文本）、`NOTICE`（版权、SPDX、第三方归属）、`package.json` 的 `license` 字段；README 说明许可范围、衍生作品与网络服务的源码义务，以及“许可不授予华为接口/商标/内容权利”。
- README 进一步明确 OAuth 应用标识出处：`client_id=101444301` 来自第三方公开帖（吾爱破解下载工具 / `Tontonnow/hwyy`），帖中未说明获取方式；我们的抓取显示它同时是华为音乐在 AppGallery 的应用 ID（`C101444301`），官方回调 scheme 为 `com.huawei.apps.101444301:/oauth2redirect`，因此极可能是官方 App 自身身份。
- 作者选择方案 B：仓库开源（AGPL-3.0）并保留现状；后续按作者要求恢复 **GitHub Release 发布**（未签名学习构建，发布说明写明未签名、非官方、OAuth 身份不属于本项目）。OSS 上的历史二进制已删除并验证 404；不再使用第三方对象存储分发。
- GitHub 仓库转为公开；Gitee 仍私有。

## CI：GitHub Actions 原生 Windows 打包（已跑通）

- 仓库镜像到 GitHub 私有仓库（`talongao/huawei-music-desktop`），新增 `.github/workflows/windows-portable.yml`：手动或 `v*` 标签触发，windows-latest 上执行 `npm ci` → 单元测试 → `dist:win:portable` → 静态校验 → SHA256SUMS → artifact（保留 7 天），不自动发布、不上传 OSS。
- 产物发布：手动运行或 `v*` 标签会创建/更新对应标签的 GitHub Release（exe + SHA256SUMS），不自动传 OSS；标签与 `package.json` 版本不一致会失败。
- 可选 Windows 烟测需要 ffmpeg，runner 不自带，已在步骤内 `choco install ffmpeg`；该步骤失败不阻断任务（此前失败即为缺少 ffmpeg，非应用缺陷）。
- 首次运行验证：run 38936061865 全绿，产物 100,141,218 字节，`SHA256 6d8c829c1613f46da6c01abb04699e7fe8a0001bbfe2de46424d3373dc7b774e`，应用 exe 名称为“华为音乐第三方客户端（学习版）.exe”，图标像素校验通过。
- 为让校验适配 Windows，静态检查改为：解包定位（不解析 7-Zip 清单文本）、兼容展平布局、asar 解包后按文件比对（不再依赖 asar 条目分隔符）。这些修复保留了 Linux 侧原有的 payload 名与 PE 架构断言。
- 原生 Windows 构建与本地 Linux 交叉构建字节不同，两者均通过同一套静态校验；**Windows 启动/播放仍未验收**。

## 第四批完成（去掉默认菜单 / 改名学习版）

- 移除 Electron 默认菜单：Windows/Linux `Menu.setApplicationMenu(null)`，窗口 `autoHideMenuBar`；macOS 仅保留 appMenu/editMenu/windowMenu 最小角色，Cmd+Q 等仍可用。smoke 回归新增断言：应用菜单为 null 且窗口菜单栏不可见。
- 改名为“华为音乐第三方客户端（学习版）”：显示名集中在 `src/shared/app-name.mjs`（窗口标题、侧栏、设置页、托盘 tooltip），`build.productName` 同步改为该名称，exe 显示名与 Linux desktop `Name` 一致；`package.json` 的 `name` 与 `appId` 未改，因此 userData 目录和已存设置/登录数据不迁移、不丢失。
- 回归：140 项单测、smoke（含菜单断言）、UI、业务、965 首、cancel/callback/navigation 均通过；Windows 包静态校验通过（应用 exe 改为动态发现，图标像素校验仍通过）；重命名后 Linux 包含新名称与图标。

## 第三批完成（登录内嵌窗口 / 自绘图标）

- 登录宿主由独立 `BrowserWindow` 改为主窗口内的 `WebContentsView`：远程页依旧无 preload、无 Node、独立临时 partition，权限/下载全拒；顶部保留 48px 取消条（`LOGIN_VIEW_TOP_INSET`），新增 `auth:cancelLogin` 白名单 IPC；窗口 resize 会重排视图，窗口关闭/取消/清理失败仍 fail-closed。
- 回归更新：取消用例改为点应用内“取消登录”，并断言全程 `BrowserWindow.getAllWindows().length === 1`；回调用例同步；live 工具改从 `web-contents-created` 取脱敏导航轨迹、按 URL 解析内嵌页。
- 图标：`scripts/make-icon.mjs` 从 Lucide（ISC）Music 字形生成 `build/icon.png`(512) 与 `build/tray.png`(32)，托盘改用生成的 `src/main/icons.ts`；归属声明写入 `build/icon.LICENSE.txt`。
- 图标证据：Windows 包内 `.icon-ico/icon.ico` 被解析出 16/24/32/48/64/128/256 七档，最大档 PNG 解码后品牌底色覆盖 85.6%、字形 11%（Electron 默认图标不可能满足）；Linux AppImage 内的 `huawei-music-desktop.png` 与 `build/icon.png` SHA-256 逐字节一致，`.desktop` 的 `Icon=` 指向它。
- 回归：140 项单测、smoke、UI、业务、965 首、cancel/callback/navigation、Linux AppImage 启动与重复解压不丢数据均通过。

## 第二轮完成（歌单缓存 / 随机播放 / 历史同步）

- 歌单缓存：`src/main/memory-cache.mjs` + `AuthManager` 进程内 5 分钟缓存；重复读歌单/详情不再请求，显式 `refresh` 回源；写操作与切换账号失效。生产业务测试断言重复读不增加网络请求、刷新只增加一次。
- 随机播放：设置页新增“随机播放（打乱队列顺序）”模式，与工具栏随机按钮同源；随机模式下“上一首”按实际播放顺序回退（`pushPlayHistory`/`popPlayHistory`）。
- 播放历史上报：`recentlyplayed/create` 按公开 H5 形态实现（`src/music.mjs` + `huawei.createRecentPlay`），真实收听达阈值后只报一次，秒数为实际收听；`syncHistory` 可关；`retry:false`、失败静默。**未用真实账号发起过写请求**，服务端效果待验。
- 测试：140 项单测、Electron smoke/UI/业务/965 首回归全部通过；UI 回归断言真实播放只上报一次且不超过整曲时长；业务回归断言上报负载与失败静默。

## 上一轮完成

- `src/main/favorites-catalog.mjs`：50 首分页计数到末页、ID 去重、在途请求共享、刷新/账号变更失效、无进展保护。接口无可靠总数字段，不猜接口或硬编码 960/965。
- `src/renderer/favorites-page.tsx`：总数与已加载数独立显示，底部预取下一批，错误保留内容并暂停自动重试；保留切页数据/滚动位置；播放全部先补齐分页，可取消准备。
- `src/main/writes.mjs`：owned 归属核验、写后读回、幂等/互斥、创建未决意图持久化。JSON 写入按文件串行，账号退出清队列、缓存、历史、未决意图及损坏备份；保留通用设置。
- `test:electron-business`：**不替换业务 IPC**，仅模拟登录页和 HTTP transport，生产 AuthManager/API/IPC 流程覆盖读取、写约束、缓存、400、退出清理；主进程 965 首扫描正好 20 页，随后读末页不重发。
- `test:electron-favorites`：965 首合成库，50→100→失败→重试→150，返回页面位置不变；播放全部取得 965 首，实际 queue.json 也是 965 首，无音频地址。
- `test:electron-ui`：页面、合成音频、写 UI、设置即时同步、最小窗口几何、队列跨进程恢复。
- 登录取消回归修复测试时序：等实际 CAS 页面后再投递错误 state；生产登录逻辑未因该测试更换。

## 测试边界

已运行：`npm ci`、typecheck/build、134 项单测、`test:electron`、`test:electron-ui`、`test:electron-business`、`test:electron-favorites`、`test:login-callback`、`test:login-cancel`、`test:login-navigation`、发行内容检查。公开登录页回归没有扫码或令牌交换。

`test:safe-storage-restart` 在当前 Linux 明确失败于 basic_text/backend 检查。**不通过 mock 加密器、明文后端或其它平台声明来代替它。**

截图位于被忽略的 `release/qa/`，其中 `linux-favorites-965-synthetic.png` 与 Smoke MP3/FLAC 都是离线测试内容，绝不是用户真实账号数据。当前 AppImage 是内部测试，不代表 M1 或三端验收完成。

本轮未读取/导入 `.local/` 私人会话、未执行任何真实账号写操作，因此没有新增真实对象需要清理。测试 profile 与合成资源由脚本 finally 清除。源码后按用户授权提交至 Gitee 私有仓库；安装包/凭据/日志未上传，未改系统代理。

## 运行与剩余参与点

- Linux 桌面：`npm ci && npm start`；headless 自动化：`npm run test:electron-favorites` 等命令自动使用 Xvfb。
- Linux 构建：`npm run dist:linux`；产物 `release/linux-x64/`。`test:packaged` 可检查 unpacked 或从 AppImage 提取的实际二进制。
- 真实账号完整收藏：新增 `npm run test:login-live -- --login --qr --full-library`，同一次本人授权核验总数、完整分页和滚动加载，只输出统计；默认不会运行。真实 MP3/FLAC 播放仍另验，不以该脚本冒充。
- 最新 AppImage：`release/linux-x64/huawei-music-desktop-0.0.1-linux-x86_64-internal.AppImage`；`release/linux-x64/SHA256SUMS` 已生成。`npm run test:packaged -- <AppImage路径>` 已通过，未上传。
- Windows portable：`npm run dist:win:portable`，产物 `release/win-x64-portable/huawei-music-desktop-0.0.1-win-x64-portable-internal.exe`；`test:windows-portable` 与 SHA256SUMS 已通过。重复解压仅限程序文件，用户数据仍在 userData；Windows 真实恢复待验。免安装不代表凭据跨电脑便携。
- `npm run test:portable-data` 在 Linux 实际 AppImage 上通过：第一次写合成设置/队列/本机存储后删除整份解压程序，再换新路径解压启动，userData 路径及三类数据均恢复；没有真实账号/凭据，不代表 Windows DPAPI 或启动速度已测。
- 视觉选择：`design-previews/2026-10-15-desktop/index.html` 的 A/B/C/D，未选前保持当前基础样式。
- Linux 密钥服务、真实听播、托盘/物理媒体键/睡眠仍需环境证据；Windows/macOS 原生测试延后，不阻塞共享逻辑。

历史流水及旧沙箱阻塞记录见 [IMPLEMENTATION_HISTORY.md](IMPLEMENTATION_HISTORY.md)，只作历史，不是当前环境结论。登录修复证据见 [LOGIN_CALLBACK_FIX.md](LOGIN_CALLBACK_FIX.md)。
