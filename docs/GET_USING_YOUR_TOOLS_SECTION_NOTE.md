# `getUsingYourToolsSection()` 函数解读

## 函数位置
`src/constants/prompts.ts:286-331`

## 输入输出

**输入**：`enabledTools: Set<string>` → 当前会话启用了哪些工具

**输出**：格式化好的 `# Using your tools` 提示章节

---

## 功能：工具使用规范

告诉模型**怎么正确调用工具**，核心原则是：**优先使用专用工具，Bash 留给真正需要 shell 的场景**。

---

## 分层处理：REPL 模式 vs 正常模式

```typescript
if (isReplModeEnabled()) {
  // REPL 模式下，专用工具已经隐藏，只需要任务管理提醒
  return 只讲任务工具的使用
}
// 正常模式，讲完整的工具使用规范
```

### REPL 模式是什么

REPL = Read-Eval-Print Loop 交互式模式。在 REPL 模式下，`Read/Write/Edit/Glob/Grep/Bash/Agent` 这些工具已经是框架底层，对用户透明，所以 "prefer dedicated tools over Bash" 这个指导在这里无关，不需要讲。

---

## 正常模式核心规则

### 1. **专用工具优先于 Bash**

| 操作 | 应该用这个专用工具 | 不要用 |
|------|---------------------|--------|
| 读文件 | `Read` | `cat head tail sed` |
| 编辑文件 | `Edit` | `sed awk` |
| 创建文件 | `Write` | `cat with heredoc echo >` |
| 搜文件 | `Glob` (如果没内嵌搜索) | `find ls` |
| 搜内容 | `Grep` (如果没内嵌搜索) | `grep rg` |

### 2. **Bash 应该什么时候用**

```
Reserve using the Bash exclusively for:
system commands and terminal operations that require shell execution.

If you are unsure and there is a relevant dedicated tool,
default to using the dedicated tool,
only fallback on Bash if it is absolutely necessary.

Do NOT use Bash when a relevant dedicated tool is provided.
```

**为什么要这样设计？**

| 维度 | 专用工具 | Bash 自由文本 |
|------|------------|--------------|
| 用户审核 | 参数结构化，用户一眼知道要做什么 | 自由文本，用户需要解析，难审核 |
| 安全可控 | 框架可以做权限检查 | 很难控制，安全风险大 |
| 可观测性 | 框架知道你在做什么，可以日志、回放 | 黑盒，框架不知道具体做什么 |

所以 Claude Code 选择了**结构化优先**，这对软件工程场景非常合适。

### 3. **任务工具使用**

如果启用了 `TaskCreate` 或 `TodoWrite` 工具：

```
Break down and manage your work with the task tool.
Mark each task as completed as soon as you are done with the task.
Do not batch up multiple tasks before marking them as completed.
```

指导模型怎么正确用任务管理：做完一个标记一个，不要攒一堆。

### 4. **并行调用**

```
You can call multiple tools in a single response.
If no dependencies → parallel → increase efficiency
If dependencies → sequential → one after another
```

告诉模型：**能并行就并行**，节省轮次，更快完成。

---

## 优化：内嵌搜索工具处理

```typescript
// Ant-native builds alias find/grep to embedded bfs/ugrep
// remove the dedicated Glob/Grep tools → skip guidance
const embedded = hasEmbeddedSearchTools()
```

如果已经有内嵌的搜索工具（BFS/ugrep），并且隐藏了专用的 Glob/Grep 工具，就不要提示模型用 Glob/Grep 了，避免混淆。

---

## 在整个系统提示词中的位置

```
getSimpleIntro     → 开篇
getSimpleSystem   → 框架规则
getSimpleDoingTasks → 做事准则
getActionsSection → 风险治理
getUsingYourToolsSection ← 【这里就是它】工具使用规范
...
```

顺序：讲完做事和风险，再讲具体怎么用工具 → 逻辑递进正确。

---

## 设计亮点

| 设计点 | 评价 |
|------|------|
| **结构化优先** | 坚持专用工具优先于自由 Bash，安全、可审核、可观测 |
| **适配不同模式** | REPL 模式和正常模式不一样，分别处理 |
| **优化内嵌场景** | 如果已经有内嵌搜索，就不重复提示 |
| **并行调用指导** | 告诉模型能并行就并行，提升效率 |
| **一条规则一件事** | 清晰明了，模型容易理解 |

---

## 总结

这一节定义了 Claude Code 的**工具调用哲学**：**结构化优先，专用工具比自由 Bash 更好**。这不是技术限制，是**产品设计选择**——让用户更容易审核你的操作，让框架更容易做安全控制，最终体验更好。
