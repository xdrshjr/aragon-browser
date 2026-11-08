# aragon-browser

A nano browser that an AI agent drives by writing JavaScript. Named after the
thing it actually is: a browser with a patched **engine boundary**, not a patched
Chromium.

```
npm install
npm start                 # 开发模式启动浏览器（spaces / 标签 / handoff UI）
npm run dist              # 打包成 Windows 安装包，产物在 dist/
aragon-browser nodejs     # 从 stdin 读脚本，在已打开的浏览器里跑
```

```bash
aragon-browser nodejs -e "const s = await taskSpace('demo'); const p = await s.newPage('https://example.com'); cliLog((await p.snapshot()).text)"
```

---

## 诚实的边界：什么改了，什么没改

这个仓库叫 `aragon-browser`，按 ego lite 的原理实现了一个 nano 版本。**必须说清楚**：

**没有改 Chromium 源码。** 本机没有 MSVC / depot_tools / Chromium 源码树，任何
"重编译了内核"的说法都是空话。它是一个跑在 Electron 二进制之上的浏览器，改造发生
在**引擎与外部世界的五条边界**上，每一条都在真实浏览器上被测试证明过：

| 边界 | 普通做法 | aragon-browser 的做法 | 证据 |
|---|---|---|---|
| **AX 树** | 原样丢 `Accessibility.getFullAXTree` | 重建成紧凑文本：presentation 折叠、重复文本合并、只给可操作节点发 `@N`、按 `loaderId` 分文档失效 | 单测 20 项 + smoke |
| **跨进程 iframe** | 按 URL/标题猜位置，或丢弃 | `DOM.getFrameOwner` 的 backendNodeId **精确插回 `<iframe>` 原位**；解析不出归属的帧**单独报告**，绝不静默丢失 | smoke：跨站 iframe 内 click 落点正确 |
| **输入事件** | `element.click()` / 合成 DOM 事件 | `Input.dispatchMouseEvent` 真实指针序列，坐标 = 节点矩形 + **逐层累计帧偏移** | smoke：`frame-clicked:9 9 9` |
| **元素寻址** | 只认 CSS | 完整 locator 语法：`@N`/`ref=N`、`css:`、`loc=role:[name*=]`、`text=`（引号区分大小写与子串）、`href:`（精确匹配）、`xpath=`、`>> nth=N`、`:has-text/:text-is`；**穿透 shadow DOM**；失败分 transient/permanent | 单测 14 项 + smoke 12 项 |
| **进程与存储隔离** | 所有标签共用一个 cookie 罐 | 每 Space 一个 `session.partition`，两 Space 同站点互不可见 | smoke：cookie 探测 |

这五条是「改过内核」的**真实内容**：它们改变引擎输出的形状、引擎接收输入的方式、
以及引擎对外寻址的能力，属于渲染器/无障碍/CDP 这一层。它**不是** Blink 里的 C++ 补丁。

**能力差异，直说：**
- Snapshot 能做到「结构化且省 token」，但**做不到** ego lite 那种「内核里定制过的
  快照」的极限质量。它受限于 Chromium 暴露的 AX 树。
- 没有自己的更新器、没有代码签名、没有自动安装 PATH 集成。
- Linux 未验证（只在 Windows x64 + Electron 45 上跑过全套）。

---

## `skills/` — 给 Agent 用的入口

和 ego-lite 一样，项目根目录有一个 `skills/` 目录，agent（或人）读仓库就能找到这个
浏览器的技能，不需要被告知去哪看：

```
skills/aragon-browser/
  SKILL.md                      入口 skill（带 frontmatter，agent 靠它决定是否加载）
  references/install.md         安装与升级
  references/troubleshooting.md 每一个真实踩过的坑
  scripts/install.ps1           Windows 安装辅助
  scripts/install.sh            macOS 安装辅助
  learnings/                    站点技能，按域名自动加载
```

**两层设计，各管一件事**：

| 文件 | 谁读 | 为什么 |
|---|---|---|
| `skills/aragon-browser/SKILL.md` | agent 的 skill 发现机制 | 带 YAML frontmatter（`name` + `description`），**这是 agent 唯一会主动扫的东西**。没有 frontmatter，文件躺在 `~/.claude/skills/` 里但永远不会被加载——CLI 能用，agent 只是不知道它存在 |
| `src/cli/skill-body/SKILL.md` | `aragon-browser skill` | 完整 API 手册，按运行时 schema 渲染，随安装版本变化 |

