# `export async function main()` 启动流程分析

**文件位置**：`src/main.tsx:585`

这是 Claude Code **完整交互式 TUI 模式**的入口函数。`cli.tsx` 处理完快速路径后，最终走到这里启动完整的 REPL。

---

## 整体启动流程

```
main()
├── 安全初始化
│   ├── Windows PATH 安全防护
│   └── 警告处理器初始化
├── 特殊命令预处理
│   ├── cc:// / cc+unix:// 深度链接处理
│   ├── --handle-uri 深度链接处理 (LODESTONE 特性)
│   ├── assistant 会话预处理 (KAIROS 特性)
│   └── ssh 远程连接预处理 (SSH_REMOTE 特性)
├── 模式判断
│   ├── 检测 -p/--print / --init-only / --sdk-url
│   ├── 判断是否交互式会话 (isInteractive = stdout.isTTY)
│   ├── 设置客户端类型 (cli/github-action/claude-vscode/remote 等)
│   └── 提前加载设置
└── → 调用 run() → 启动 Commander.js → 处理命令
```

---

## 逐阶段详细分析

### 第一阶段：最早期安全初始化

```typescript
export async function main() {
  profileCheckpoint('main_function_start');

  // SECURITY: Prevent Windows from executing commands from current directory
  // This must be set before ANY command execution to prevent PATH hijacking attacks
  process.env.NoDefaultCurrentDirectoryInExePath = '1';

  // Initialize warning handler early to catch warnings
  initializeWarningHandler();
  process.on('exit', () => {
    resetCursor();
  });
  process.on('SIGINT', () => {
    // print 模式有自己的 SIGINT 处理，跳过这里
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return;
    }
    process.exit(0);
  });
```

**关键点**：

1. **Windows 安全防护**：
   - `NoDefaultCurrentDirectoryInExePath = '1'`
   - 防止 Windows 在当前目录搜索 `.exe` 导致 PATH 劫持攻击
   - **必须在任何命令执行前设置**，安全第一

2. **退出重置光标**：
   - 程序退出时重置终端光标
   - 防止程序异常退出后终端光标隐藏

3. **SIGINT 处理**：
   - Ctrl+C 直接退出
   - print 模式例外，因为它自己处理更优雅的中断

---

### 第二阶段：特殊命令预处理

在进入 Commander.js 之前，**提前改写 argv**，把特殊命令处理掉。

#### 1. `cc://` / `cc+unix://` 深度链接处理 (DIRECT_CONNECT 特性)

```typescript
if (feature('DIRECT_CONNECT')) {
  const ccIdx = rawCliArgs.findIndex(a => a.startsWith('cc://') || a.startsWith('cc+unix://'));
  if (ccIdx !== -1 && _pendingConnect) {
    // 解析 URL
    const { parseConnectUrl } = await import('./server/parseConnectUrl.js');
    const parsed = parseConnectUrl(ccUrl);

    // 保存到 _pendingConnect，后面 REPL 会读取
    _pendingConnect.dangerouslySkipPermissions = ...;
    if (headless) {
      // 无头模式：改写成 `open` 子命令
      process.argv = [process.argv[0]!, process.argv[1]!, 'open', ccUrl, ...stripped];
    } else {
      // 交互式：保存连接信息，去掉 URL 后走主命令
      _pendingConnect.url = parsed.serverUrl;
      _pendingConnect.authToken = parsed.authToken;
      process.argv = [process.argv[0]!, process.argv[1]!, ...stripped];
    }
  }
}
```

**作用**：让操作系统点击 `cc://server-url` 链接能打开 Claude Code 并自动连接远程服务器。

---

#### 2. `--handle-uri` 深度链接处理 (LODESTONE 特性)

```typescript
if (feature('LODESTONE')) {
  const handleUriIdx = process.argv.indexOf('--handle-uri');
  if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
    const { enableConfigs } = await import('./utils/config.js');
    enableConfigs();
    const uri = process.argv[handleUriIdx + 1]!;
    const { handleDeepLinkUri } = await import('./utils/deepLink/protocolHandler.js');
    const exitCode = await handleDeepLinkUri(uri);
    process.exit(exitCode); // 处理完直接退出，不进主程序
  }

  // macOS 特殊处理：URL 通过 Apple Event 而来
  if (process.platform === 'darwin' &&
      process.env.__CFBundleIdentifier === 'com.anthropic.claude-code-url-handler') {
    const { enableConfigs } = await import('./utils/config.js');
    enableConfigs();
    const { handleUrlSchemeLaunch } =
      await import('./utils/deepLink/protocolHandler.js');
    const urlSchemeResult = await handleUrlSchemeLaunch();
    process.exit(urlSchemeResult ?? 1);
  }
}
```

