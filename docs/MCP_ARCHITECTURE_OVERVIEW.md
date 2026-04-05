# Claude Code MCP 架构整体梳理

MCP = **Model Context Protocol**，Anthropic 推出的模型上下文协议，允许 AI 模型调用外部工具服务。

本文梳理 Claude Code 中完整的 MCP 架构设计。

---

## 目录

1. [MCP 是什么](#mcp-是什么)
2. [整体架构](#整体架构)
3. [Claude in Chrome 集成架构](#claude-in-chrome-集成架构)
4. [Computer Use 桌面控制架构](#computer-use-桌面控制架构)
5. [第三方 MCP 服务器集成](#第三方-mcp-服务器集成)
6. [关键设计点](#关键设计点)

---

## MCP 是什么

MCP 是一个**基于 JSON-RPC 的标准协议**，让 AI 模型和外部工具服务通信：

```
┌─────────────┐      JSON-RPC over      ┌─────────────┐
│ AI 模型     │ ←---------------------→ │  MCP 服务器  │
│ (Claude)    │  stdio / HTTP / SSE     │ (工具提供方) │
└─────────────┘                         └─────────────┘
```

**MCP 服务器的职责**：
- 暴露 `list_tools`：告诉客户端有哪些工具
- 处理 `call_tool` 请求：执行工具，返回结果
- 遵循标准协议，任何 MCP 客户端都能连接

**Claude Code 的角色**：
- MCP 客户端：连接各种 MCP 服务器
- MCP 服务器：某些功能作为独立 MCP 服务器输出（如 Computer Use）

---

## 整体架构

Claude Code 中 MCP 分为三大场景：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Main Claude Code REPL                      │
│  主对话程序，提供完整 TUI                                          │
└───────────┬─────────────────────────────────────────────────────┘
            │
    ┌───────┼───────┐
    │       │       │
┌───▼──┐┌──▼───┐┌──▼────────┐
│Chrome││Computer││ Third-party │
│in    ││Use     ││ MCP servers  │
│Chrome││MCP     ││ 用户自己添加  │
│MCP   ││Server  ││             │
└──────┘└───────┘└─────────────┘
```

| 场景 | 角色 | 说明 |
|------|------|------|
| Claude in Chrome | **MCP 服务器** | 给 Chrome 扩展提供本地能力 |
| Computer Use | **MCP 服务器** | 给 Claude Code 自身或其他客户端提供桌面控制 |
| 第三方 MCP | **MCP 客户端** | Claude Code 连接外部第三方 MCP 服务器 |

---

## Claude in Chrome 集成架构

这是最复杂的一个，分三层：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude for Chrome 浏览器扩展                │
│  用户在浏览器中和 Claude 对话                                    │
│  需要访问本地文件系统 → 调用本地 Claude Code                    │
└──────────┬─────────────────────────────────────────────────────┘
           │ Chrome Native Messaging Protocol
           │ (stdin/stdout 带 4 字节长度前缀)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  runChromeNativeHost (原生消息宿主)                              │
│  端口转发：Chrome ↔ UDS ↔ MCP 服务器                              │
│  - 从 Chrome 读消息 → 转发给 MCP 服务器                          │
│  - 从 MCP 服务器读消息 → 转发给 Chrome                            │
└──────────┬─────────────────────────────────────────────────────┘
           │ Unix Domain Socket (本地套接字)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  runClaudeInChromeMcpServer (MCP 服务器)                         │
│  实现 MCP 协议，暴露本地工具：                                    │
│  - Read / Edit / Grep / Glob 等文件操作                          │
│  - Bash 命令执行                                                 │
│  接收请求 → 调用本地工具 → 返回结果                               │
└─────────────────────────────────────────────────────────────────┘
```

### 桥接模式（可选）

当扩展和 Claude Code 不在同一台机器时，通过云端桥接转发：

```
┌───────────┐     Websocket      ┌──────────┐     Websocket      ┌───────────┐
│ 扩展(Chrome) │ ←──────────────→ │  云端桥接 │ ←──────────────→ │ Claude Code│
└───────────┘                    └──────────┘                    └───────────┘
```

桥接 URL 配置：
- 本地开发：`ws://localhost:8765`
- 测试环境：`wss://bridge-staging.claudeusercontent.com`
- 生产环境：`wss://bridge.claudeusercontent.com`

### 安全设计

| 安全措施 | 说明 |
|---------|------|
| **账户配对** | 只有配对的设备才能连接，保存配对信息到配置 |
| **权限模式** | 支持 `ask` / `skip_all_permission_checks` / `follow_a_plan` |
| **UDS 权限** | socket 文件 `0o600`，只有当前用户可访问 |
| **隐私保护** | 分析事件只上报白名单字段，不泄漏用户内容 |

---

## Computer Use 桌面控制架构

Computer Use = 让 Claude 能控制你的电脑桌面（截图、鼠标点击、键盘输入等）。在 Claude Code 中，它作为**独立 MCP 服务器**运行：

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Code REPL / 任何 MCP 客户端                              │
│  需要桌面控制能力 → 调用 Computer Use MCP 服务器                 │
└──────────┬─────────────────────────────────────────────────────┘
           │ stdio MCP Protocol
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  runComputerUseMcpServer (独立进程)                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  MCP 协议处理                                                ││
│  │  - list_tools: 返回 screenshot/click/drag/move/type 等工具  ││
│  │  - call_tool: 转发给执行器                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  主机适配层 Host Adapter                                     ││
│  │  - macOS: 调用 cliclick 私有框架                             ││
│  │  - Windows/Linux: 对应系统 API                              ││
│  │  能力：截图 / 鼠标 / 键盘 / 打开应用                          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     用户电脑桌面                                  │
│  ← 截图                                                          │
│  → 鼠标点击                                                      │
│  → 键盘输入                                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 设计亮点

**应用枚举超时机制**：
```typescript
// 枚举已安装应用最多等 1000ms
const installed = await Promise.race([enumP, timeoutP])
// 超时了 → 继续启动，不带应用列表不影响功能
```
这就是**失败柔化**：非核心功能失败不影响服务启动。

**坐标模式支持**：
- 左上角原点（传统）
- 中心原点（部分模型训练使用，Chicago 模式）

---

## 第三方 MCP 服务器集成

用户可以在配置中添加自己的 MCP 服务器，Claude Code 作为 MCP 客户端连接它们：

```
┌─────────────────────────────────────────────────────────────────┐
│                     Claude Code REPL (MCP 客户端)                │
└──────────┬─────────────────────────────────────────────────────┘
           │
    ┌──────┼──────┐
    │      │      │
┌───▼──┐┌─▼──┐┌──▼────┐
│ 工具A ││工具B││ 工具C  │
│ MCP   ││MCP  ││ MCP    │
│Server ││Server│ Server │
└──────┘└─────┘└───────┘
```

**配置方式**（在 `settings.json`）：
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["my-mcp-server"],
      "env": {}
    }
  }
}
```

**运输层支持**：
- `stdio`：最常用，子进程通过标准输入输出通信
- `http`/`sse`：远程服务器，通过 SSE 流通信

---

## 关键设计点

### 1. 独立进程设计

为什么这些 MCP 服务器要作为独立进程，用快速路径启动，而不是在主 REPL 进程里？

| 原因 | 说明 |
|------|------|
| **隔离性** | MCP 服务器崩溃不影响主 REPL 进程 |
| **启动快** | 快速路径不加载完整 TUI，启动更快 |
| **可复用** | 其他客户端也可以连接这些独立服务 |
| **依赖分离** | 不同服务可以有不同依赖，不影响主程序 |

### 2. 启动流程

所有独立 MCP 服务器都遵循相同启动流程：

```typescript
enableConfigs()              // 加载配置
initializeAnalyticsSink()    // 初始化分析
create server              // 创建 MCP 服务器
use StdioServerTransport   // 使用 stdio 传输
register exit handler      // stdin end/error → 优雅关闭
  - flush analytics        //   确保事件都上报
  - cleanup socket files   //   ChromeNativeHost 需要清理
  - process.exit(0)
connect server             // 启动服务
```

### 3. 传输层选择

| 传输 | 使用场景 |
|------|---------|
| **Stdio** | 本地进程间通信，最简单可靠 |
| **Unix Domain Socket** | Chrome 原生宿主 ↔ MCP 服务器，同一机器本地通信 |
| **WebSocket** | Claude in Chrome 桥接模式，跨网络 |
| **HTTP + SSE** | 第三方远程 MCP 服务器 |

### 4. 安全考虑

| 方面 | 措施 |
|------|------|
| **权限** | UDS 文件权限 `0o600`，目录 `0o700` |
| **配对认证** | Claude in Chrome 需要设备配对 |
| **隐私** | 分析事件只上报白名单字段 |
| **用户控制** | 第三方 MCP 需要用户显式配置才能启用 |

---

## 文件位置速查

| 文件 | 作用 |
|------|------|
| `src/entrypoints/cli.tsx` | 快速路径路由，三个快速入口在这里 |
| `src/utils/claudeInChrome/mcpServer.ts` | `runClaudeInChromeMcpServer` 实现 |
| `src/utils/claudeInChrome/chromeNativeHost.ts` | `runChromeNativeHost` 实现 |
| `src/utils/claudeInChrome/common.ts` | socket 路径工具函数 |
| `src/utils/computerUse/mcpServer.ts` | `runComputerUseMcpServer` 实现 |
| `vendor/computer-use-mcp/` | Computer Use 核心实现 |
| `src/services/mcp/` | MCP 客户端连接管理（第三方 MCP） |

---

## 总结

Claude Code 的 MCP 架构是一个**分层、隔离、可扩展**的设计：

- **Claude in Chrome**：三层架构（扩展 → 原生宿主 → MCP 服务器），安全地让浏览器扩展使用本地能力
- **Computer Use**：独立 MCP 服务器，通过主机适配层支持不同操作系统
- **第三方 MCP**：标准协议接入，用户可自由扩展工具能力

核心思想：**职责分离，独立进程，标准协议，安全优先**。