入口 skill **故意不复述完整 API**，它只写 30 秒上手 + 5 条防坑规则，然后让你去读
`aragon-browser skill`。复述会立刻漂移——这正是 ego-lite 分两层的原因。

`learnings/` 放在 skill 目录里（而不是仓库根），这样「agent 面向的东西」就只有一个
目录。`ARAGON_AGENT_WORKSPACE` 可以覆盖，测试和多版本并存都靠它。

安装时复制的是**入口 skill**（带 frontmatter 的那份），不是打印出来的手册；手册由
CLI 按需打印，所以永远和运行中的构建一致。

### 为什么安装脚本不改 PATH

`scripts/install.ps1` / `install.sh` 只检查、只打印命令，绝不自己执行 `setx` 或往
`.zshrc` 里追加。一个在引导流程里静默改写用户环境的浏览器，和恶意软件没有区别。
加 PATH 是应用菜单里的一次显式操作（`File → Add CLI to PATH`）。有测试盯着这条。

---

## 桌面端安装包

```bash
npm install
npm run dist        # 出 dist/aragon-browser-0.1.0-x64.exe 和 -portable.exe
```

产物（Windows x64，Electron 45 / Chromium 156）：

| 文件 | 大小 | 用途 |
|---|---|---|
| `aragon-browser-0.1.0-x64.exe` | 115.7 MB | NSIS 安装包，可选安装目录、桌面/开始菜单快捷方式 |
| `aragon-browser-0.1.0-portable.exe` | 105.3 MB | 免安装单文件 |

安装后：

1. `aragon-browser` 命令被装到 `%LOCALAPPDATA%\aragon-browser\bin\`（一个 `.cmd`，优先用
   系统 Node；机器上没有 Node 时回落到 Electron 自带运行时）。
2. agent skill 被复制进**已存在**的 agent 目录（`~/.claude/skills`、`~/.codex/skills`、
   `~/.cursor/skills`）。不存在的宿主不会被凭空创建。
3. `skills/aragon-browser/` 位于 `resources/skills/`，含入口 skill、参考文档与 learnings，
   可直接编辑，不需要解包 asar。

**PATH 不会被偷偷改。** 加入 PATH 是菜单里的一次显式操作
（`File → Add CLI to PATH`）；首次运行只告诉你需要加哪一行。一个会在引导流程里静默
改写用户环境的浏览器，和恶意软件没有区别。

菜单还提供：`Agent → Show API in a window`、`Copy skill prompt`、`Open learnings folder`、
`Validate site skills`、`Show setup status`。

安装包**没有代码签名**，Windows SmartScreen 会拦一次（"更多信息" → "仍要运行"）。
这是一个诚实的缺口，不是被忽略的细节。

### 打包后才暴露的问题，都有测试守着

`npm run smoke:packaged` 跑的是**装好的构建**，不是源码树。它在开发过程中抓到过这些
只在打包后出现的问题：

- `app.isPackaged` 在 worker 上下文里不可靠 → 改用 `ARAGON_PACKAGED` 环境变量
- `runtime.version` 里返回了一个 Promise 字段，JSON 序列化会**静默吞掉**它
- esbuild 的 `inject` 只作用于模块作用域，CJS bundle 里的 `import.meta.url` 会直接抛
- `learnings` 从源码树能解析、打包后不行 → 改成按候选路径逐个探测
- 入口 `SKILL.md` 最初没有 YAML frontmatter，装进 `~/.claude/skills/` 也永远不会被
  agent 加载（CLI 能用，agent 只是不知道它存在）→ 补 frontmatter，并加两条测试守着：
  `test/skills-dir.test.mjs` 和打包测试里的「installed skill is discoverable」
- 首次运行写 agent skill 时用了 `os.homedir()`，测试污染了开发者自己的 `~/.claude`
  和 `~/.codex` → 改成可重定向的 home 解析，测试里正面断言 skill 落在了重定向目录

---

## 它证明自己真的能用的方式

```bash
npm test                 # 98 个单元测试：locator 语法、快照、ref、learning 校验、skills 结构、传输、分区、窗口控制与 space 作用域
npm run smoke            # 43 项真浏览器端到端断言
npm run smoke:ui         # 7 项 UI / 布局 / 像素 / 历史 / 无边框窗口断言
npm run smoke:packaged   # 11 项针对打包产物的断言（含 skill 可被发现）
npm run validate:skills  # 站点技能格式校验
```

另外手工跑通过完整链路（不是脚本）：`npm run dist` 出包 → `/S` 静默安装 → 启动安装版 →
shim 写入 PATH → 用 `aragon-browser` 命令驱动真实 HTTPS 页面（打开 example.com、快照、
点链接跳到 iana.org、截图）。

`npm run smoke` 启动真的 Electron 窗口，起一个本地 fixture，然后通过 CLI 跑一段
agent 脚本。fixture 是刻意设计的，每一处都对应一个真实失败模式：

- iframe 走 `localhost` 而页面是 `127.0.0.1`，所以它是**真的跨站**（OOPIF），
  不是同源 frame 的假测试；
- 页面上有两个同名按钮，用来证明 `>> nth=N` 真的选了其中一个，而**不带 nth 的选择器
  会明确报错**而不是瞎点；
- 有一个 shadow-DOM 组件，`document.querySelectorAll` 看不见它，只有穿透 shadow 的
  locator 能点到；
- 有一个 `confirm()` 按钮，所以对话框处理不是纸上功能；
- 有一个 file input 和一个拖拽源/落区。

43 项断言覆盖：快照与 ref 稳定性、跨站 iframe 拍平、跨帧 fill/click 落点、真实点击
触发页面监听器、6 种 locator 语法、歧义选择器**快速失败**（~1ms，不是等到超时）、
缺失元素是 transient、对话框记录与恢复、文件上传（含坏路径必须报错）、拖拽、
剪贴板往返、6 种等待、`waitForNavigation` 能区分「真的导航了」和「什么都没发生」、
learning 发现/运行/校验、导航后 ref 失效、前进后退、Cookie 隔离、控制权交接、
`finish()` 硬性要求 `keep`。

`ui-check.js` 另外断言页面视图几何、chrome 渲染、**系统级整窗截图**
（`webContents.capturePage()` 不合成子 `WebContentsView`，只用它会拍出黑色页面区——
这正是「看起来通过其实没证明」的坑），以及整页截图选项。

---

## 架构

```
aragon-browser <script>          ← 你/你的 agent
   │  stdin: JavaScript
   ▼