**设计原因**：
- 深度链接是操作系统调用，只需要处理 URI 然后打开终端
- 不需要加载完整 TUI，处理完直接退出，更快

---

#### 3. `assistant [sessionId]` 预处理 (KAIROS 多代理特性)

```typescript
if (feature('KAIROS') && _pendingAssistantChat) {
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === 'assistant') {
    const nextArg = rawArgs[1];
    if (nextArg && !nextArg.startsWith('-')) {
      // 有 sessionId → 保存并从 argv 去掉
      _pendingAssistantChat.sessionId = nextArg;
      rawArgs.splice(0, 2);
      process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
    }
  }
}
```

**作用**：
- `claude assistant <session-id>` 启动子助理会话
- 提前把 session-id 存到 `_pendingAssistantChat`
- 改写 argv 让主命令正常处理，后面 REPL 会读取

---

#### 4. `claude ssh <host> [dir]` 预处理 (SSH_REMOTE 特性)

```typescript
if (feature('SSH_REMOTE') && _pendingSSH) {
  if (rawCliArgs[0] === 'ssh') {
    // 提取各种标志：--local, --dangerously-skip-permissions, --permission-mode
    // 提取 host 和可选的 cwd
    // 检查无头模式不支持 SSH
    // 改写 argv，去掉 `ssh`，让主命令处理

    _pendingSSH.host = ...;
    process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
  }
}
```

**支持的参数**：
- `claude ssh host` → 连接远程主机
- `claude ssh host /path/to/cwd` → 指定工作目录
- `--local` → 本地模式
- `--permission-mode <mode>` → 权限模式
- `--continue` / `--resume` / `--model` → 这些参数透传给远程

**为什么预处理要提前做**：
- SSH 是特殊场景，需要在进入 REPL 前保存连接信息
- 改写 argv 后，主命令路径不需要修改，复用完整交互逻辑

---

### 第三阶段：模式判断

```typescript
// Check for -p/--print and --init-only flags early
const cliArgs = process.argv.slice(2);
const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print');
const hasInitOnlyFlag = cliArgs.includes('--init-only');
const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'));
const isNonInteractive = hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY;

// Stop capturing early input for non-interactive modes
if (isNonInteractive) {
  stopCapturingEarlyInput();
}

// Set global flags
const isInteractive = !isNonInteractive;
setIsInteractive(isInteractive);
initializeEntrypoint(isNonInteractive);
```

**什么是 "早期输入捕获"**：
- 程序启动需要时间，用户在启动过程敲的键盘会丢
- `earlyInput.ts` 在程序一开始就启动捕获
- 非交互式不需要，所以停止捕获

**判断非交互式的条件**：
| 条件 | 说明 |
|------|------|
| `-p`/`--print` | 打印模式，直接输出不交互 |
| `--init-only` | 只运行初始化钩子然后退出 |
| `--sdk-url` | SDK 模式 |
| `!process.stdout.isTTY` | 输出不是终端 → 被管道了 |

---

### 第四阶段：客户端类型识别

```typescript
// Determine client type
const clientType = (() => {
  if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return 'github-action';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-py') return 'sdk-python';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 'sdk-cli';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode') return 'claude-vscode';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return 'local-agent';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') return 'claude-desktop';
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'remote' || hasSessionIngressToken) {
    return 'remote';
  }
  return 'cli';
})();
setClientType(clientType);
```

**作用**：
- 不同入口点设置不同客户端类型
- 用于数据分析和功能开关
- 环境变量设置优先级高于默认推断

**各种客户端类型**：
| 类型 | 场景 |
|------|------|
| `cli` | 本地 CLI 交互式 |
| `github-action` | GitHub Actions 中运行 |
| `claude-vscode` | VS Code 扩展中运行 |
| `claude-desktop` | Claude Desktop 中运行 |
| `remote` | 远程会话入口 |
| `sdk-*` | SDK 嵌入使用 |

