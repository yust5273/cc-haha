# `--print`/`-p` 打印模式完整调用链路

本文梳理从命令行启动到退出，`--print` 模式的完整执行流程。

---

## 完整链路图谱

```
./bin/claude-haha -p "your prompt"
    ↓
cli.tsx (快速路径检测)
    ↓ 不是 MCP 特殊命令，进入 main.tsx main()
main.tsx main()
    ↓ 检测到 hasPrintFlag = true → isNonInteractive = true
run() → Commander.js 定义选项
    ↓ preAction hook → 全局初始化
init() → 全局初始化（配置、数据库、MCP 连接等）
    ↓
默认 action (用户输入处理)
    ↓ 判断 if (options.print) → 进入无头打印模式
    ↓
动态导入 src/cli/print.ts → { runHeadless }
    ↓
调用 runHeadless() → 执行无头打印
    ↓
处理完成 → process.exit() 退出
```

---

## 逐阶段详细分析

### 阶段 1：启动 - cli.tsx 快速路径检测

```
./bin/claude-haha -p "explain this code"
```

`cli.tsx` 先处理快速路径：
- 检测 `--claude-in-chrome-mcp` / `--chrome-native-host` / `--computer-use-mcp`
- `-p` 不命中快速路径 → 进入 `main.tsx` 的 `main()`

---

### 阶段 2：main() 预处理 - 检测 print 标志

```typescript
// src/main.tsx:797-803
const cliArgs = process.argv.slice(2);
const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print');
const hasInitOnlyFlag = cliArgs.includes('--init-only');
const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'));
const isNonInteractive = hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY;
```

- `hasPrintFlag = true` → `isNonInteractive = true`
- 停止捕获早期输入 (`stopCapturingEarlyInput()`)
- 设置全局 `isInteractive = false`

---

### 阶段 3：run() - Commander.js 初始化

```typescript
// src/main.tsx:1090
program.name('claude')
  .description('Claude Code - starts an interactive session by default, use -p/--print for non-interactive output')
  .option('-p, --print', 'Print response and exit (useful for pipes). Note: The workspace trust dialog is skipped when Claude is run with the -p mode. Only use this flag in directories you trust.', () => true);
  // ... 其他选项
```

Commander 定义了 `-p/--print` 选项，参数解析后，在默认 action 中会拿到 `options.print = true`。

---

### 阶段 4：preAction hook - 全局初始化

不管交互式还是 print，`preAction` 都会执行：

```typescript
program.hook('preAction', async thisCommand => {
  await Promise.all([ensureMdmSettingsLoaded(), ensureKeychainPrefetchCompleted()]);
  await init(); // ← 全局初始化
  // ... 插件目录处理，迁移，异步加载远程设置
});
```

`init()` 做全局初始化：加载配置、初始化数据库、连接 MCP 服务器、加载插件等。**print 模式也需要这些**。

---

### 阶段 5：默认 action - 判断 print 模式，调用 runHeadless

在 `main.tsx` 默认 action 末尾（大约 2950 行）：

```typescript
if (options.print) {
  // --print 模式，进入无头打印，调用 print.ts 的 runHeadless
  // ... 一堆参数处理
  const {
    runHeadless
  } = await import('src/cli/print.js'); // ← 动态导入，只有 print 模式才加载

  // 调用 runHeadless，传入所有参数
  void runHeadless(
    inputPrompt, // ← 用户提示词，从 stdin + 参数拼出来
    () => headlessStore.getState(),
    headlessStore.setState,
    commandsHeadless,
    tools,
    sdkMcpConfigs,
    agentDefinitions.activeAgents,
    {
      continue: options.continue,
      resume: options.resume,
      verbose: verbose,
      outputFormat: outputFormat, // text/json/stream-json
      jsonSchema,
      // ... 一堆其他选项
    }
  );
  return;
}

// 不是 print 模式 ↓ 才进入交互式 React/Ink
setup();
render(<App ... />);
```

**关键点**：
- **动态导入**：只有真的进入 print 模式才 `await import('src/cli/print.js')`，不占用交互式模式启动体积
- **信任跳过**：注释说 "workspace trust dialog is skipped" → `-p` 模式跳过工作区信任对话框，因为脚本/管道调用需要非交互式

---

### 阶段 6：src/cli/print.ts `runHeadless()` - 核心执行

`runHeadless` 做这些事情：

#### 6.1 环境准备
- 注册 `process.stdout` 错误处理器
- 安装 SIGHUP/SIGINT/SIGTERM 信号处理器（这里就是为什么 `main.ts` 全局 SIGINT 要跳过 → 让 `print.ts` 自己处理）
- 处理 `--output-format=stream-json` 标准输出 guard

#### 6.2 读取提示词
```typescript
// 获取最终提示词
const prompt = await getInputPrompt(rawPrompt, inputFormat);
```
- 如果 `stdin` 不是 TTY，读取 stdin 拼接到提示词
- 支持 `--input-format stream-json` 流式读取

