# CLI 快速路径 MCP 命令分支解读

## 代码位置
`src/entrypoints/cli.tsx` - 快速路径路由部分

## 代码功能
这三段代码是**快速路径特殊命令处理**，为三个独立的 MCP 服务器场景提供入口，不需要加载完整的 TUI 主程序，直接动态导入对应模块并执行。

---

## 逐段分析

### 1. `--claude-in-chrome-mcp`
```typescript
if (process.argv[2] === '--claude-in-chrome-mcp') {
  console.log('[cli] 快速路径 --claude-in-chrome-mcp');
  profileCheckpoint('cli_claude_in_chrome_mcp_path');
  const { runClaudeInChromeMcpServer } = await import('../utils/claudeInChrome/mcpServer.js');
  await runClaudeInChromeMcpServer();
  return;
}
```

**用途**：启动 Claude in Chrome 的 MCP 服务器。

**关键点**：
- `profileCheckpoint`：记录启动时间点，用于启动性能分析（profiling）
- `await import()`：动态导入，只有当这个命令被用到时才加载模块，加快普通启动
- `return`：执行完直接退出，不进入完整 TUI 流程
- 位置：`src/utils/claudeInChrome/mcpServer.ts`

---

### 2. `--chrome-native-host`
```typescript
else if (process.argv[2] === '--chrome-native-host') {
  console.log('[cli] 快速路径 --chrome-native-host');
  profileCheckpoint('cli_chrome_native_host_path');
  const { runChromeNativeHost } = await import('../utils/claudeInChrome/chromeNativeHost.js');
  await runChromeNativeHost();
  return;
}
```

**用途**：运行 Claude in Chrome 扩展的 **Chrome 原生消息宿主**。

**什么是 Chrome 原生消息宿主**：
- Chrome 扩展不能直接访问本地文件系统
- 需要一个本地程序（这个宿主）作为桥梁
- Chrome 扩展通过标准输入输出和这个宿主通信
- 扩展 → 宿主 → 本地 Claude Code → 扩展，这样的通路

**关键点**：
- 专门给浏览器扩展用的本地桥接
- 同样是快速路径，不加载完整 TUI

---

### 3. `--computer-use-mcp`
```typescript
else if (process.argv[2] === '--computer-use-mcp') {
  console.log('[cli] 快速路径 --computer-use-mcp');
  profileCheckpoint('cli_computer_use_mcp_path');
  const { runComputerUseMcpServer } = await import('../utils/computerUse/mcpServer.js');
  await runComputerUseMcpServer();
  return;
}
```

**用途**：启动**桌面控制（Computer Use）**独立 MCP 服务器。

**Computer Use 功能**：
- 通过 MCP 协议提供桌面控制能力
- 可以截图、移动鼠标、点击、键盘输入
- 让 Claude Code 能控制你的电脑图形界面
- 作为独立 MCP 服务器运行，可以被其他客户端连接

---

## 设计思路分析

### 为什么用快速路径？

| 设计选择 | 原因 |
|---------|------|
| **提前处理** | 在进入完整 TUI 之前就处理完，节省启动时间 |
| **动态导入** | `await import()` 只有按需加载，不占用无用代码 |
| **直接退出** | 这些场景不需要完整 Ink/React TUI，执行完就返回 |
| **性能打点** | `profileCheckpoint` 可以分析不同路径的启动耗时 |

### 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│  node cli.tsx                                           │
│  ↓                                                      │
│  检查 argv[2] 是否是特殊命令  →  命中 → 快速路径 → 返回  │
│                   ↓ 不命中                              │
│            继续加载完整 TUI (main.tsx)                   │
└─────────────────────────────────────────────────────────┘
```

### MCP 服务独立运行的好处

1. **职责分离**：主 Claude Code REPL 是对话交互，MCP 服务是能力提供
2. **独立进程**：崩溃不影响主程序
3. **可复用**：其他 MCP 客户端也可以连接这些独立服务
4. **开发独立**：可以单独开发调试 MCP 服务

---

## 设计亮点

| 亮点 | 说明 |
|-----|------|
| **快速启动** | 特殊命令不走完整加载流程，启动更快 |
| **按需加载** | 代码分割，不使用的模块不会被加载 |
| **性能可观测** | 每个路径都有 checkpoint，方便 profiling |
| **清晰分离** | 不同功能入口互不干扰 |

---

## 总结

这段代码体现了 Claude Code 的**快速路径设计思想**：

> **把特殊命令提前处理，不占用正常启动路径的开销**

三个快速路径都是 MCP 相关的独立服务入口：
- Claude in Chrome 集成
- Chrome 扩展原生消息桥接
- Computer Use 桌面控制

都遵循同样的模式：打日志 → 打点 → 动态导入 → 执行 → 返回。干净利落。