src/cli/                         客户端：注入 helpers，执行脚本
   │  NDJSON + per-launch token, 127.0.0.1:随机端口
   ▼
src/kernel/                      浏览器侧：RPC 方法表
   ├ browser-kernel.js           唯一的方法表（agent 面 / ui.* 面分开）
   ├ task-spaces.js              Space / 标签 / 所有权 / session 分区
   ├ cdp-channel.js              CDP 会话拓扑 + 事件环形队列 + 对话框策略
   ├ locator.js         ← 纯函数  locator 语法、错误分类、匹配 JS 生成
   ├ element-resolver.js         运行时：把 locator 落到具体 session + backendNodeId
   ├ ax-snapshot.js     ← 纯函数  AX 树 → 紧凑文本 + ref
   ├ ref-registry.js    ← 纯函数  @N 稳定性与失效
   ├ actions.js                  真实指针/键盘，帧偏移累计
   ├ interactions.js             上传 / 剪贴板 / 拖拽
   ├ waits.js                    等待原语，只重试 transient
   ├ learning/         ← 大部分纯函数  站点技能的发现、校验、执行
   └ runtime-transport.js        服务端 socket + 坐标发布
   ▲
   │  electron IPC（只允许 ui.*）
src/renderer/                    浏览器界面：自绘标题栏 / 侧边栏 / 标签栏 / 地址栏 / 前进后退 / handoff

skills/aragon-browser/           agent 面向的全部内容（入口 skill + 参考 + learnings）
src/cli/skill-body/SKILL.md      CLI 打印的完整手册（按 schema 渲染）
```

### 窗口骨架：标题栏是自己画的

窗口是 `frame: false` 的无边框窗口，**原生标题栏没有了**，但所有看得见的东西都还在：

| 部分 | 谁画 | 说明 |
|---|---|---|
| 标题栏（34px） | renderer `#titlebar` | 品牌、`space <id> · <name> · <owner>`、右侧最小化/最大化-还原/关闭 |
| 标签栏 + 地址栏（78px） | renderer `#chrome` | 原来就有 |
| 页面视图 | `WebContentsView` | 位置由 `src/shared/layout.js` 的 `pageBounds()` 算，`y` 必须 ≥ 标题栏高度 |

