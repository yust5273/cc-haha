import { feature } from 'bun:bundle';

/**
 * 设计思想：为什么环境变量设置要放在文件最顶层，而不是放到 main() 函数里？
 *
 * 核心问题：模块在导入的时候，就会读取环境变量并保存为 const 常量。
 * 如果设置晚了，常量已经算出结果，再改环境变量也没用！
 *
 * 正确做法：必须在导入任何会读取这些环境变量的模块之前，就设置好。
 */
// eslint-disable-next-line custom-rules/no-top-level-side-effects
process.env.COREPACK_ENABLE_AUTO_PIN = '0';

// 为 CCR (Claude Code Remote) 云端环境增加 V8 堆内存上限
// 必须在生成任何子进程之前设置，因为 NODE_OPTIONS 会被子进程继承
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level, custom-rules/safe-env-boolean-check
if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  const existing = process.env.NODE_OPTIONS || '';
  // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
  process.env.NODE_OPTIONS = existing ? `${existing} --max-old-space-size=8192` : '--max-old-space-size=8192';
}

/**
 * 消融基线实验模式：关闭所有高级功能，得到最简基线版本。
 *
 * 为什么放在这里？因为很多模块在导入时就会读取 DISABLE_* 环境变量，
 * 必须在导入模块之前设置好。使用 Bun 特性开关做构建时死代码消除（DCE），
 * 当这个特性关闭时，这段代码会被完全从最终二进制中删除。
 */
// eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
if (feature('ABLATION_BASELINE') && process.env.CLAUDE_CODE_ABLATION_BASELINE) {
  for (const k of ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_DISABLE_THINKING', 'DISABLE_INTERLEAVED_THINKING', 'DISABLE_COMPACT', 'DISABLE_AUTO_COMPACT', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS']) {
    // eslint-disable-next-line custom-rules/no-top-level-side-effects, custom-rules/no-process-env-top-level
    process.env[k] ??= '1';
  }
}

