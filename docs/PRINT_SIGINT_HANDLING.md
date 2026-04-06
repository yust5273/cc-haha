# print 模式 SIGINT (Ctrl+C) 完整处理逻辑

**文件位置**：[src/cli/print.ts:1024-1034](src/cli/print.ts#L1024-L1034)

```typescript
// Ctrl+C in -p mode: abort the in-flight query, then shut down gracefully.
// gracefulShutdown persists session state and flushes analytics, with a
// failsafe timer that force-exits if cleanup hangs.
const sigintHandler = () => {
  logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGINT' })
  if (abortController && !abortController.signal.aborted) {
    abortController.abort()
  }
  void gracefulShutdown(0)
}
process.on('SIGINT', sigintHandler)
```

---

## 逐行解释

### 1. 注释说的是什么意思

```
// Ctrl+C in -p mode: abort the in-flight query, then shut down gracefully.
// gracefulShutdown persists session state and flushes analytics, with a
// failsafe timer that force-exits if cleanup hangs.
```

翻译成人话：
> 用户在 print 模式按 Ctrl+C：
> 1. 立刻**中止正在飞的 API 请求**（别让它继续跑了）
> 2. 然后**优雅关闭** → 保存会话状态，把所有数据分析事件刷出去
> 3. 如果清理卡住不动，有**保险计时器** → 超时强制退出

---

### 2. `logForDiagnosticsNoPII`

```typescript
logForDiagnosticsNoPII('info', 'shutdown_signal', { signal: 'SIGINT' })
```

- 记录日志，用于调试
- `NoPII` = 不包含用户可识别信息 → 隐私安全
- 只记"我们收到 SIGINT 了"，不记用户内容

---

### 3. 中止 API 请求

```typescript
if (abortController && !abortController.signal.aborted) {
  abortController.abort()
}
```

#### `AbortController` 是什么？

这是浏览器/Node.js 标准 API，用于**取消异步请求**：

- 正在进行的 Anthropic API 请求用 `abortController` 控制
- 用户按 Ctrl+C → 我们立刻告诉 API 请求"你别跑了，取消吧"
- 如果已经取消过了，就不要再取消一次

**为什么必须中止**？
- 如果不中止，API 请求会继续在后台跑
- 流量会继续算钱，模型占用资源
- 你按 Ctrl+C 就是想让它停，必须真停下

---

### 4. 优雅关闭

```typescript
void gracefulShutdown(0)
```

**`gracefulShutdown(exitCode)` 做什么**：

1. **保存会话状态** → 会话元数据保存到磁盘，`--continue` 下次能恢复
2. **刷出数据分析** → 所有缓存的分析事件写到网络，不丢数据
3. **清理资源** → 关闭 MCP 连接、关闭文件句柄等
4. **超时保险** → 如果清理卡住超过 N 秒，**强制退出**，不能僵死

**为什么用 `void`**：
- 不需要等它完成
- 它自己会处理完退出
- 信号处理器不能阻塞太久

---

## 完整 SIGINT 处理流程图

```
用户按 Ctrl+C
    ↓
操作系统发 SIGINT 信号给进程
    ↓
print.ts sigintHandler 运行
    ↓
记日志 → 中止 abortController → 调用 gracefulShutdown
    ↓
gracefulShutdown:
    ├─ 保存会话到磁盘
    ├─ 刷出所有 analytics 事件
    ├─ 清理资源
    └─ 如果超时 → 强制退出
    ↓
进程退出
```

---

## 和 main.ts 全局 SIGINT 对比

| 位置 | 处理逻辑 | 为什么不一样 |
|------|----------|-------------|
| **main.ts 全局** | `if (-p) return; else process.exit(0);` | print 需要先中止 API，main 不知道有 API 需要中止 |
| **print.ts 自己** | `中止 API →  gracefulShutdown → 退出` | print 知道当前有什么请求在飞，能正确清理 |

---

## 为什么 main.ts 不能帮 print 处理？

因为：
- main.ts **不知道** print 现在有 API 请求在飞
- main.ts **没有** `abortController` 引用
- 所以只能 **print 自己处理** → main 看到 `-p` 就跳过，让 print 来

这就是之前说的"**谁干活谁收拾**"，责任清晰。

---

## 一句话总结

> **用户按 Ctrl+C → print 立刻中止当前 API 请求 → 保存会话 → 清理资源 → 优雅退出**

比 main.ts 直接退出好在哪里：
- ✅ API 请求真正停下，不后台跑浪费钱
- ✅ 会话保存，下次 `--continue` 能恢复
- ✅ 数据分析不丢点
- ✅ 卡住也有保险强制退出，不会死锁
