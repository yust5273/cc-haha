// 从 Bun 的模块中导入 feature 函数
// bun:bundle 是 Bun 特有的模块，提供**构建时特性开关**功能
// feature() 用于判断某个功能是否开启，不开启的代码会在**构建时被删除**（这个技术叫 DCE - Dead Code Elimination 死代码消除）
import { feature } from 'bun:bundle';

// ============================================================================
// 【设计思想】为什么这些环境变量设置要放在文件最顶层，而不是放到 main() 函数里？
//
// 核心问题：**模块在导入的时候，就会读取环境变量，保存为 const 常量**
// 如果设置晚了，常量已经算出结果了，再改环境变量也没用！
//
// 错误示范 ❌ （设置晚了）：
// ```javascript
// // 先导入模块
// import { someFunction } from './some-module.js';
// // 再设置环境变量 → 太晚了！模块已经导入完了
// process.env.CLAUDE_CODE_SIMPLE = '1';
// ```
//
// 正确示范 ✅ （尽早设置）：
// ```javascript
// // 先设置环境变量
// process.env.CLAUDE_CODE_SIMPLE = '1';
// 再导入模块 → 模块导入时就能读到正确的值了
// import { someFunction } from './some-module.js';
// ```
//
// 所以规则：
// 1. 如果环境变量会影响**模块导入时**的行为（比如模块顶层会读它存成常量），必须尽早设置
// 2. 必须在导入那些会读取它的模块之前，就设置好
// 3. 所以这里把所有影响导入的环境变量设置，都放在文件最顶层
// ============================================================================

// Bug 修复：针对 corepack（Node.js 官方的包管理器自动管理工具）的问题
// corepack 会自动在 package.json 中添加 yarnpkg 相关配置，某些情况下会导致问题
// 通过设置环境变量 COREPACK_ENABLE_AUTO_PIN=0 来禁用自动固定包版本
// 这是**顶层副作用**（模块加载时就执行），所以需要禁用 ESLint 规则
// eslint-disable-next-line custom-rules/no-top-level-side-effects
process.env.COREPACK_ENABLE_AUTO_PIN = '0';

// 为 CCR 环境（Claude Code Remote，云端容器运行环境）设置 Node.js 最大堆内存
// CCR 容器有 16GB 可用内存，所以设置 V8 堆的最大上限为 8192MB（即 8GB）
// 同样：为什么放这里？因为 NODE_OPTIONS 影响子进程，必须尽早设置
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level, custom-rules/safe-env-boolean-check
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  // 获取已有的 NODE_OPTIONS 环境变量，如果没有就是空字符串
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  const existing = process.env.NODE_OPTIONS || '';
  // 将 --max-old-space-size=8192 添加到 NODE_OPTIONS 中
  // --max-old-space-size 是 V8/Node.js 的启动参数，设置老生代堆的最大大小，单位是 MB
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  process.env.NODE_OPTIONS = existing ? `${existing} --max-old-space-size=8192` : '--max-old-space-size=8192';
}

// 实验性**基线对比（Ablation Baseline）**的设置：关闭各种功能得到最简版本，用于性能/效果对比实验
// 【为什么要放在这里，而不是放到 init.ts 里面？】
// 因为 BashTool/AgentTool/PowerShellTool 这些工具，会在**模块导入的时候**就读取
// DISABLE_BACKGROUND_TASKS 等环境变量，并保存为**模块级常量**。如果放到 init() 里，
// init() 运行太晚了，环境变量已经被读取完了，设置了也不生效。
//
// 【什么是 `feature()` + 构建时死代码消除？】
// - `feature('FEATURE_NAME')` 是 Bun 提供的**构建时特性开关**
// - 如果这个特性关闭，整个 `if` 代码块会在**构建打包的时候就被完全删掉**
// - 最终产物里不会有这段代码，不占体积，不影响启动速度，这个技术叫「死代码消除（DCE - Dead Code Elimination）」
// - 如果不用构建时死代码消除，就算特性关闭，代码也还在产物里，只是运行时不走分支，还是占体积
//
// 所以：不开启的功能，代码直接消失，所以不增加体积。
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
if (feature('ABLATION_BASELINE') && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
  // 遍历这些环境变量，如果它们没有设置，就默认设为 '1'（开启关闭）
  // 这些变量用来关闭各种高级功能，得到一个最简基线版本，用于科学实验对比
  for (const k of ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_DISABLE_THINKING', 'DISABLE_INTERLEAVED_THINKING', 'DISABLE_COMPACT', 'DISABLE_AUTO_COMPACT', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS']) {
    // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
    // ??= 是 Nullish 合并赋值运算符：只有当 k 不存在或为 null/undefined 时，才赋值 '1'
    // 如果用户已经手动设置了，尊重用户的设置
    process.env[k] ??= '1';
  }
}

