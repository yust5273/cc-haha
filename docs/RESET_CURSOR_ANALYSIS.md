# `resetCursor()` 函数分析

**代码位置**：`src/main.tsx:4781-4783`

```typescript
function resetCursor() {
  const terminal = process.stderr.isTTY ? process.stderr : process.stdout.isTTY ? process.stdout : undefined;
  terminal?.write(SHOW_CURSOR);
}
```

---

## 功能

**程序退出时恢复终端光标显示**。

为什么需要这个？因为交互式 TUI 程序运行时会**隐藏光标**（让 Ink React 渲染更好看），如果程序异常退出，不恢复光标，用户接下来在终端输入就看不到光标了，非常困惑。

---

## 逐行分析

### 第一步：找哪个流是终端

```typescript
const terminal = process.stderr.isTTY ? process.stderr : process.stdout.isTTY ? process.stdout : undefined;
```

#### `isTTY` 是什么？

`xx.isTTY` 是 Node.js 提供的属性，判断这个流是否连接到终端（TTY = Teletypewriter，就是终端的老名字）。

- `true` → 这是一个终端，可以发送 ANSI 转义序列控制光标
- `false` → 这是管道/文件/网络流，不是终端

#### 为什么先检查 `stderr` 再检查 `stdout`？

因为可能出现这种情况：

| 情况 | 哪个是 TTY |
|------|------------|
| `claude` 正常交互 | stdout 和 stderr 都是 TTY → 选 stderr |
| `claude | grep ...` | stdout 是管道（不是 TTY），stderr 还是 TTY → 选 stderr |
| `claude 2>&1 > output.txt` | stderr 重定向到文件（不是 TTY），stdout 也不是 → undefined |

**设计思路**：优先选 stderr，因为就算 stdout 被管道重定向，stderr 通常还是连终端的，还是能恢复光标。

如果两个都不是终端，那就是脚本/管道调用，不需要恢复光标，设为 `undefined`。

---

### 第二步：发送显示光标转义序列

```typescript
terminal?.write(SHOW_CURSOR);
```

- `SHOW_CURSOR` 是什么？看定义：
  ```typescript
  // src/ink/termio/dec.ts
  export const SHOW_CURSOR = decset(DEC.CURSOR_VISIBLE)
  ```
  展开就是 **ANSI 转义序列 `\x1b[?25h`** → 这个序列告诉终端 "显示光标"。

- `terminal?write(...)`：可选链，如果 `terminal` 是 `undefined`（两个都不是 TTY），就什么也不做，不会报错。

---

## `SHOW_CURSOR` vs `HIDE_CURSOR`

配对使用：

| 常量 | ANSI 序列 | 作用 |
|------|-----------|------|
| `HIDE_CURSOR` | `\x1b[?25l` | 隐藏光标 |
| `SHOW_CURSOR` | `\x1b[?25h` | 显示光标 |

Claude Code 在进入交互式 TUI 时 `HIDE_CURSOR`，退出时 `resetCursor()` → `SHOW_CURSOR`。

---

## 什么时候调用 `resetCursor()`

在 `main.tsx` 第 595 行：

```typescript
process.on('exit', () => {
  resetCursor();
});
```

**进程退出事件**一定会触发，所以不管怎么退出，都会帮你把光标显示回来。

---

## 设计亮点

### 1. **鲁棒性**

优先 stderr → 再 stdout → 都不行就 undefined 什么也不做。覆盖了各种重定向场景：

- 正常交互 ✅
- stdout 管道 ✅  stderr 还是终端，能恢复
- 都不是终端 ✅ 什么也不做，不报错

### 2. **安全**

可选链 `terminal?.write`，不会在非终端环境报错。

### 3. **用户体验**

就算程序崩溃退出，光标也能回来，不会留给用户一个看不到光标的终端，减少用户困惑。

---

## 完整流程图

```
┌─────────────────────────────────────────────────────────┐
│  process exit 事件触发                                      │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  检查 process.stderr.isTTY ?                              │
│  ├─ 是 → terminal = stderr                                 │
│  └─ 否 → 检查 process.stdout.isTTY ?                        │
│     ├─ 是 → terminal = stdout                              │
│     └─ 否 → terminal = undefined                            │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  terminal ? 存在 → 写入 SHOW_CURSOR (\x1b[?25h)           │
│          不存在 → 什么都不做                                │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│  完成：光标恢复显示，进程退出                                │
└─────────────────────────────────────────────────────────┘
```

---

## 总结

这个函数只有 3 行，但非常重要：

- **解决的问题**：程序退出后终端光标一直隐藏，用户看不到输入
- **设计思路**：优先 stderr 能覆盖更多重定向场景，可选链安全处理非终端
- **用户体验**：不管怎么退出，光标总能回来，干净离场

这就是**细节处理**——看似简单一行，其实考虑了各种边界情况，给用户干净一致的体验。
