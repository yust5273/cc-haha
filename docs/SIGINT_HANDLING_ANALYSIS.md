# SIGINT 处理代码分析

代码位置：`src/main.tsx:598-606`

```typescript
process.on('SIGINT', () => {
  // In print mode, print.ts registers its own SIGINT handler that aborts
  // the in-flight query and calls gracefulShutdown; skip here to avoid
  // preempting it with a synchronous process.exit().
  if (process.argv.includes('-p') || process.argv.includes('--print')) {
    return;
  }
  // In print mode, print.ts registers its own SIGINT handler that aborts
  // the in-flight query and calls gracefulShutdown; skip here to avoid
  // preempting it with a synchronous process.exit().
  process.exit(0);
});
```

---

## 什么是 SIGINT

**SIGINT** = **Signal Interrupt**，中断信号。

当用户在终端按下 **`Ctrl+C`** 时，操作系统会给进程发送这个信号，要求它中断退出。

Node.js 默认行为：收到 SIGINT 直接退出进程。但 Claude Code 需要自定义处理。

---

## 问题：两个 SIGINT 处理器抢着处理

为什么 `main()` 这里要有一个判断，print 模式直接 return？

### 两种模式的区别

| 维度 | 交互式模式（默认） | 打印模式 `-p/--print` |
|------|-------------------|----------------------|
| 入口 | `main.tsx` 全程 | `print.ts` 处理完直接退出 |
| 功能 | React/Ink TUI 交互 | 无头打印，请求一次输出一次就退出 |
| SIGINT 需求 | 直接退出 | 需要优雅中止正在进行的 API 查询，做清理 |

---

## 为什么 print 模式不能在这里 `process.exit(0)`

### 场景：用户在 print 模式下按 `Ctrl+C`

如果这里不跳过，直接 `process.exit(0)`，会发生：

1. 用户按下 `Ctrl+C` → 触发 SIGINT
2. `main()` 注册的处理器先执行 → **同步**调用 `process.exit(0)`
3. 进程立即退出 → **`print.ts` 注册的处理器根本没机会运行**
4. 结果：正在进行的 API 请求不能被正确中止，清理代码不运行，资源泄漏

这就是注释说的 **"preempting it with a synchronous process.exit()"** → **同步退出抢占了它**。

---

### 为什么 print 模式自己处理更好

`print.ts` 的 SIGINT 处理器会做：

```typescript
// print.ts 大致逻辑
process.on('SIGINT', () => {
  // 1. 中止正在进行的 API 请求（abort controller）
  // 2. 清理资源
  // 3. 调用 gracefulShutdown 做退出清理
  // 4. 最后退出
});
```

所以需要让 `print.ts` 自己处理，这里不能抢在它前面退出。

---

## 为什么交互式模式可以直接 `process.exit(0)`

交互式模式整个 UI 是 React/Ink 管的，React/Ink 已经注册了自己的清理逻辑，当你 `process.exit(0)`，exit 事件会触发：

```typescript
process.on('exit', () => {
  resetCursor();
});
```

`resetCursor()` 会恢复光标显示，已经够了。直接退出是可以接受的。

---

## 执行顺序图解

### 错误做法（如果这里不跳过）

```
Ctrl+C → SIGINT
    ↓
main() 处理器先触发（因为先注册）
    ↓
同步 process.exit(0)
    ↓
进程立即死了 ✝️
    ↓
print.ts 处理器永远没机会跑 ❌
    ↓
API 请求不能中止，清理不做 → 资源泄漏
```

### 正确做法（现在的代码）

```
Ctrl+C → SIGINT
    ↓
main() 处理器：检查到 -p/--print → return，不退出
    ↓
print.ts 处理器跑 → 正确中止请求 → 做清理 → 优雅退出 ✅
```

---

## 知识点：Node.js 事件监听器执行顺序

Node.js 事件监听器**按照注册顺序执行**，先注册的先执行。

因为 `main()` 在模块加载时就注册了这个 `SIGINT` 监听器，而 `print.ts` 是后来导入才注册，所以 `main()` 的监听器**先执行**。

如果 `main()` 先执行并且直接退出了，后面的监听器就没机会了。

---

## 总结设计思路

| 设计决策 | 原因 |
|---------|------|
| `main()` 统一注册 SIGINT | 因为 `main()` 是入口，尽早注册 |
| print 模式跳过 | 让 print.ts 自己处理，它能正确中止查询 |
| 非 print 直接退出 | 交互式模式已经有 exit 事件做清理（resetCursor），直接退出足够 |

这个小细节体现了对 Node.js 事件模型的深刻理解：**监听器顺序 + 同步退出会抢占后续处理器**。处理不好就会出 bug，用户按 `Ctrl+C` 不能正确中止。

现在这个设计：
- ✅ 交互式模式：Ctrl+C 直接退出，resetCursor 恢复光标
- ✅ print 模式：Ctrl+C 让 print.ts 自己处理，能正确中止 API 查询
