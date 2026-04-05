# 三个 MCP 服务器入口函数实现解读

本文分析 `src/utils/` 下三个 MCP 服务器相关的入口函数：

1. `runClaudeInChromeMcpServer` - Claude in Chrome 扩展的 MCP 服务器
2. `runChromeNativeHost` - Chrome 扩展原生消息桥接宿主
3. `runComputerUseMcpServer` - 桌面控制独立 MCP 服务器

---

## 1. `runClaudeInChromeMcpServer`

**位置**：`src/utils/claudeInChrome/mcpServer.ts`

### 整体功能
启动一个 MCP 服务器，让 **Chrome 浏览器扩展 Claude for Chrome** 能够连接本地 Claude Code，使用本地 Claude Code 的能力。这样你在浏览器的 Claude 扩展，可以调用本地文件系统等能力。

### 核心流程

```typescript
export async function runClaudeInChromeMcpServer(): Promise<void> {
  enableConfigs()              // 1. 加载配置
  initializeAnalyticsSink()    // 2. 初始化数据分析
  const context = createChromeContext() // 3. 创建 Chrome 上下文
  const server = createClaudeForChromeMcpServer(context) // 4. 创建 MCP 服务器
  const transport = new StdioServerTransport() // 5. 使用 stdio 传输（标准输入输出）

  // 6. 注册退出处理：父进程退出时 flush 分析数据
  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) return
    exiting = true
    await shutdown1PEventLogging()
    await shutdownDatadog()
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())

  // 7. 启动服务器
  await server.connect(transport)
}
```

### `createChromeContext()` 做了什么

**配置桥接 URL**：
- 内部开发环境：`ws://localhost:8765`
- 测试环境：`wss://bridge-staging.claudeusercontent.com`
- 生产环境：`wss://bridge.claudeusercontent.com`
- 不启用桥接：使用本地原生 socket

**配对信息持久化**：
- 扩展配对成功后，将设备 ID/名称保存到全局配置
- 下次启动可以复用配对信息

**权限模式**：
- 通过环境变量 `CLAUDE_CHROME_PERMISSION_MODE` 配置
- 可选值：`ask`(询问用户) / `skip_all_permission_checks`(跳过检查) / `follow_a_plan`(遵循计划)

**事件追踪**：
- 只上报**白名单**的安全字段，避免泄漏用户隐私
- 比如 `bridge_status`, `error_type`, `tool_name` 允许上报
- `error_message` 这类可能含用户内容的禁止上报

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│  Claude for Chrome 浏览器扩展                                │
│  - 浏览网页时和 Claude 对话                                   │
└────────────────┬─────────────────────────────────────────────┘
                 │ (native messaging / WebSocket bridge)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  runClaudeInChromeMcpServer (本地 MCP 服务器)               │
│  - 接收浏览器发来的工具调用请求                               │
│  - 调用本地 Claude Code 工具（Read/Edit/Bash 等）            │
│  - 返回结果给浏览器                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. `runChromeNativeHost`

**位置**：`src/utils/claudeInChrome/chromeNativeHost.ts`

### 整体功能
Chrome 扩展**不能直接和本地 Unix Domain Socket 通信**，需要一个**桥接宿主**。这个程序就是 Chrome 原生消息协议（Native Messaging）的实现，在 Chrome 扩展和本地 MCP 服务器之间转发消息。

### 协议

**Chrome 原生消息协议格式**：
```
[4 字节小端长度][JSON 消息]
- 前 4 字节：消息长度（单位字节）
- 后面是 JSON 字符串
最大消息大小：1MB
```

### 核心架构

这个宿主做的事情就是**双向转发**：

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome 扩展 (浏览器)                                        │
└──────────┬──────────────────────────────────────────────────┘
           │  stdin/stdout (Chrome Native Messaging 协议)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  ChromeNativeHost (本程序)                                   │
│  │                                                           │
│  │  从 Chrome 读消息 → 转发给 MCP 服务器 (UDS)               │
│  │  从 MCP 服务器读消息 → 转发给 Chrome (stdout)             │
│  │                                                           │
└──────────┼──────────────────────────────────────────────────┘
           │  Unix Domain Socket (本地套接字)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  runClaudeInChromeMcpServer (MCP 服务器)                    │
