# `getOutputEfficiencySection()` 函数解读

## 函数位置
`src/constants/prompts.ts:420-445`

## 功能：输出效率 - 要求简洁直接

这一节对**输出内容**提出了**效率要求**：**废话少说，直扑主题**。

---

## 分环境：内部用户 vs 普通用户

```typescript
if (process.env.USER_TYPE === 'ant') {
  // 给内部员工更详细的交流规范
  return 长版本
}
return 短版本 // 给普通用户
```

### 短版本（给普通用户）

```
# Output efficiency

IMPORTANT: Go straight to the point.
Try the simplest approach first without going in circles.
Do not overdo it. Be extra concise.

Keep your text output brief and direct.
Lead with the answer or action, not the reasoning.
Skip filler words, preamble, and unnecessary transitions.
Do not restate what the user said — just do it.
When explaining, include only what is necessary for the user to understand.

Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan

If you can say it in one sentence, don't use three.
Prefer short, direct sentences over long explanations.
This does not apply to code or tool calls.
```

核心要求：

| 要求 | 说明 |
|------|------|
| `Go straight to the point` | 直接说要点，不要绕圈子 |
| `Try the simplest approach first` | 简单能解决就不要搞复杂 |
| `Be extra concise` | 格外简洁 |
| `Lead with the answer/action` | 先给答案/动作，再说原因 |
| `Skip filler words/preamble` | 不要废话开场白 |
| `Do not restate what the user said` | 不要重复用户说了什么 |
| **Focus 三个场景** | 只输出这三种内容：<br>1. 需要用户决策的<br>2. 自然里程碑的状态更新<br>3. 改变计划的错误/阻塞 |
| `This does not apply to code or tool calls` | 代码和工具调用不受这个约束 |

### 长版本（给内部员工）

更长更详细，主要讲**怎么写用户能看懂的文本**：

| 原则 | 说明 |
|------|------|
| `Before first tool call, state what you'll do` | 用户看不到工具调用，所以开始干活前要说一声 |
| `Give short updates at key moments` | 找到bug、换方向、有进展，要给用户说一声 |
| `Assume user lost the thread` | 用户可能走开又回来，所以要能从头读明白 |
| `Complete sentences, no unexplained jargon` | 用完整句子，解释技术术语 |
| `Adapt to user expertise` | 专家可以更简洁，新手要多解释 |
| `Avoid hard-to-parse content` | 避免碎片、太多破折号、奇怪符号 |
| `Tables only when appropriate` | 只在放枚举事实/数据时用表格 |
| `Read linearly` | 不要语义回溯，让人读一遍就能懂 |
| `Reader understanding > brevity` | 可读性比简短更重要，不要为了短让人看不懂 |
| `Get straight to the point, no fluff` | 还是要求直接，不要废话 |

---

## 在整个系统提示词中的位置

```
...
getSimpleToneAndStyleSection → 语气格式
getOutputEfficiencySection ← 【这里就是它】输出效率
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ → 分界
...
```

顺序：格式规范 → 内容效率 → 分界 → 动态内容。逻辑正确。

---

## 和 getSimpleToneAndStyleSection 有什么区别

| `getSimpleToneAndStyleSection` | `getOutputEfficiencySection` |
|------------------------------|------------------------------|
| 关注**格式**：emoji、链接格式、代码引用格式 | 关注**内容**：说什么，先说什么后说什么 |
| 格式规范让输出排版好看 | 内容效率让输出直截了当，不浪费用户时间 |

两者互补：一个管**长什么样**，一个管**说什么内容**。

---

## 设计亮点

| 设计点 | 评价 |
|------|------|
| **分环境** | 内部用户需要更详细的交流指导，普通用户只需要简洁要求，分开处理 |
| **focus 清晰** | 明确告诉模型应该输出什么，不应该输出什么 |
| **三分类focus** | 只需要输出"需要决策/状态更新/错误阻塞"，其他不用说 |
| **不影响代码/工具** | 只约束文本输出，代码和工具调用不受影响，正确 |

---

## 总结

这一节的目标就是**让模型输出更高效**：
- 少废话，多做事
- 先给答案，再说理由
- 只输出有用的，不输出没用的
- 保证用户能看懂，不浪费用户时间

对终端交互来说，这非常重要——屏幕空间有限，用户时间宝贵，所以要求格外严格。
