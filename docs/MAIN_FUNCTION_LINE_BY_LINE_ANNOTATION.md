# `main()` 函数逐行代码注释

完整代码位置：`src/main.tsx:585-856`

```typescript
// 导出 async main 函数，这是完整交互式模式的入口
export async function main() {
  // 打一个性能分析检查点：main 函数开始执行
  profileCheckpoint('main_function_start');

  // 安全：防止 Windows 从当前目录执行命令
  // 这必须在 ANY 命令执行之前设置，防止 PATH 劫持攻击
  // 参见：https://docs.microsoft.com/en-us/windows/win32/api/processenv/nf-processenv-searchpathw
  // 设置环境变量：禁止 Windows 默认在当前目录搜索 exe
  process.env.NoDefaultCurrentDirectoryInExePath = '1';

  // 尽早初始化警告处理器，这样启动过程中的警告也能被捕获
  initializeWarningHandler();
  // 注册进程退出事件：退出时重置终端光标
  // 防止程序异常退出后光标保持隐藏状态
  process.on('exit', () => {
    resetCursor();
  });
  // 注册 SIGINT 信号处理（用户按 Ctrl+C）
  process.on('SIGINT', () => {
    // 在 print 模式下，print.ts 自己注册了 SIGINT 处理器
    // 它会中止进行中的查询并调用优雅关闭
    // 这里跳过，避免用同步的 process.exit() 抢占它
    if (process.argv.includes('-p') || process.argv.includes('--print')) {
      return;
    }
    // 非 print 模式直接退出，退出码 0 表示正常退出
    process.exit(0);
  });
  // 打性能检查点：警告处理器初始化完成
  profileCheckpoint('main_warning_handler_initialized');

  // 检查 argv 中是否有 cc:// 或 cc+unix:// URL
  // 改写 argv，让主命令处理，给出完整交互式 TUI
  // 对于无头模式 (-p)，我们改写成内部的 `open` 子命令
  // DIRECT_CONNECT 是功能开关，只有开启了才处理
  if (feature('DIRECT_CONNECT')) {
    // 取出命令行参数，从第 3 个元素开始（node 路径，脚本路径 占前两个）
    const rawCliArgs = process.argv.slice(2);
    // 查找第一个以 cc:// 或 cc+unix:// 开头的参数
    const ccIdx = rawCliArgs.findIndex(a => a.startsWith('cc://') || a.startsWith('cc+unix://'));
    // 如果找到了，并且 _pendingConnect 已经定义（模块级变量）
    if (ccIdx !== -1 && _pendingConnect) {
      // 取出这个 URL
      const ccUrl = rawCliArgs[ccIdx]!;
      // 动态导入 URL 解析模块，只有用到才加载
      const {
        parseConnectUrl
      } = await import('./server/parseConnectUrl.js');
      // 解析 URL 得到服务器地址和认证 token
      const parsed = parseConnectUrl(ccUrl);
      // 保存是否危险跳过权限检查标志
      _pendingConnect.dangerouslySkipPermissions = rawCliArgs.includes('--dangerously-skip-permissions');
      // 如果是无头模式（-p/--print）
      if (rawCliArgs.includes('-p') || rawCliArgs.includes('--print')) {
        // 无头：改写为内部 `open` 子命令
        // 过滤掉 URL 这个参数
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx);
        // 查找并移除 --dangerously-skip-permissions 参数
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions');
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1);
        }
        // 改写 process.argv：变成 [node, cli, 'open', url, ...剩下的参数]
        process.argv = [process.argv[0]!, process.argv[1]!, 'open', ccUrl, ...stripped];
      } else {
        // 交互式：去掉 cc:// URL 和标志，让主命令运行
        // 保存解析后的服务器 URL 到全局 pending
        _pendingConnect.url = parsed.serverUrl;
        // 保存解析后的认证 token 到全局 pending
        _pendingConnect.authToken = parsed.authToken;
        // 过滤掉 URL 参数
        const stripped = rawCliArgs.filter((_, i) => i !== ccIdx);
        // 移除 --dangerously-skip-permissions
        const dspIdx = stripped.indexOf('--dangerously-skip-permissions');
        if (dspIdx !== -1) {
          stripped.splice(dspIdx, 1);
        }
        // 改写 argv，URL 已经存好了，不需要它
        process.argv = [process.argv[0]!, process.argv[1]!, ...stripped];
      }
    }
  }

  // 提前处理深度链接 URI — 这是操作系统协议处理器调用的
  // 应该在完整初始化之前就退出，因为它只需要解析 URI 然后打开终端
  if (feature('LODESTONE')) {
    // 查找 --handle-uri 参数
    const handleUriIdx = process.argv.indexOf('--handle-uri');
    // 如果找到了，并且下一个参数存在（就是 URI）
    if (handleUriIdx !== -1 && process.argv[handleUriIdx + 1]) {
      // 动态导入 config 模块
      const {
        enableConfigs
      } = await import('./utils/config.js');
      // 启用配置（需要先加载配置才能处理深度链接）
      enableConfigs();
      // 取出 URI
      const uri = process.argv[handleUriIdx + 1]!;
      // 动态导入深度链接处理器
      const {
        handleDeepLinkUri
      } = await import('./utils/deepLink/protocolHandler.js');
      // 处理深度链接，得到退出码
      const exitCode = await handleDeepLinkUri(uri);
      // 处理完直接退出，不需要进主程序
      process.exit(exitCode);
    }

    // macOS URL 处理器特殊情况：
    // 当 LaunchServices 启动我们的 .app bundle 时，URL 通过 Apple Event 到达，
    // 不是通过 argv。LaunchServices 会覆盖 __CFBundleIdentifier
    // 为启动者的 ID，这是一个精确的正信号 — 比导入然后用启发式猜测更便宜。
    if (process.platform === 'darwin' && process.env.__CFBundleIdentifier === 'com.anthropic.claude-code-url-handler') {
      // 需要启用配置
      const {
        enableConfigs
      } = await import('./utils/config.js');
      enableConfigs();
      // 动态导入处理函数
      const {
        handleUrlSchemeLaunch
      } = await import('./utils/deepLink/protocolHandler.js');
      // 处理 URL scheme 启动，得到结果
      const urlSchemeResult = await handleUrlSchemeLaunch();
      // 处理完直接退出
      process.exit(urlSchemeResult ?? 1);
    }
  }

  // `claude assistant [sessionId]` — 暂存并从 argv 去掉
  // 这样主命令处理它，给出完整交互式 TUI
  // 只匹配位置 0，因为匹配下面的 ssh 模式
  // 如果用 indexOf 会在 `claude -p "explain assistant"` 误匹配
  // 根标志在子命令之前（比如 `--debug assistant`）会落到 stub，stub 打印使用帮助
  if (feature('KAIROS') && _pendingAssistantChat) {
    // 取出参数，去掉前两个
    const rawArgs = process.argv.slice(2);
    // 第一个参数就是 'assistant'
    if (rawArgs[0] === 'assistant') {
      // 取出第二个参数（可能是 sessionId）
      const nextArg = rawArgs[1];
      // 如果有第二个参数，并且它不以 - 开头（不是标志）
      if (nextArg && !nextArg.startsWith('-')) {
        // 保存 sessionId
        _pendingAssistantChat.sessionId = nextArg;
        // 从数组删掉前两个元素：'assistant' 和 sessionId
        rawArgs.splice(0, 2);
        // 改写 argv
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
      } else if (!nextArg) {
        // 没有第二个参数，发现模式
        _pendingAssistantChat.discover = true;
        // 只删掉 'assistant'
        rawArgs.splice(0, 1);
        // 改写 argv
        process.argv = [process.argv[0]!, process.argv[1]!, ...rawArgs];
      }
      // else 情况：`claude assistant --help` → 掉到后面让 commander 处理
    }
  }

  // `claude ssh <host> [dir]` — 从 argv 去掉 ssh，让主命令处理器运行
  // （给出完整交互式 TUI），暂存 host/dir 给 REPL 分支在约 3720 行拾取
  // 无头 (-p) 模式 v1 不支持：SSH 会话需要本地 REPL 驱动它们
  // （中断、权限都需要 REPL）
  if (feature('SSH_REMOTE') && _pendingSSH) {
    // 取出参数，去掉前两个
    const rawCliArgs = process.argv.slice(2);
    // SSH 特定标志可以出现在 host 位置参数之前
    // 比如 `ssh --permission-mode auto host /tmp`
    // 标准 POSIX 就是标志在位置参数之前
    // 所以我们在检查是否给出 host 之前把所有标志都抽出来
    // 这样 `claude ssh --permission-mode auto host` 和
    // `claude ssh host --permission-mode auto` 结果一样
    // 下面的 host 检查只需要防备 -h/--help（commander 会处理）
    if (rawCliArgs[0] === 'ssh') {
      // 查找 --local 标志
      const localIdx = rawCliArgs.indexOf('--local');
      if (localIdx !== -1) {
        // 设置局部模式标志
        _pendingSSH.local = true;
        // 从参数数组删掉这个标志
        rawCliArgs.splice(localIdx, 1);
      }
      // 查找 --dangerously-skip-permissions 标志
      const dspIdx = rawCliArgs.indexOf('--dangerously-skip-permissions');
      if (dspIdx !== -1) {
        // 设置跳过权限检查标志
        _pendingSSH.dangerouslySkipPermissions = true;
        // 删掉参数
        rawCliArgs.splice(dspIdx, 1);
      }
      // 查找 --permission-mode 标志（分隔写法）
      const pmIdx = rawCliArgs.indexOf('--permission-mode');
      if (pmIdx !== -1 && rawCliArgs[pmIdx + 1] && !rawCliArgs[pmIdx + 1]!.startsWith('-')) {
        // 保存权限模式
        _pendingSSH.permissionMode = rawCliArgs[pmIdx + 1];
        // 删掉两个元素：标志和值
        rawCliArgs.splice(pmIdx, 2);
      }
      // 查找 --permission-mode=value 等号写法
      const pmEqIdx = rawCliArgs.findIndex(a => a.startsWith('--permission-mode='));
      if (pmEqIdx !== -1) {
        // 分割出值，保存
        _pendingSSH.permissionMode = rawCliArgs[pmEqIdx]!.split('=')[1];
        // 删掉这个参数
        rawCliArgs.splice(pmEqIdx, 1);
      }
      // 提取会话恢复 + 模型标志，转发给远程 CLI 的初始启动
      // --continue/-c 和 --resume <uuid> 作用在远程会话历史
      // （远程会话历史保存在远程 ~/.claude/projects/<cwd>/）
      // --model 控制远程用哪个模型
      // 工具函数：提取标志，支持分隔和等号写法
      const extractFlag = (flag: string, opts: {
        hasValue?: boolean;
        as?: string;
      } = {}) => {
        // 查找标志位置
        const i = rawCliArgs.indexOf(flag);
        if (i !== -1) {
          // 添加到额外 CLI 参数数组
          _pendingSSH.extraCliArgs.push(opts.as ?? flag);
          // 如果需要值，并且下一个元素存在，且不是标志
          const val = rawCliArgs[i + 1];
          if (opts.hasValue && val && !val.startsWith('-')) {
            // 添加值到额外参数
            _SSH.extraCliArgs.push(val);
            // 删掉两个元素
            rawCliArgs.splice(i, 2);
          } else {
            // 不需要值，删掉一个元素
            rawCliArgs.splice(i, 1);
          }
        }
        // 处理等号写法
        const eqI = rawCliArgs.findIndex(a => a.startsWith(`${flag}=`));
        if (eqI !== -1) {
          // 分割出值，添加到额外参数
          _pendingSSH.extraCliArgs.push(opts.as ?? flag, rawCliArgs[eqI]!.slice(flag.length + 1));
          // 删掉这个参数
          rawCliArgs.splice(eqI, 1);
        }
      };
      // 提取 -c，别名为 --continue
      extractFlag('-c', {
        as: '--continue'
      });
      // 提取 --continue
      extractFlag('--continue');
      // 提取 --resume，需要值
      extractFlag('--resume', {
        hasValue: true
      });
      // 提取 --model，需要值
      extractFlag('--model', {
        hasValue: true
      });
    }
    // 预提取之后，如果 [1] 还是 ssh，并且第二个元素存在且不是标志
    // 那就是 host。否则如果是标志，commander 会处理（-h/--help 正确报错）
    if (rawCliArgs[0] === 'ssh' && rawCliArgs[1] && !rawCliArgs[1].startsWith('-')) {
      // 保存 host
      _pendingSSH.host = rawCliArgs[1];
      // 可选的位置参数 cwd，默认消耗 2 个（ssh + host）
      let consumed = 2;
      // 如果第三个元素存在，且不是标志
      if (rawCliArgs[2] && !rawCliArgs[2].startsWith('-')) {
        // 保存 cwd
        _pendingSSH.cwd = rawCliArgs[2];
        // 消耗 3 个
        consumed = 3;
      }
      // 取出剩下的参数
      const rest = rawCliArgs.slice(consumed);

      // 无头 (-p) 模式 SSH v1 不支持 → 尽早拒绝
      // 这样标志不会悄无声息导致本地执行
      if (rest.includes('-p') || rest.includes('--print')) {
        // 输出错误信息到 stderr
        process.stderr.write('Error: headless (-p/--print) mode is not supported with claude ssh\n');
        // 同步优雅关闭，退出码 1
        gracefulShutdownSync(1);
        // 返回
        return;
      }

      // 改写 argv，让主命令看到剩下的标志，但看不到 `ssh`
      // ssh 信息已经存在 _pendingSSH 了，后面 REPL 会读取
      process.argv = [process.argv[0]!, process.argv[1]!, ...rest];
    }
  }

  // 提前检查 -p/--print 和 --init-only 标志
  // 在 init() 之前设置 isInteractiveSession
  // 这是必须的，因为遥测初始化调用需要这个标志的认证函数
  // 取出命令行参数
  const cliArgs = process.argv.slice(2);
  // 是否有 print 标志
  const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print');
  // 是否有 init-only 标志
  const hasInitOnlyFlag = cliArgs.includes('--init-only');
  // 是否有 sdk-url 标志
  const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'));
  // 计算是否非交互式：满足任一条件就是非交互式
  // print / init-only / sdk-url / stdout 不是终端 → 都是非交互式
  const isNonInteractive = hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY;

  // 对于非交互式模式，停止捕获早期输入
  // 早期输入捕获是为了：程序启动慢的时候用户敲的键盘不会丢
  // 非交互式不需要
  if (isNonInteractive) {
    stopCapturingEarlyInput();
  }

  // 设置简化跟踪字段：计算是否交互式，取反
  const isInteractive = !isNonInteractive;
  // 写入全局状态
  setIsInteractive(isInteractive);

  // 根据模式初始化入口点
  // 必须在记录任何事件之前设置，因为事件需要这个标签
  initializeEntrypoint(isNonInteractive);

  // 确定客户端类型
  // IIFE：立即执行函数表达式，计算结果赋值给变量
  const clientType = (() => {
    // 如果是 GitHub Actions 环境
    if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return 'github-action';
    // 环境变量指定是 TypeScript SDK
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript';
    // 环境变量指定是 Python SDK
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-py') return 'sdk-python';
    // 环境变量指定是 SDK CLI
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 'sdk-cli';
    // 环境变量指定是 VS Code 中的 Claude
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode') return 'claude-vscode';
    // 环境变量指定是本地代理
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return 'local-agent';
    // 环境变量指定是 Claude Desktop
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') return 'claude-desktop';

    // 检查是否提供了会话入口 token（表示远程会话）
    const hasSessionIngressToken = process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN || process.env.CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR;
    // 如果环境变量说是 remote，或者有入口 token → 返回 remote
    if (process.env.CLAUDE_CODE_ENTRYPOINT === 'remote' || hasSessionIngressToken) {
      return 'remote';
    }
    // 默认情况：本地 CLI
    return 'cli';
  })();
  // 保存客户端类型到全局
  setClientType(clientType);
  // 从环境变量取出问题预览格式
  const previewFormat = process.env.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT;
  // 如果是 markdown 或 html，直接使用
  if (previewFormat === 'markdown' || previewFormat === 'html') {
    setQuestionPreviewFormat(previewFormat);
  } else if (!clientType.startsWith('sdk-') &&
  // Desktop 和 CCR 通过 toolConfig 传递 previewFormat
  // 当功能关闭时它们传 undefined → 不要用 markdown 覆盖那个 undefined
  clientType !== 'claude-desktop' && clientType !== 'local-agent' && clientType !== 'remote') {
    // 默认：非 SDK 类型，设置为 markdown
    setQuestionPreviewFormat('markdown');
  }

  // 给 `claude remote-control` 创建的会话打标签
  // 这样后端可以识别它们
  if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND === 'bridge') {
    setSessionSource('remote-control');
  }
  // 打性能检查点：客户端类型确定完成
  profileCheckpoint('main_client_type_determined');

  // 在 init() 之前，尽早解析并加载设置中的功能标志
  eagerLoadSettings();
  // 打性能检查点：准备调用 run()
  profileCheckpoint('main_before_run');
  // 调用 run() 函数，它创建 Commander 并处理命令
  await run();
  // 打性能检查点：run() 返回
  profileCheckpoint('main_after_run');
}
```