└─────────────────────────────────────────────────────────────┘
```

### 主要职责

**启动时安全处理**：
- 创建 socket 目录，权限 `0o700`（只有当前用户可读）
- 清理僵死进程的旧 socket 文件
- 监听 socket 设置权限 `0o600`

**消息处理**：

| Chrome 消息类型 | 处理方式 |
|----------------|---------|
| `ping` | 返回 `pong` 心跳 |
| `get_status` | 返回版本号 |
| `tool_response` | 转发给 MCP 客户端 |
| `notification` | 转发给 MCP 客户端 |
| 其他 | 返回错误 |

**Unix Domain Socket 处理**：
- 支持多个 MCP 客户端连接
- 每个连接单独处理消息缓冲
- 断开连接通知 Chrome

### 设计亮点

| 设计点 | 说明 |
|--------|------|
| **纯 TypeScript 实现** | 之前是 Rust + NAPI，现在纯 TS，更易维护 |
| **权限安全** | socket 目录和文件都是 0700/0600，其他用户不能访问 |
| **惰性清理** | 启动时清理僵死 socket，文件系统干净 |
| **正常退出清理** | 退出时删除 socket 文件，不留垃圾 |
| **Bun 兼容** | 使用异步读取，避免同步读取导致 Bun 崩溃 |

---

## 3. `runComputerUseMcpServer`

**位置**：`src/utils/computerUse/mcpServer.ts`

### 整体功能
启动一个**独立的 Computer Use（桌面控制）MCP 服务器**，提供截图、鼠标、键盘控制能力，可以被任何 MCP 客户端连接使用。

### 核心流程

```typescript
export async function runComputerUseMcpServer(): Promise<void> {
  enableConfigs()              // 加载配置
  initializeAnalyticsSink()    // 初始化分析

  // 创建服务器（带已安装 App 枚举）
  const server = await createComputerUseMcpServerForCli()

  const transport = new StdioServerTransport() // stdio 传输

  // 退出处理：flush 分析数据
  let exiting = false
  const shutdownAndExit = async (): Promise<void> => {
    if (exiting) return
    exiting = true
    await Promise.all([shutdown1PEventLogging(), shutdownDatadog()])
    process.exit(0)
  }
  process.stdin.on('end', () => void shutdownAndExit())
  process.stdin.on('error', () => void shutdownAndExit())

  await server.connect(transport)
}
```

### `createComputerUseMcpServerForCli` 亮点：应用枚举超时

```typescript
const installedAppNames = await tryGetInstalledAppNames()
const tools = buildComputerUseTools(
  adapter.executor.capabilities,
  coordinateMode,
  installedAppNames,
)
```

**为什么需要超时**：
- 枚举已安装应用需要调用系统 API（macOS 是 Spotlight）
- 如果 Spotlight 卡了，不能让整个服务器卡住
- 超时设置 1000ms，超时就继续启动，工具描述里不带应用列表
- 应用不影响实际调用，只是给模型的提示

```typescript
const enumP = adapter.executor.listInstalledApps()
const timeoutP = new Promise<undefined>(resolve => {
  timer = setTimeout(resolve, APP_ENUM_TIMEOUT_MS, undefined)
})
const installed = await Promise.race([enumP, timeoutP])
  .catch(() => undefined)
  .finally(() => clearTimeout(timer))
```

这个就是**失败柔化**设计：就算枚举失败，服务还是能启动，不影响核心功能。

### 坐标模式

```typescript
const coordinateMode = getChicagoCoordinateMode()
```

Chicago 是内部项目代号，坐标模式有两种：
- **左上角原点**：传统方式
- **中心原点**：某些 Computer Use 模型训练用的是中心坐标

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│  任何 MCP 客户端                                             │
│  Claude Code / 其他客户端                                    │
└──────────┬──────────────────────────────────────────────────┘
           │  stdio MCP 协议
           ▼
┌─────────────────────────────────────────────────────────────┐
│  runComputerUseMcpServer                                     │
│  - 工具：screenshot, left_click, right_click, double_click  │
│  - drag, cursor_move, scroll, type_text, press_key          │
│  - open_app, wait                                            │
│  根据系统适配不同实现（macOS 使用 cliclick 私有框架）        │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  你的电脑桌面                                                │
│  ← 截图 ←                                                   │
│  → 鼠标点击 →                                               │
│  → 键盘输入 →                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 三个服务器对比总结

| 维度 | `runClaudeInChromeMcpServer` | `runChromeNativeHost` | `runComputerUseMcpServer` |
|------|------------------------------|-----------------------|---------------------------|
| **作用** | Claude in Chrome MCP 服务端 | Chrome ↔ MCP 桥接 | 桌面控制独立服务 |
| **客户端** | Chrome 扩展 | Chrome 扩展 | 任意 MCP 客户端 |
| **传输** | stdio MCP | Chrome 原生协议 ↔ UDS | stdio MCP |
| **依赖** | 需要桥接/原生宿主 | 无（纯桥接） | 需要系统能力 |
| **退出处理** | flush 分析数据 | 清理 socket 文件 | flush 分析数据 |

---

## 共同设计模式

三个实现都遵循相同的模式：

### 1. **快速路径启动**
- 在 `cli.tsx` 就提前处理，动态导入
- 不需要加载完整 Ink/React TUI，启动快

### 2. **标准退出处理**
```typescript
process.stdin.on('end', shutdownAndExit)
process.stdin.on('error', shutdownAndExit)
```
因为用 stdio 传输，父进程关闭连接后，stdin 会收到 end 事件，此时优雅退出并 flush 数据。

### 3. **分析数据正确关闭**
```typescript
await shutdown1PEventLogging()
await shutdownDatadog()
```
退出前确保所有事件都上报完成，不丢最后一批数据。

### 4. **配置初始化**
```typescript
enableConfigs()
initializeAnalyticsSink()
```
因为是独立进程，必须自己初始化配置和分析。

---

## 设计精髓

这三个 MCP 服务器入口体现了几个重要设计原则：

1. **单一职责**：每个程序只做好一件事
2. **独立进程**：崩溃不影响主 Claude Code REPL
3. **按需加载**：只有使用对应功能才加载对应代码，不影响正常启动速度
4. **失败柔化**：非核心功能失败不影响启动（如应用枚举超时）
5. **安全性**：socket 权限严格控制，隐私数据不上报
6. **可复用**：独立服务器可以被不同客户端连接使用

---

## 文件位置汇总

| 文件 | 说明 |
|------|------|
| `src/utils/claudeInChrome/mcpServer.ts` | Claude in Chrome MCP 服务器实现 |
| `src/utils/claudeInChrome/chromeNativeHost.ts` | Chrome 原生消息桥接实现 |
| `src/utils/claudeInChrome/common.ts` | 公用 socket 路径函数 |
| `src/utils/computerUse/mcpServer.ts` | Computer Use MCP 服务器实现 |
| `vendor/computer-use-mcp/index.js` | Computer Use 核心代码 |