---

### 第五阶段：设置问题预览格式

```typescript
const previewFormat = process.env.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT;
if (previewFormat === 'markdown' || previewFormat === 'html') {
  setQuestionPreviewFormat(previewFormat);
} else if (!clientType.startsWith('sdk-') &&
  clientType !== 'claude-desktop' && clientType !== 'local-agent' && clientType !== 'remote') {
  setQuestionPreviewFormat('markdown');
}
```

**默认规则**：不是 SDK/desktop/remote → 默认 markdown 格式。

---

### 第六阶段：加载设置，进入 `run()`

```typescript
// Tag sessions created via `claude remote-control`
if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND === 'bridge') {
  setSessionSource('remote-control');
}
profileCheckpoint('main_client_type_determined');

// Parse and load settings flags early, before init()
eagerLoadSettings();
profileCheckpoint('main_before_run');
await run();
profileCheckpoint('main_after_run');
}
```

- `eagerLoadSettings()`：提前加载设置中的功能标志
- `profileCheckpoint`：每个阶段打一个时间点，用于启动性能分析
- 最后调用 `run()` 进入 Commander.js 命令处理

---

## `run()` 函数做了什么

`run()` 在 `main:884`，创建 Commander.js 程序：

### 1. Commander.js 初始化

```typescript
function createSortedHelpConfig() {
  // 帮助选项按字母排序，用户好找
  const getOptionSortKey = ...
  return { sortSubcommands: true, sortOptions: true, compareOptions: ... }
}
const program = new CommanderCommand()
  .configureHelp(createSortedHelpConfig())
  .enablePositionalOptions();
```

### 2. `preAction` 钩子：只有真正执行命令才初始化

```typescript
program.hook('preAction', async thisCommand => {
  await Promise.all([ensureMdmSettingsLoaded(), ensureKeychainPrefetchCompleted()]);
  await init();                          // 全局初始化

  if (!isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE)) {
    process.title = 'claude';            // 设置终端标签
  }

  initSinks();                           // 初始化日志 sink
  setInlinePlugins(pluginDir);          // 处理 --plugin-dir
  runMigrations();                       // 运行数据库迁移
  void loadRemoteManagedSettings();      // 异步加载远程托管设置（失败开放）
  void loadPolicyLimits();
  void uploadUserSettingsInBackground(); // 异步同步设置
});
```

**设计亮点**：
- **延迟初始化**：`preAction` 只在执行命令时运行，显示帮助不会运行
- 帮助命令不需要初始化各种东西，更快

### 3. 定义所有命令行选项

`program.option(...)` 定义了大概 50+ 个选项：

| 类别 | 选项 |
|------|------|
| **基础** | `--debug`, `--verbose`, `-p/--print`, `--bare` |
| **输出** | `--output-format`, `--json-schema`, `--input-format` |
| **模型** | `--model`, `--effort`, `--fallback-model`, `--thinking` |
| **会话** | `-c/--continue`, `-r/--resume`, `--fork-session`, `--no-session-persistence` |
| **权限** | `--dangerously-skip-permissions`, `--permission-mode` |
| **系统提示** | `--system-prompt`, `--system-prompt-file`, `--append-system-prompt` |
| **工具** | `--allowed-tools`, `--disallowedTools` |
| **MCP** | `--mcp-config`, `--strict-mcp-config` |
| **插件** | `--plugin-dir` |
| **代理** | `--agent`, `--agents` |

完整选项列表看代码，覆盖了所有使用场景。

### 4. 默认 action：启动交互式 REPL

最后 `program.action(async (prompt, options) => { ... })` 处理默认情况（用户直接打 `claude` 或者 `claude "prompt"`），这里：

- 处理 `--bare` 最小模式
- 检查单字词提示统计
- 设置助理模式（KAIROS）
- 处理标准输入提示（管道输入）
- 调用 `setup()` 初始化 React/Ink
- 渲染 `<App />` 进入交互式 TUI

---

## 设计亮点总结

### 1. **提前处理特殊路径**