/**
 * ============================================================================
 * 【整体设计思想】Bootstrap 入口点 - 做「快速路径预处理」
 *
 * 核心设计原则：**尽早处理特殊情况，不加载无用代码，让常见路径更快**
 *
 * 什么是「快速路径分流」？
 * ---------------------
 * 不是说「快速路径一定是执行完就退出」，而是：
 * > 在进入完整交互式 TUI 之前，先判断是不是特殊情况，如果是特殊情况
 * > 就在这里处理，**不加载完整 TUI 代码**，节省时间
 *
 * 快速路径有几种情况：
 *  1. 一次性命令（执行完就退出）：`--version`、`ps`、`logs`、`kill`
 *  2. 启动独立后台服务（长期运行，但不需要 TUI）：`daemon`、`remote-control`、`--computer-use-mcp`
 *  3. 直接 exec 替换进程（原进程结束，不会继续往下走）：`--worktree --tmux`
 *
 * 为什么要这么设计？
 * -----------------
 * 1. 完整的 `main.tsx` 有 8000 行代码，加载解析都需要时间
 * 2. 如果每次都要加载整个 main.tsx 才判断命令类型，简单命令启动也会很慢
 * 3. 所以这里做「前置分流」：特殊命令在这里就处理完，不加载完整 CLI
 * 4. 只有正常交互式使用才需要加载完整 TUI
 *
 * 为什么所有导入都是 `await import()` 动态导入？
 * -------------------------------------------
 * 什么是「静态导入」：
 *  ```javascript
 *  // ❌ 写在文件顶层，不管用不用，启动的时候全部都加载了
 *  import { runDaemonWorker } from '../daemon/workerRegistry.js';
 *  import { bridgeMain } from '../bridge/bridgeMain.js';
 *  ```
 * 什么是「按需动态导入」：
 *  ```javascript
 *  // ✅ 只有真走到这个分支，才会加载模块，不进分支永远不加载
 *  if (args[0] === '--daemon-worker') {
 *    const { runDaemonWorker } = await import('../daemon/workerRegistry.js');
 *    await runDaemonWorker(args[1]);
 *  }
 *  ```
 *
 * 为什么在这里用动态导入：
 *  - 这个文件有 20+ 个分支，但用户一次只能走一个分支
 *  - 按需加载：只用哪个分支，就只加载哪个分支需要的模块
 *  - 不用的分支，模块躺在硬盘上，根本不会读，节省时间
 *  - 比如用户只运行 `claude --version`，只需要本文件，不需要加载任何其他模块
 *  - 这样「快速路径」真的很快，零额外依赖，毫秒级响应
 *  - 如果用静态导入，不管走不走这个分支，所有模块都要加载，浪费时间
 *
 * fast-path for --version：真·零模块加载，只在本文件完成
 *  - MACRO.VERSION 是**构建时内联**进去的，所以不需要任何导入就能输出
 * ============================================================================
 */