## 总结逐行设计思路

| 行号范围 | 做什么 | 设计要点 |
|---------|-------|---------|
| 585-591 | 安全初始化 | **第一行代码就做安全防护**，Windows PATH 劫持防护必须最先 |
| 593-607 | 退出/信号处理 | 初始化警告处理器，注册退出重置光标，SIGINT 处理 |
| 612-642 | `cc://` 深度链接 | DIRECT_CONNECT 特性开启才处理，动态导入，改写 argv |
| 647-677 | `--handle-uri` 深度链接 | 操作系统调用，处理完直接退出，不进主程序；macOS Apple Event 特殊处理 |
| 685-700 | `assistant` 预处理 | KAIROS 多代理特性，提前处理，保存 sessionId，改写 argv |
| 706-795 | `claude ssh` 预处理 | 提取各种标志，保存到 `_pendingSSH`，检查无头不支持，改写 argv |
| 797-808 | 判断非交互式 | 提前判断，用于遥测，非交互式停止早期输入捕获 |
| 810-815 | 设置全局模式 | 设置 `isInteractive`，初始化入口点 |
| 818-833 | 识别客户端类型 | 根据环境变量判断：github-action/claude-vscode/remote/cli 等 |
| 834-843 | 设置预览格式 | 根据客户端类型默认设置 markdown |
| 845-849 | 远程控制标记 | 给 remote-control 会话打标签 |
| 851-856 | 加载设置，调用 run | 提前加载设置，进入 Commander 处理 |

## 关键设计点逐行体现

1. **安全第一**：`process.env.NoDefaultCurrentDirectoryInExePath = '1';` 真的是第一行可执行代码

2. **动态导入**：所有不常用的模块都是 `await import()`，用到才加载，加速正常启动

3. **argv 改写**：预处理特殊命令不是提前 exit 就是改写 argv 让主流程继续处理，复用代码

4. **功能开关**：每个大特性都用 `feature('NAME')` 包围，编译可以死代码消除

5. **性能打点**：每个阶段都有 `profileCheckpoint`，可以精确分析启动耗时

6. **提前判断**：`isNonInteractive` 在 `init()` 之前就算好，因为遥测需要它

7. **IIFE 计算**：客户端类型用立即执行函数，代码清晰不脏命名空间