/**
 * 启动入口 - 快速路径分流
 *
 * 核心设计原则：尽早处理特殊情况，不加载无用代码，让常见路径更快。
 *
 * 快速路径分流：在进入完整交互式 TUI 之前，先判断是否为特殊命令。
 * 如果是特殊情况，在这里处理完就退出，不需要加载完整的 8000 行 main.tsx。
 * 只有正常交互式使用才需要加载完整 TUI。
 *
 * 所有分支都使用动态 `await import()` - 只加载实际需要的代码。
 * 如果你运行 `claude --version`，不需要付出加载其他任何代码的成本。
 * 这保证了快速路径命令真的很快（毫秒级响应）。
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  console.log(`[cli] 进入 cli main 函数，参数: ${JSON.stringify(args)}`);

  // 快速路径 1：--version/-v - 输出版本号后退出（零导入！）
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    console.log('[cli] 快速路径 --version，输出版本号后退出');
    // MACRO.VERSION 在构建时已经内联
    // biome-ignore lint/suspicious/noConsole: intentional output
    console.log(`${MACRO.VERSION} (Claude Code)`);
    return;
  }

  // 加载启动性能分析工具（只在需要时加载）
  console.log('[cli] 加载启动性能分析工具');
  const { profileCheckpoint } = await import('../utils/startupProfiler.js');
  profileCheckpoint('cli_entry');
  console.log('[cli] 记录检查点: cli_entry');

  // 快速路径 2：--dump-system-prompt - 输出生成好的系统提示词后退出（内部实验用）
  if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') {
    console.log('[cli] 快速路径 --dump-system-prompt');
    profileCheckpoint('cli_dump_system_prompt_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { getMainLoopModel } = await import('../utils/model/model.js');
    const modelIdx = args.indexOf('--model');
    const model = modelIdx !== -1 && args[modelIdx + 1] || getMainLoopModel();
    const { getSystemPrompt } = await import('../constants/prompts.js');
    const prompt = await getSystemPrompt([], model);
    // biome-ignore lint/suspicious/noConsole: intentional output
    console.log(prompt.join('\n'));
    return;
  }

  // 快速路径 3：独立 MCP 服务器模式
  // 这些服务器独立运行，不需要完整 TUI，所以单独走快速路径

  // Claude in Chrome MCP 服务器
  if (process.argv[2] === '--claude-in-chrome-mcp') {
    console.log('[cli] 快速路径 --claude-in-chrome-mcp');
    profileCheckpoint('cli_claude_in_chrome_mcp_path');
    const { runClaudeInChromeMcpServer } = await import('../utils/claudeInChrome/mcpServer.js');
    await runClaudeInChromeMcpServer();
    return;
  }
  // Claude in Chrome 扩展的 Chrome 原生消息宿主
  else if (process.argv[2] === '--chrome-native-host') {
    console.log('[cli] 快速路径 --chrome-native-host');
    profileCheckpoint('cli_chrome_native_host_path');
    const { runChromeNativeHost } = await import('../utils/claudeInChrome/chromeNativeHost.js');
    await runChromeNativeHost();
    return;
  }
  // 桌面控制（Computer Use）独立 MCP 服务器
  else if (process.argv[2] === '--computer-use-mcp') {
    console.log('[cli] 快速路径 --computer-use-mcp');
    profileCheckpoint('cli_computer_use_mcp_path');
    const { runComputerUseMcpServer } = await import('../utils/computerUse/mcpServer.js');
    await runComputerUseMcpServer();
    return;
  }

  // 快速路径 4：--daemon-worker - 守护进程工作进程入口（由 supervisor 生成）
  // 为了性能必须放在前面 - worker 需要快速启动
  if (feature('DAEMON') && args[0] === '--daemon-worker') {
    console.log('[cli] 快速路径 --daemon-worker');
    const { runDaemonWorker } = await import('../daemon/workerRegistry.js');
    await runDaemonWorker(args[1]);
    return;
  }

  // 快速路径 5：remote-control/bridge - 允许云端 Claude 控制本地机器
  if (feature('BRIDGE_MODE') && (args[0] === 'remote-control' || args[0] === 'rc' || args[0] === 'remote' || args[0] === 'sync' || args[0] === 'bridge')) {
    console.log('[cli] 快速路径 remote-control/bridge');
    profileCheckpoint('cli_bridge_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { getBridgeDisabledReason, checkBridgeMinVersion } = await import('../bridge/bridgeEnabled.js');
    const { BRIDGE_LOGIN_ERROR } = await import('../bridge/types.js');
    const { bridgeMain } = await import('../bridge/bridgeMain.js');
    const { exitWithError } = await import('../utils/process.js');

    // 认证必须放在 GrowthBook 特性检查之前 - 没有认证时，GB 会返回过期的默认值
    const { getClaudeAIOAuthTokens } = await import('../utils/auth.js');
    if (!getClaudeAIOAuthTokens()?.accessToken) {
      exitWithError(BRIDGE_LOGIN_ERROR);
    }
    const disabledReason = await getBridgeDisabledReason();
    if (disabledReason) {
      exitWithError(`Error: ${disabledReason}`);
    }
    const versionError = checkBridgeMinVersion();
    if (versionError) {
      exitWithError(versionError);
    }

    // 检查企业策略：远程控制是敏感功能
    const { waitForPolicyLimitsToLoad, isPolicyAllowed } = await import('../services/policyLimits/index.js');
    await waitForPolicyLimitsToLoad();
    if (!isPolicyAllowed('allow_remote_control')) {
      exitWithError("Error: Remote Control is disabled by your organization's policy.");
    }

    await bridgeMain(args.slice(1));
    return;
  }

  // 快速路径 7：后台会话管理 - ps/logs/attach/kill/--bg
  if (feature('BG_SESSIONS') && (args[0] === 'ps' || args[0] === 'logs' || args[0] === 'attach' || args[0] === 'kill' || args.includes('--bg') || args.includes('--background'))) {
    console.log(`[cli] 快速路径 bg 命令: ${args[0]}`);
    profileCheckpoint('cli_bg_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const bg = await import('../cli/bg.js');
    switch (args[0]) {
      case 'ps':
        await bg.psHandler(args.slice(1));
        break;
      case 'logs':
        await bg.logsHandler(args[1]);
        break;
      case 'attach':
        await bg.attachHandler(args[1]);
        break;
      case 'kill':
        await bg.killHandler(args[1]);
        break;
      default:
        await bg.handleBgFlag(args);
    }
    return;
  }

  // 快速路径 8：模板任务 - new/list/reply
  if (feature('TEMPLATES') && (args[0] === 'new' || args[0] === 'list' || args[0] === 'reply')) {
    console.log(`[cli] 快速路径 templates 命令: ${args[0]}`);
    profileCheckpoint('cli_templates_path');
    const { templatesMain } = await import('../cli/handlers/templateJobs.js');
    await templatesMain(args);
    // 需要强制退出，因为 Ink 可能会留下事件循环句柄阻止进程退出
    // eslint-disable-next-line custom-rules/no-process-exit
    process.exit(0);
  }

  // 快速路径 9：environment-runner - BYOC 无头运行器，用于自托管容器
  if (feature('BYOC_ENVIRONMENT_RUNNER') && args[0] === 'environment-runner') {
    console.log('[cli] 快速路径 environment-runner');
    profileCheckpoint('cli_environment_runner_path');
    const { environmentRunnerMain } = await import('../environment-runner/main.js');
    await environmentRunnerMain(args.slice(1));
    return;
  }

  // 快速路径 10：self-hosted-runner - Anthropic API 任务运行器
  if (feature('SELF_HOSTED_RUNNER') && args[0] === 'self-hosted-runner') {
    console.log('[cli] 快速路径 self-hosted-runner');
    profileCheckpoint('cli_self_hosted_runner_path');
    const { selfHostedRunnerMain } = await import('../self-hosted-runner/main.js');
    await selfHostedRunnerMain(args.slice(1));
    return;
  }

  // 快速路径 11：--worktree + --tmux - 在加载完整 CLI 之前 exec 进入 tmux
  // 如果 exec 成功，当前进程会被替换，所以我们不会继续往下走
  const hasTmuxFlag = args.includes('--tmux') || args.includes('--tmux=classic');
  if (hasTmuxFlag && (args.includes('-w') || args.includes('--worktree') || args.some(a => a.startsWith('--worktree=')))) {
    console.log('[cli] 快速路径 tmux + worktree');
    profileCheckpoint('cli_tmux_worktree_fast_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { isWorktreeModeEnabled } = await import('../utils/worktreeModeEnabled.js');
    if (isWorktreeModeEnabled()) {
      const { execIntoTmuxWorktree } = await import('../utils/worktree.js');
      const result = await execIntoTmuxWorktree(args);
      if (result.handled) {
        return;
      }
      if (result.error) {
        const { exitWithError } = await import('../utils/process.js');
        exitWithError(result.error);
      }
      // 如果 exec 没有成功，回落到正常 CLI
    }
    // 如果 worktree 模式未启用，回落到正常 CLI
  }

  // 自动纠正用户常见输入错误：`claude --update` → `claude update`
  if (args.length === 1 && (args[0] === '--update' || args[0] === '--upgrade')) {
    console.log('[cli] 自动纠正参数: --update → update');
    process.argv = [process.argv[0]!, process.argv[1]!, 'update'];
  }

  // 处理 --bare 标志：开启极简模式，禁用非必要功能
  // 必须在这里设置，在任何读取这个环境变量的模块导入之前
  if (args.includes('--bare')) {
    console.log('[cli] 检测到 --bare 标志，开启极简模式 CLAUDE_CODE_SIMPLE=1');
    process.env.CLAUDE_CODE_SIMPLE = '1';
  }

  console.log('[cli] 没有匹配到快速路径，准备启动完整交互式 CLI');

  // 开始提前捕获用户输入，防止加载过程中输入丢失
  // 用户可能在 CLI 准备好之前就开始打字 - 我们先缓冲，之后再重放
  console.log('[cli] 导入 earlyInput 模块，开始捕获早期输入');
  const { startCapturingEarlyInput } = await import('../utils/earlyInput.js');
  startCapturingEarlyInput();

  profileCheckpoint('cli_before_main_import');
  console.log('[cli] 记录检查点: cli_before_main_import，开始导入 main.tsx');

  // 最后，才加载完整的交互式 CLI - 只在我们真的需要它的时候
  const { main: cliMain } = await import('../main.js');

  profileCheckpoint('cli_after_main_import');
  console.log('[cli] main.tsx 导入完成，记录检查点: cli_after_main_import');

  console.log('[cli] 调用完整 CLI 主函数 cliMain()');
  await cliMain();

  profileCheckpoint('cli_after_main_complete');
  console.log('[cli] cliMain 执行完成，记录检查点: cli_after_main_complete');
}

// 顶层入口点 - 调用 main() 启动程序
// eslint-disable-next-line custom-rules/no-top-level-side-effects
void main();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJmZWF0dXJlIiwicHJvY2VzcyIsImVydiIsIkNPUkVQQUNLX0VOQUJMRV9BVVRPX1BJTiIsIkNMQVVERV9DT0RFX1JFTU9URSIsImV4aXN0aW5nIiwiTk9ERV9PUFRJT05TIiwiQ0xBVURFX0NPREVfQUJMQVRJT05fQkFTRUxJTkUiLCJrIiwibWFpbiIsIlByb21pc2UiLCJhcmdzIiwiYXJndyIsInNsaWNlIiwibGVuZ3RoIiwiY29uc29sZSIsImxvZyIsIk1BQ1JPIiwiVkVSU0lPTiIsInByb2ZpbGVDaGVja3BvaW50IiwiZW5hYmxlQ29uZmlncyIsImdldE1haW5Mb29wTW9kZWwiLCJtb2RlbElkeCIsImluZGV4T2YiLCJtb2RlbCIsImdldFN5c3RlbVByb21wdCIsInByb21wdCIsImpvaW4iLCJydW5DbGF1ZUlOY2hyb21lTWNzU2VydmVyIiwicnVuQ2hyb21lTmF0aXZlSG9zdCIsInJ1bkNvbXB1dGVVc2VNa3BTZXJ2ZXIiLCJydW5EYWVtb25Xb3JrZSIpLCJnZXRCcmlkZ2VEaXNhYmxlZFJlYXNvbiIsImNoZWNrQnJpZGdlTWluVmVyc2lvbiIsIkJSSUVHR1BfTE9HSU5fRVJST1JCIx7YnJpZGdlTWFpblz9leGl0V2l0aEVycm9yIiwKZ2V0Q2xhdWRlQUlPQXV0aFRva2VuczpcImFjY2Vzc1Rva2VuIix9LGRpc2FibGVkUmVhc29uIiwidmVyc2lvkVycm9yIiwgdsFhaW1Gb3JQb2xpY3lMaW10c1RvTG9hZCpcImlzUG9saWN5QWxsb3dlZC0pLmtpbGwvcm9jXHVwcmVzcy5pbmZvIiwiCiJkYWVtb25NYWluIiwiam5sdWRlX2ZpbHRlcnMiLCJCZ190cmF5IiwicHNSaGFuZGxlciIsIGxvZ3RIYW5kbGVyIiwiYXR0YWNoSGFuZGxlciIsImtpbGxIYW5kbGVyIiwiaGFuZGxlQmdGbGFnXCIgKCAp0ZW1wbGF0ZXNOYWluIiwiZXhpdCIsIGVudmlyb25tZW50UnVubmVyTWFpbiBzZWxmSG9zdGVkUnVubmVyTWFpbiBoYXNTdHV4RmxhZ3xzdW1lIGEgc3RhcnRzV2l0aCBpc1dvcmt0cmVlTW9kZUVuYWJsZWMgLeGVjSW50b0RtdXhXb3JrdHJlZQpyZXN1bHQgaGFuZGxlZCAgcmVzdWx0LmVycm9yXGV4aXRXaXRoRXJyb3IgY2xvbmtgLy0tc2ltcGxlLCAuYXJnc19pbmNsdWRlcyAtLX [...]