#### 6.3 组装工具列表
- 根据 `--allowedTools` / `--disallowedTools` 过滤工具
- 合并内置工具 + MCP 工具

#### 6.4 循环处理（agentic 多轮）
```typescript
for (let turn = 0; turn < maxTurns; turn++) {
  // 调用 Anthropic API
  // 处理工具调用
  // 执行工具
  // 继续下一轮
}
```
- 如果设置了 `--max-turns`，到轮次限制退出
- 默认可以多轮工具调用，和交互式一样

#### 6.5 输出结果
根据 `--output-format` 输出：
- **text**（默认）：输出纯文本回答到 stdout
- **json**：输出单次 JSON 结果
- **stream-json**：流式输出 JSON 事件

#### 6.6 退出
处理完成，`gracefulShutdown(0)` 优雅退出。

---

### 阶段 7：SIGINT 处理 - 为什么 `main.ts` 要跳过

这个就是我们之前讨论的：

```typescript
// src/main.tsx 全局 SIGINT
process.on('SIGINT', () => {
  // In print mode, print.ts registers its own SIGINT handler that aborts
  // the in-flight query and calls gracefulShutdown; skip here to avoid
  // preempting it with a synchronous process.exit().
  if (process.argv.includes('-p') || process.argv.includes('--print')) {
    return; // ← 跳过！
  }
  process.exit(0);
});
```

然后 `print.ts` 自己注册 SIGINT：

```typescript
// src/cli/print.ts 内部 SIGINT 处理
let interrupted = false;
const onSigint = () => {
  interrupted = true;
  abortController.abort(); // ← 中止正在进行的 API 请求
};
process.on('SIGINT', onSigint);
```

**为什么要这样设计**：
1. Node.js 事件监听器**按注册顺序执行**，`main.ts` 先注册
2. 如果 `main.ts` 不跳过，直接 `process.exit(0)` → `print.ts` 的处理器**没机会执行**
3. 结果：API 请求不能被正确中止，清理代码不运行 → 资源泄漏
4. 所以 `main.ts` 检测到 `-p` 就 return，让 `print.ts` 自己处理

---

## 支持的 `--print` 相关选项

| 选项 | 作用 |
|------|------|
| `-p "prompt"` / `--print "prompt"` | 无头打印，提示词就是参数 |
| `--output-format <text/json/stream-json>` | 输出格式 |
| `--input-format <text/stream-json>` | 输入格式 |
| `--max-turns <N>` | 最大 agent 轮数，到轮数就退出 |
| `--max-budget-usd <amount>` | 最大美元花费 |
| `--json-schema <schema>` | JSON Schema 结构化输出校验 |
| `--include-partial-messages` | 流输出包含部分消息 |
| `--include-hook-events` | 流输出包含 hook 生命周期事件 |
| `--dangerously-skip-permissions` | 跳过所有权限检查 |

---

## 常见使用示例

### 1. 基本查询
```bash
claude -p "What is the sum of 1+1?"
```
输出直接打在 stdout，打完退出。

### 2. 管道用法 - 解释错误日志
```bash
cat error.log | claude -p "帮我分析这个错误，给出解决方案" | less
```

### 3. 脚本获取结果
```bash
# shell 脚本
answer=$(claude -p "总结这个文件 $(cat package.json)")
echo "$answer"
```

### 4. JSON 输出给其他程序解析
```bash
claude -p "提取这个JSON" --output-format json
```

---

## 对比：--print 模式 vs 默认交互式模式

| 对比项 | `--print`/-p 模式 | 默认交互式模式 |
|--------|------------------|----------------|
| **UI** | 无 UI，纯文本输出 | React + Ink 全屏 TUI |
| **对话** | 单轮/多轮执行完退出 | 多轮交互，一直运行直到用户退出 |
| **工作区信任** | 跳过信任对话框 | 会提示信任 |
| **启动速度** | 快（只加载需要的代码，完了就退） | 慢（加载 React/Ink，启动 UI） |
| **使用场景** | 脚本、管道、自动化 | 开发时多轮迭代 |
| **SIGINT 处理** | print.ts 自己处理，能中止 API | main.ts 直接退出 |

---

## 总结链路图

```
 命令行
   ↓
 cli.tsx → 快速路径不命中 → main.tsx main()
   ↓
 检测 isNonInteractive = true (因为 -p)
   ↓
 Commander preAction → init() 全局初始化
   ↓
 默认 action → options.print = true → 动态导入 print.ts
   ↓
 runHeadless() → 处理提示词 → 循环 API/工具调用 → 输出结果
   ↓
 优雅退出 → process.exit(0)
```

整个链路设计特点：
- **按需加载**：只有进入 print 模式才加载 print.ts 代码
- **正确信号处理**：让 print 自己处理 SIGINT，能正确中止 API 请求
- **跳过信任检查**：非交互式没法弹窗，所以跳过，用户得自己信任目录
- **支持管道**：完美配合 shell 编程，可以和任意其他命令组合使用