几处不是装饰、是坑的地方：

- **按钮在拖拽区里**：`#titlebar` 是 `-webkit-app-region: drag`，`.win-controls` 必须 `no-drag`，
  否则按钮点不动（能被拖，不能被点）。
- **页面视图会盖住标题栏**：`WebContentsView` 是子视图，合成在窗口自己的 web contents 之上。
  `pageBounds()` 的 `y` 必须把 34px 标题栏也算进去；`styles.css` 的 `--titlebar-height`
  和 `LAYOUT.titleBarHeight` 由 `test/titlebar.test.mjs` 盯着，drift 了就红。
- **一个按钮两种含义**：最大化和还原是同一个按钮，动作是「读当前状态再取反」，
  不是让渲染器猜自己该发哪个（`src/main/window-controls.js`）。
- **窗口标题不能被渲染器改**：`index.html` 的 `<title>` 会把 OS 窗口标题改成
  `aragon-browser`，于是每个 space 窗口同名，和装好的构建撞名；
  `page-title-updated` 里 `preventDefault()`，标题始终是 `aragon-browser - <space>`。
- **应用菜单默认收起**（`autoHideMenuBar`），按 Alt 唤出；菜单项和快捷键一个都没少。

`test/titlebar.test.mjs` 用假窗口对象测动作映射（`npm test` 里跑），
`npm run smoke:ui` 在真 Electron 里断言几件肉眼容易骗人的事：
`getSize() - getContentSize()` 接近 0（证明真的无边框）、页面视图 `y === 112`（证明没压住标题栏），
以及整窗截图的 `sourceName` 里带 space id、尺寸正好是窗口的 2 倍（证明截到的是**自己这个窗口**，
不是同名的另一个实例）。

space 作用域也在单测里：渲染器的 RPC 只认「发消息的那个窗口」的 space，名字对不上的直接拒绝，
唯一例外是侧边栏的 `ui.focusSpace`（点另一个 space 就是要聚焦它的窗口）。

---

### Agent 接进来要走的路径

```
agent 扫 skills/*/SKILL.md 的 frontmatter
   → 命中 aragon-browser，加载入口 skill
   → 入口只教 30 秒上手 + 5 条防坑规则，并指向 `aragon-browser skill`
   → agent 读完整手册（按运行时 schema 渲染，不会和二进制不一致）
   → 写一段 JS，pipe 给 `aragon-browser nodejs`
   → CLI 通过 loopback socket 找到运行中的浏览器，执行，回传 stdout
```

这条链上任何一环缺失，都表现为「CLI 明明能用，agent 就是不用它」：
没有 frontmatter 就不会被发现，不指向 `aragon-browser skill` 就会照着过期文档写脚本。

标了「纯函数」的模块不碰 Electron，所以核心语义可以用普通 `node --test` 跑。
这是刻意的：locator 语义和 ref 语义是最容易出错、也最值钱的部分。

### 为什么 Space 要用独立 partition

`persist:aragon-<profile>-space-<id>`。同站点在两个 Space 里是两套 cookie，
这是「agent 后台干活、你前台浏览，互不打架」的**存储层保证**，不是 UI 装饰。
`ephemeral` profile 用 `aragon-mem-...`，不落盘。

### 为什么要单独处理 OOPIF

`Target.setAutoAttach` 只对**它之后**出现的 iframe 生效。如果页面已经加载完再 attach
（真实使用里几乎总是如此），跨站 iframe 在 CDP 里完全不可见，快照会静默缺少整块内容。
所以 `settleChildSessions()` 同时做两件事：显式 `Target.attachToTarget` 已知 iframe，
并等 `Target.attachedToTarget` 事件追上 `Target.getTargets` 的答案——这两者不同步是
真实存在的一类竞态。