深度链接、ssh、assistant 这些特殊场景**在进入 Commander 之前提前处理，改写 argv**，这样主流程不需要修改，复用现有代码。

### 2. **安全第一**

Windows PATH 劫持防护**第一行代码就设置**，必须在任何命令执行之前。

### 3. **性能分析内置**

每个关键阶段都有 `profileCheckpoint`，可以精确测量启动各阶段耗时，方便优化。

```
profileCheckpoint('main_function_start');
profileCheckpoint('main_warning_handler_initialized');
profileCheckpoint('main_client_type_determined');
profileCheckpoint('main_before_run');
...
```

### 4. **失败开放**

异步加载远程设置，加载失败不影响启动，继续用本地设置。

```typescript
// Load remote managed settings for enterprise customers (non-blocking)
// Fails open - if fetch fails, continues without remote settings
void loadRemoteManagedSettings();
```

### 5. **延迟初始化**

利用 Commander `preAction` 钩子，只有真正执行命令才初始化，帮助命令跳过，更快。

### 6. **干净的分层**

| 层次 | 职责 |
|------|------|
| `cli.tsx` | 快速路径：特殊 MCP 命令提前处理，不进 main |
| `main() → main.tsx` | 预处理特殊命令（深度链接/ssh/assistant），判断模式 |
| `run()` | 创建 Commander，定义选项，注册 preAction 初始化 |
| `preAction` | 真正执行命令才 `init()` 全局初始化 |
| 默认 action | 启动 React/Ink TUI，进入交互循环 |

---

## 流程图

```
┌─────────────────────────────────────────────────────────────┐
│  node src/main.tsx                                           │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  1. 安全初始化                                               │
│  - Windows NoDefaultCurrentDirectoryInExePath = 1           │
│  - 警告处理器 / 退出钩子 / SIGINT                            │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. 特殊命令预处理                                           │
│  - cc:// 深度链接                                           │
│  - --handle-uri 深度链接 → 处理完直接退出                    │
│  - assistant [sessionId] → 保存后改写 argv                   │
│  - ssh <host> → 提取参数保存，改写 argv                      │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. 判断交互式 / 非交互式                                     │
│  - 检测 -p/--print / --init-only                             │
│  - isTTY 检查 → 管道非交互式                                 │
│  - 设置全局 isInteractive / clientType                       │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  4. eagerLoadSettings() → await run()                       │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  5. run() 创建 Commander.js                                 │
│  - 帮助选项按字母排序                                        │
│  - preAction 钩子：执行命令才 init()                         │
│  - 定义 50+ 命令行选项                                       │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  6. 用户输入命令 → preAction                                 │
│  - await init() 全局初始化                                   │
│  - 运行迁移 → 加载远程设置 → 同步设置                        │
└──────────┬──────────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────────┐
│  7. 默认 action → 启动 React/Ink <App />                    │
│  ──────────────────────────────────────────────────────────  │
│  │ 进入交互式 REPL 循环，等待用户输入                          │
│  └──────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
```

---

## 对比快速路径（cli.tsx）

| 对比项 | `cli.tsx` 快速路径 | `main.tsx` `main()` |
|--------|-------------------|---------------------|
| **场景** | 特殊独立 MCP 服务器 | 完整交互式 TUI |
| **加载** | 动态导入，不加载 TUI | 加载全部，启动 React/Ink |
| **退出** | 执行完直接返回 | 进入事件循环，直到用户退出 |
| **例子** | `--claude-in-chrome-mcp`, `--computer-use-mcp` | 直接 `claude` 或 `claude -p "..."` |

---

## 总结

`main()` 是 Claude Code 完整交互模式的**总入口**，它的设计非常清晰：

1. **安全先行**：最开始就设置安全选项
2. **特殊路径提前分流**：深度链接、ssh、assistant 提前处理，不影响主流程
3. **模式判断准确**：正确识别交互式/非交互式，各种客户端类型
4. **延迟初始化**：利用 Commander 钩子，只在需要时初始化
5. **性能可观测**：每个阶段打 checkpoint，方便优化
6. **分层清晰**：预处理 → 模式判断 → 命令定义 → 初始化 → 启动 UI

这体现了大型 CLI 程序的最佳实践：**越早分流，越少浪费**。