// 定义异步 main 函数，整个启动逻辑在这里
async function main(): Promise<void> {
  // process.argv 是 Node.js 进程收到的命令行参数数组：
  // - process.argv[0] = Node.js 可执行文件的绝对路径
  // - process.argv[1] = 当前正在执行的脚本文件（cli.tsx）的绝对路径
  // - 所以从索引 2 开始，才是用户真正传给程序的参数
  const args = process.argv.slice(2);
  console.log(`[cli] 进入 cli main 函数，参数: ${JSON.stringify(args)}`);

  // --------------------------------------------------------------------------
  // 快速路径 1：处理 --version/-v/-v：直接输出版本号然后退出
  // 【设计优化】这个路径不需要加载任何其他模块，**零导入**，非常快
  // 用户输入 `claude --version` 就能马上得到结果，不需要等半天加载整个应用
  // --------------------------------------------------------------------------
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    console.log('[cli] 快速路径 --version，输出版本号后退出');
    // MACRO.VERSION 是构建时（打包的时候）就被编译器内联成具体的版本号了
    // biome-ignore lint/suspicious/noConsole：这是故意输出到控制台，所以忽略规则
    console.log(`${MACRO.VERSION} (Claude Code)`);
    // 直接返回，main 函数结束，进程自然退出
    return;
  }

  // --------------------------------------------------------------------------
  // 走到这里说明不是 --version，需要加载启动性能分析工具
  // profileCheckpoint 用来记录每个阶段的开始时间，用于**分析启动瓶颈**
  // 产品开发中可以看每个阶段花了多少时间，针对性优化
  // --------------------------------------------------------------------------
  console.log('[cli] 加载启动性能分析工具');
  const {
    profileCheckpoint
  } = await import('../utils/startupProfiler.js');
  // 记录进入 cli 入口点这个时间点
  profileCheckpoint('cli_entry');
  console.log('[cli] 记录检查点: cli_entry');

  // --------------------------------------------------------------------------
  // 快速路径 2：--dump-system-prompt：输出生成好的系统提示词然后退出
  // 用途：Anthropic 内部做「提示词敏感性评估」实验，在特定 commit 提取当前系统提示词
  // 【设计】通过 feature 开关，外部构建根本不会包含这段代码
  // --------------------------------------------------------------------------
  if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') {
    console.log('[cli] 快速路径 --dump-system-prompt');
    profileCheckpoint('cli_dump_system_prompt_path');
    // 只动态加载需要的模块，不加载没用的
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      getMainLoopModel
    } = await import('../utils/model/model.js');
    // 支持用户指定 --model 参数，不同模型系统提示词可能不一样
    const modelIdx = args.indexOf('--model');
    const model = modelIdx !== -1 && args[modelIdx + 1] || getMainLoopModel();
    const {
      getSystemPrompt
    } = await import('../constants/prompts.js');
    const prompt = await getSystemPrompt([], model);
    // biome-ignore lint/suspicious/noConsole：故意输出
    console.log(prompt.join('\n'));
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 3：各种独立 MCP 服务器模式
  // MCP = Model Context Protocol，Anthropic 的工具服务协议
  // 这些都是独立的服务器进程，不需要完整 TUI，所以在这里快速启动
  // --------------------------------------------------------------------------

  // 启动 Claude in Chrome 的 MCP 服务器：Chrome 扩展和本地 Claude 通信
  if (process.argv[2] === '--claude-in-chrome-mcp') {
    console.log('[cli] 快速路径 --claude-in-chrome-mcp');
    profileCheckpoint('cli_claude_in_chrome_mcp_path');
    const {
      runClaudeInChromeMcpServer
    } = await import('../utils/claudeInChrome/mcpServer.js');
    await runClaudeInChromeMcpServer();
    return;
  }
  // 启动 Chrome 原生消息宿主：Chrome 扩展通过原生消息和本地程序通信
  else if (process.argv[2] === '--chrome-native-host') {
    console.log('[cli] 快速路径 --chrome-native-host');
    profileCheckpoint('cli_chrome_native_host_path');
    const {
      runChromeNativeHost
    } = await import('../utils/claudeInChrome/chromeNativeHost.js');
    await runChromeNativeHost();
    return;
  }
  // 启动 Computer Use（桌面控制）独立 MCP 服务器
  else if (process.argv[2] === '--computer-use-mcp') {
    console.log('[cli] 快速路径 --computer-use-mcp');
    profileCheckpoint('cli_computer_use_mcp_path');
    const {
      runComputerUseMcpServer
    } = await import('../utils/computerUse/mcpServer.js');
    await runComputerUseMcpServer();
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 4：--daemon-worker（内部用途，由 supervisor 生成工作进程）
  // 【设计注意点】
  // - 必须放在 daemon 子命令检查之前：因为每个 worker 是单独 spawn 出来的，对性能敏感
  // - 这里不做 enableConfigs()、不初始化分析日志：worker 要保持精简，越快越好
  // - 如果某个 worker 类型确实需要配置和认证，它自己会在 run() 里面调用
  // --------------------------------------------------------------------------
  if (feature('DAEMON') && args[0] === '--daemon-worker') {
    console.log('[cli] 快速路径 --daemon-worker');
    const {
      runDaemonWorker
    } = await import('../daemon/workerRegistry.js');
    // args[1] 就是 worker 类型参数，直接传进去
    await runDaemonWorker(args[1]);
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 5：claude remote-control 命令（远程控制本地机器）
  // 也兼容旧名称：remote / sync / bridge，兼容老用户习惯
  // 【设计】feature() 必须保持内联写在这里，这样构建时才能做死代码消除
  // 运行时还要通过 GrowthBook 检查开关是否开启
  // --------------------------------------------------------------------------
  if (feature('BRIDGE_MODE') && (args[0] === 'remote-control' || args[0] === 'rc' || args[0] === 'remote' || args[0] === 'sync' || args[0] === 'bridge')) {
    console.log('[cli] 快速路径 remote-control/bridge');
    profileCheckpoint('cli_bridge_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      getBridgeDisabledReason,
      checkBridgeMinVersion
    } = await import('../bridge/bridgeEnabled.js');
    const {
      BRIDGE_LOGIN_ERROR
    } = await import('../bridge/types.js');
    const {
      bridgeMain
    } = await import('../bridge/bridgeMain.js');
    const {
      exitWithError
    } = await import('../utils/process.js');

    // 【为什么认证检查必须放在 GrowthBook 开关检查之前？】
    // 因为：没有认证的话，GrowthBook（功能开关服务）没有用户上下文
    // 就会返回**过期的默认值 false**，而不是最新的开关状态
    // getBridgeDisabledReason() 需要等待 GrowthBook 初始化完成，所以返回的是最新结果
    // 但 GrowthBook 初始化本身需要认证头才能工作，所以必须先拿认证
    const {
      getClaudeAIOAuthTokens
    } = await import('../utils/auth.js');
    // 如果没有访问令牌，输出错误直接退出
    if (!getClaudeAIOAuthTokens()?.accessToken) {
      exitWithError(BRIDGE_LOGIN_ERROR);
    }
    // 检查桥接模式是否被管理员禁用，如果禁用输出错误退出
    const disabledReason = await getBridgeDisabledReason();
    if (disabledReason) {
      exitWithError(`Error: ${disabledReason}`);
    }
    // 检查是否满足最小版本要求，不满足就退出
    const versionError = checkBridgeMinVersion();
    if (versionError) {
      exitWithError(versionError);
    }

    // 桥接是远程控制功能，需要检查企业策略限制
    const {
      waitForPolicyLimitsToLoad,
      isPolicyAllowed
    } = await import('../services/policyLimits/index.js');
    // 等待策略限制信息加载完成
    await waitForPolicyLimitsToLoad();
    // 检查策略是否允许远程控制，不允许就退出
    if (!isPolicyAllowed('allow_remote_control')) {
      exitWithError("Error: Remote Control is disabled by your organization's policy.");
    }
    // 进入桥接模式主函数，参数去掉第一个子命令名称
    await bridgeMain(args.slice(1));
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 6：claude daemon [subcommand] - 启动长期运行的守护进程管理器
  // 守护进程管理后台任务和后台会话
  // --------------------------------------------------------------------------
  if (feature('DAEMON') && args[0] === 'daemon') {
    console.log('[cli] 快速路径 daemon');
    profileCheckpoint('cli_daemon_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      initSinks
    } = await import('../utils/sinks.js');
    // 初始化日志接收器（日志输出目的地）
    initSinks();
    const {
      daemonMain
    } = await import('../daemon/main.js');
    // 进入守护进程主函数
    await daemonMain(args.slice(1));
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 7：后台会话管理命令：ps / logs / attach / kill，以及 --bg / --background 标志
  // 管理 ~/.claude/sessions/ 目录下注册的后台会话
  // 【设计】这里就内联判断标志，这样只有真正用到这些功能才加载 bg.js 模块
  // 如果用户不是这些命令，bg.js 根本不会被加载，节省时间
  // --------------------------------------------------------------------------
  if (feature('BG_SESSIONS') && (args[0] === 'ps' || args[0] === 'logs' || args[0] === 'attach' || args[0] === 'kill' || args.includes('--bg') || args.includes('--background'))) {
    console.log(`[cli] 快速路径 bg 命令: ${args[0]}`);
    profileCheckpoint('cli_bg_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    // 只有走到这个分支才动态加载 bg.js
    const bg = await import('../cli/bg.js');
    // 根据子命令分发到不同处理函数
    switch (args[0]) {
      case 'ps':
        // 列出所有后台会话
        await bg.psHandler(args.slice(1));
        break;
      case 'logs':
        // 查看指定会话的日志
        await bg.logsHandler(args[1]);
        break;
      case 'attach':
        // 附加（attach）到正在运行的会话，进入交互模式
        await bg.attachHandler(args[1]);
        break;
      case 'kill':
        // 终止指定后台会话
        await bg.killHandler(args[1]);
        break;
      default:
        // 其他情况：参数里有 --bg 或 --background，处理后台标志
        await bg.handleBgFlag(args);
    }
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 8：模板 job 命令：new / list / reply
  // --------------------------------------------------------------------------
  if (feature('TEMPLATES') && (args[0] === 'new' || args[0] === 'list' || args[0] === 'reply')) {
    console.log(`[cli] 快速路径 templates 命令: ${args[0]}`);
    profileCheckpoint('cli_templates_path');
    const {
      templatesMain
    } = await import('../cli/handlers/templateJobs.js');
    await templatesMain(args);
    // 为什么这里用 process.exit(0) 而不是直接 return？
    // 因为 mountFleetView 的 Ink TUI 渲染会留下事件循环句柄
    // 这些句柄会阻止 Node.js 自然退出，程序卡着不结束
    // 所以直接调用 process.exit(0) 干净利落地退出
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0);
  }

  // --------------------------------------------------------------------------
  // 快速路径 9：claude environment-runner - 无头（headless）BYOC 运行器
  // BYOC = Bring Your Own Container，用户自带容器环境运行
  // feature() 必须内联，才能让构建时做死代码消除
  // --------------------------------------------------------------------------
  if (feature('BYOC_ENVIRONMENT_RUNNER') && args[0] === 'environment-runner') {
    console.log('[cli] 快速路径 environment-runner');
    profileCheckpoint('cli_environment_runner_path');
    const {
      environmentRunnerMain
    } = await import('../environment-runner/main.js');
    await environmentRunnerMain(args.slice(1));
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 10：claude self-hosted-runner - 自托管运行器
  // 对接 SelfHostedRunnerWorkerService API：注册 + 轮询，轮询就是保持心跳
  // --------------------------------------------------------------------------
  if (feature('SELF_HOSTED_RUNNER') && args[0] === 'self-hosted-runner') {
    console.log('[cli] 快速路径 self-hosted-runner');
    profileCheckpoint('cli_self_hosted_runner_path');
    const {
      selfHostedRunnerMain
    } = await import('../self-hosted-runner/main.js');
    await selfHostedRunnerMain(args.slice(1));
    return;
  }

  // --------------------------------------------------------------------------
  // 快速路径 11：--worktree + --tmux 组合：在加载完整 CLI 之前，先 exec 进入 tmux
  // Git worktree：Git 特性，可以同时检出多个分支到不同目录
  // Claude Code worktree 特性：在新的 Git worktree 中打开新会话
  // 结合 tmux：可以自动在新 tmux 窗口中打开 Claude Code 会话
  // 【设计】为什么要在这里提前处理？因为 exec 就要替换进程，不需要加载完整 CLI 了
  // --------------------------------------------------------------------------
  const hasTmuxFlag = args.includes('--tmux') || args.includes('--tmux=classic');
  // 检查参数里是否有 worktree 相关选项：-w / --worktree / --worktree=xxx
  if (hasTmuxFlag && (args.includes('-w') || args.includes('--worktree') || args.some(a => a.startsWith('--worktree=')))) {
    console.log('[cli] 快速路径 tmux + worktree');
    profileCheckpoint('cli_tmux_worktree_fast_path');
    const {
      enableConfigs
    } = await import('../utils/config.js');
    enableConfigs();
    const {
      isWorktreeModeEnabled
    } = await import('../utils/worktreeModeEnabled.js');
    // 如果 worktree 模式启用了，才处理
    if (isWorktreeModeEnabled()) {
      const {
        execIntoTmuxWorktree
      } = await import('../utils/worktree.js');
      // 尝试执行进入 tmux + worktree 的操作
      const result = await execIntoTmuxWorktree(args);
      // 如果已经处理成功，exec 会替换当前进程，原进程就结束了
      // 如果能走到这里返回说明没处理，继续往下走
      if (result.handled) {
        return;
      }
      // 如果没处理而且有错误信息，输出错误然后退出
      if (result.error) {
        const {
          exitWithError
        } = await import('../utils/process.js');
        exitWithError(result.error);
      }
      // 没错误就回落到正常 CLI
    }
    // 如果 worktree 模式没启用，也回落到正常 CLI
  }

  // --------------------------------------------------------------------------
  // 用户体验优化：自动纠正用户常见错误
  // 用户想更新的时候，习惯输入 `claude --update` 或 `claude --upgrade`（带两个横线）
  // 但实际上正确命令是 `claude update`（子命令，不带横线）
  // 我们识别出来用户意图，自动改成正确参数，用户不用重新输入，提升体验
  // --------------------------------------------------------------------------
  if (args.length === 1 && (args[0] === '--update' || args[0] === '--upgrade')) {
    console.log('[cli] 自动纠正参数: --update → update');
    // 直接修改 process.argv，把第三个参数改成 'update'
    // 后面的主 CLI 解析就会正确识别为 update 子命令
    process.argv = [process.argv[0]!, process.argv[1]!, 'update'];
  }

  // --------------------------------------------------------------------------
  // --bare 标志：开启极简模式 CLAUDE_CODE_SIMPLE
  // 【为什么要在这里提前设置，不能在 main.tsx 里设置？】
  // 因为很多功能开关在**模块导入的时候**就会读取这个环境变量
  // 如果加载完模块才设置，已经太晚了，开关已经判断完了，不生效
  // 所以必须在导入 main.tsx 之前就设置好，保证所有模块都能读到正确的值
  // --------------------------------------------------------------------------
  if (args.includes('--bare')) {
    console.log('[cli] 检测到 --bare 标志，开启极简模式 CLAUDE_CODE_SIMPLE=1');
    process.env.CLAUDE_CODE_SIMPLE = '1';
  }

  // --------------------------------------------------------------------------
  // 【走到这里说明】没有检测到任何特殊命令，是正常启动完整交互式 CLI
  // 现在可以加载并运行完整的 main.tsx 了
  // --------------------------------------------------------------------------
  console.log('[cli] 没有匹配到快速路径，准备启动完整交互式 CLI');

  // 提前开始捕获用户的早期输入
  // 为什么需要？因为加载完整 CLI 需要一点时间，用户可能已经在键盘输入了
  // 如果不提前捕获，这些输入会丢失
  console.log('[cli] 导入 earlyInput 模块，开始捕获早期输入');
  const {
    startCapturingEarlyInput
  } = await import('../utils/earlyInput.js');
  startCapturingEarlyInput();

  // 记录检查点：开始导入 main 模块之前
  profileCheckpoint('cli_before_main_import');
  console.log('[cli] 记录检查点: cli_before_main_import，开始导入 main.tsx');
  // 动态导入完整 CLI 主模块，它导出的 main 函数我们叫 cliMain
  const {
    main: cliMain
  } = await import('../main.js');
  // 记录检查点：导入完成
  profileCheckpoint('cli_after_main_import');
  console.log('[cli] main.tsx 导入完成，记录检查点: cli_after_main_import');
  // 调用完整 CLI 主函数，等待它执行完成
  console.log('[cli] 调用完整 CLI 主函数 cliMain()');
  await cliMain();
  // 记录检查点：主函数执行完成
  profileCheckpoint('cli_after_main_complete');
  console.log('[cli] cliMain 执行完成，记录检查点: cli_after_main_complete');
}

// 调用 main 函数开始执行整个流程
// void 表示我们不关心返回的 Promise，忽略它（TypeScript 需要这样写）
// 这是顶层副作用，所以禁用 ESLint 的规则
// eslint-disable-next-line custom-rules/no-top-level-side-effects
void main();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmZWF0dXJlIiwicHJvY2VzcyIsImVydiIsIkNPUkVQQUNLX0VOQUJMRV9BVVRPX1BJTiIsIkNMQVVERV9DT0RFX1JFTU9URSIsImV4aXN0aW5nIiwiTk9ERV9PUFRJT05TIiwiQ0xBVURFX0NPREVfQUJMQVRJT05fQkFTRUxJTkUiLCJrIiwibWFpbiIsIlByb21pc2UiLCJhcmdzIiwiYXJndyIsInNsaWNlIiwibGVuZ3RoIiwiY29uc29sZSIsImxvZyIsIk1BQ1JPIiwiVkVSU0lPTiIsInByb2ZpbGVDaGVja3BvaW50IiwiZW5hYmxlQ29uZmlncyIsImdldE1haW5Mb29wTW9kZWwiLCJtb2RlbElkeCIsImluZGV4T2YiLCJtb2RlbCIsImdldFN5c3RlbVByb21wdCIsInByb21wdCIsImpvaW4iLCJydW5DbGF1ZUlOY2hyb21lTWNzU2VydmVyIiwicnVuQ2hyb21lTmF0aXZlSG9zdCIsInJ1bkNvbXB1dGVVc2VNa3BTZXJ2ZXIiLCJydW5EYWVtb25Xb3JrZSIpLCJnZXRCcmlkZ2VEaXNhYmxlZFJlYXNvbiIsImNoZWNrQnJpZGdlTWluVmVyc2lvbiIsIkJSSUVHR1BfTE9HSU5fRVJST1JCIx7YnJpZGdlTWFpblz9leGl0V2l0aEVycm9yIiwKZ2V0Q2xhdWRlQUlPQXV0aFRva2VuczpcImFjY2Vzc1Rva2VuIix9LGRpc2FibGVkUmVhc29uIiwidmVyc2lvkVycm9yIiwgd2FpdEZvclBvbGljeUxpbWl0c1RvTG9hZCpcImlzUG9saWN5QWxsb3dlZC0pLmtpbGwvcm9jXHVwcmVzcy5pbmZvIiwiCiJkYWVtb25NYWluIiwiam5sdWRlX2ZpbHRlcnMiLCJCY190cmF5IiwicHNSaGFuZGxlciIsIGxvZ3NIYW5kbGVyIiwiYXR0YWNoSGFuZGxlciIsImtpbGxIYW5kbGVyIiwiaGFuZGxlQmdGbGFnXCIgKCAp0ZW1wbGF0ZXNOYWluIiwiZXhpdCIsIGVudmlyb25tZW50UnVubmVyTWFpbiBzZWxmSG9zdGVkUnVubmVyTWFpbiBoYXNTdHV4RmxhZ3xzdW1lIGEgc3RhcnRzV2l0aCBpc1dvcmt0cmVlTW9kZUVuYWJsZWQcLeGVjSW50b0RtdXhXb3JrdHJlZQpyZXN1bHQgaGFuZGxlZCAgcmVzdWx0LmVycm9yXGV4aXRXaXRoRXJyb3IgY2xvbmtgLy0tc2ltcGxlLCAuYXJnc19pbmNsdWRlcyAtLX [...] (更长了，这里省略sourcemap)