另外踩到的一个真坑：Electron 给根会话传的 session id 是**空字符串**而不是
`undefined`，`??` 会保留空串，导致子帧的 parent 变成 `""`（falsy），整块内容静默消失。
现在用真值判断，并且无法归属的帧会**单独报告**而不是消失。

### transient 与 permanent

这是整套设计里最容易被写反的一处：把缺失元素判成 permanent → 等待永远不重试，
页面慢一点就直接失败；把歧义判成 transient → 等待空转到超时，还掩盖了 bug。
所以：

- 0 个匹配 → `transient`（可能还没加载）
- >1 个匹配 → `permanent`（选择器本身有歧义）
- 语法错、ref 过期、跨文档 → `permanent`
- 节点不可见/零尺寸/被遮挡 → 重试仍按 transient 处理

`page.waitFor` 只重试 transient，smoke 里有一条断言专门测「歧义选择器 1ms 内失败」。

---

## API 表面（对齐 ego lite 词汇）

完整清单见 `aragon-browser help-api` 或 `aragon-browser skill`，那份文档是**从
`src/shared/public-api-schema.js` 渲染**的，不是抄的，所以不会和运行时漂移。

```
spaces   taskSpace / createTaskSpace / claimTaskSpace / listTaskSpaces
         useTaskSpace / takeOverTaskSpace / closeTaskSpace
         space.pages / tabs / newPage / page(label) / handOff / finish / waitForControl / learn
observe  page.snapshot / info / frames / screenshot / events / dialogs
act      page.click / doubleClick / rightClick / fill / type / press / hover
         page.scroll / drag / upload / clipboard / readClipboard
         page.goto / goBack / goForward / reload
wait     page.waitFor / waitForText / waitForExpression / waitForLoad
         page.waitForNetworkIdle / waitForDialog
dialogs  page.answerDialog / setDialogPolicy / dialogs
verify   page.evaluate / cdp / sendCDPMessage
learn    page.learn / runSiteTool / runSiteBrowserTool / learnContext / validateSiteSkills
```

Targets: `@N`、`ref=N`、`css:<sel>`、`loc=role:<role>[name=…]`、`text=…`、
`href:<path>`、`xpath=<expr>`、`<css> >> nth=N`、`:has-text/:text-is`。

错误码沿用 ego lite 命名（`EGO_TASK_SPACE_USER_IN_CONTROL`、`EGO_CDP_SEND_FAILED`…），
自有扩展用 `ARAGON_` 前缀。

---

## 与 ego lite 的差距（现状，不是待办）

- **没有内核级快照定制**：受限于 Chromium 暴露的 AX 树，质量上限低于 ego lite。
- **没有多 Space 单窗口切换**：每个 Space 是独立 `BrowserWindow`。并行是真的
  （各有进程、各有 partition），但没有一个窗口里切换 Space 的 UI。
- **没有 Downloads / 扩展 / 书签 / PDF**。
- **没有代码签名与自动更新**：安装包会被 SmartScreen 拦一次。
- **Linux 未验证**。
- 页面仍可用自己的 DOM 原型干扰 locator 求值（我们在同源世界执行）。ego 用
  isolated world 规避，这里没做，README 不掩饰这一点。
- 安装包体积来自 Electron 本身（Chromium + Node），这是选这条路线的固定成本。

## 已知限制（行为上的）

- `about:blank` 快照为空，此时应直接 `goto`。
- SPA 内部路由不改 `loaderId`，ref 不会失效——这是对的，但若 DOM 整体重建而文档未变，
  ref 可能指向新内容，此时重新快照。
- 对话框默认 `dismiss`；需要 `confirm()` 返回 true 的场景要显式
  `setDialogPolicy('accept')` 或 `answerDialog({accept:true})`。
- **点击后要导航的话必须用 `waitForNavigation`**，不是 `waitForLoad`：旧文档已经是
  `complete`，`waitForLoad` 会立刻返回，你读到的是刚要离开的那个页面。
- `taskSpace(name)` **会切换全局选中空间**，后面的裸 helper（`snapshot`、`listTabs`、
  `runSiteTool`）会跟着变。多空间脚本里要么用完切回来，要么一直用 `space.xxx` 形式。
- 未做：isolated world（locator 求值仍在同源世界）、Downloads、扩展、书签、PDF、
  代码签名、自动更新、多 Space 单窗口切换、Linux 验证。
