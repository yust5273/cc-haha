# 系统提示词设计分析 - 架构师视角

本文对 `docs/系统提示词.md` 这份转储出来的完整系统提示词，从架构师角度进行设计分析。

---

## 目录

- [整体结构分层](#整体结构分层)
- [安全治理：内化而非外围控制](#安全治理内化而非外围控制)
- [行为准则：每条都踩过坑](#行为准则每条都踩过坑)
- [风险治理：给模型明确的决策树](#风险治理给模型明确的决策树)
- [工具设计：结构化优于自由Bash](#工具设计结构化优于自由bash)
- [输出约束：从格式到内容两层简洁](#输出约束从格式到内容两层简洁)
- [Prompt Caching 架构验证](#prompt-caching-架构验证)
- [auto memory：创新的持久化记忆设计](#auto-memory创新的持久化记忆设计)
- [整体评价](#整体评价)

---

## 整体结构分层

```
┌─────────────────────────────────────────────────────────────┐
│  安全红线（必须最先看）                                           │
│  - IMPORTANT: 哪些安全请求允许，哪些必须拒绝                     │
├─────────────────────────────────────────────────────────────┤
│  系统框架规则                                                   │
│  - 输出格式、权限模型、系统标签、钩子、上下文压缩               │
├─────────────────────────────────────────────────────────────┤
│  做事方法论                                                   │
│  - 软件工程任务的总体行为准则                                   │
├─────────────────────────────────────────────────────────────┤
│  风险治理                                                     │
│  - 哪些操作需要用户确认，怎么处理风险                           │
├─────────────────────────────────────────────────────────────┤
│  工具使用规范                                                 │
│  - 优先专用工具，Bash 留给真正需要shell的场景                   │
│  - 能并行就并行                                               │
├─────────────────────────────────────────────────────────────┤
│  输出风格                                                     │
│  - 简洁、emoji 规则、导航格式                                   │
├─────────────────────────────────────────────────────────────┤
│  输出效率                                                     │
│  - 直扑主题，废话少说                                         │
├─────────────────────────────────────────────────────────────┤
│  __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ 分界线                      │
├─────────────────────────────────────────────────────────────┤
│  动态：auto memory 记忆系统规则                                 │
│  - 四种记忆分类、什么该存什么不该存、怎么存、怎么用             │
├─────────────────────────────────────────────────────────────┤
│  动态：当前环境信息                                           │
│  - CWD、git、平台、shell、模型版本                             │
└─────────────────────────────────────────────────────────────┘
```

**架构亮点：**
1. **安全第一**：安全红线放在最开头，模型最先看到，权重最高
2. **从抽象到具体**：先定大原则，再讲具体操作规范
3. **分界清晰**：静态不变规则 ↔ 动态可变内容，一目了然
4. **配合 Prompt Caching**：正好符合我们之前分析的缓存设计

---

## 安全治理：内化而非外围控制

开头第二段就是安全规则：

```
IMPORTANT: Assist with authorized security testing, defensive security,
CTF challenges, and educational contexts.
Refuse requests for destructive techniques, DoS attacks, mass targeting,
supply chain compromise, or detection evasion for malicious purposes.
Dual-use security tools (C2 frameworks, credential testing, exploit development)
require clear authorization context: pentesting engagements, CTF competitions,
security research, or defensive use cases.
```

**设计思想：**
- 不是只靠外围防火墙、权限控制
- **直接把安全规则告诉模型**，模型自己做第一道判断
- 明确说了**两用工具需要明确授权上下文**，堵住灰色地带
- 这就是**治理内化**，把安全做进提示词，而不是只依赖外围

---

## 行为准则：每条都踩过坑

`Doing tasks` 这一节，每一条规则都是从大量用户反馈总结出来的，解决了LLM常见问题：

| 规则 | 解决什么问题 |
|------|-------------|
| `Don't add features, refactor code, or make "improvements" beyond what was asked.` | 模型总想"顺便优化"，用户只想要修bug，结果被改了一堆东西 |
| `Don't add docstrings, comments, or type annotations to code you didn't change.` | 模型喜欢画蛇添足，给没改的代码也加上注释 |
| `Don't add error handling, fallbacks, or validation for scenarios that can't happen.` | 模型过度防御，加一堆不会发生情况的处理 |
| `Don't create helpers, utilities, or abstractions for one-time operations.` | 模型喜欢过早抽象，一次性代码也要抽成helper |
| `If you are certain that something is unused, you can delete it completely.` | 模型喜欢留着兼容垃圾代码，其实直接删掉更干净 |

**结论：每一条规则都对应模型一个常见"坏习惯"，都是亿轮对话踩坑踩出来的。**

---

## 风险治理：给模型明确的决策树

`Executing actions with care` 这一节是**风险分层决策框架**：

```
Carefully consider the reversibility and blast radius of actions.
- Generally you can freely take local, reversible actions (editing files/running tests)
- But for actions that are hard to reverse, affect shared systems...
  check with the user before proceeding
```

还给了**具体例子分类**：

| 需要确认的操作类别 | 例子 |
|------------------|------|
| 破坏性操作 | deleting files/branches, dropping database tables, rm -rf |
| 难逆转操作 | force-pushing, git reset --hard, modifying CI/CD pipelines |
| 对他人可见操作 | pushing code, creating PRs, sending messages |
| 上传第三方 | 考虑内容敏感，即使删除可能还被缓存索引 |

**设计价值：**
- 把人类的风险决策经验直接编码进去
- 模型不用自己摸索，直接按框架走
- 默认安全：不确定就问，"measure twice, cut once"

---

## 工具设计：结构化优于自由Bash

```
Do NOT use the Bash to run commands when a relevant dedicated tool is provided.
- To read files use Read instead of cat, head, tail, or sed
- To edit files use Edit instead of sed or awk
- To create files use Write instead of cat with heredoc or echo redirection
- To search for files use Glob instead of find or ls
- To search the content of files, use Grep instead of grep or rg
- Reserve using the Bash exclusively for system commands and
  terminal operations that require shell execution.
```

**架构思考深度：**

| 方式 | 优点 | 缺点 |
|------|------|------|
| 结构化专用工具 | 参数结构化，权限检查容易，用户审核清晰，可回放 | 需要定义更多工具 |
| 自由Bash | 灵活什么都能干 | 用户难审核，安全风险大，日志难解析，不易回放 |

Claude Code 选择了**结构化优先**，这对软件工程场景非常合适：
- 用户能看懂你要调用什么工具，做了什么
- 框架能做权限检查，危险操作拦住
- 后续可以回放、审计

---

## 输出约束：从格式到内容两层简洁

### 第一层 `Tone and style`（格式约束）
- Only use emojis if the user explicitly requests it
- Your responses should be short and concise
- When referencing specific functions: include `file_path:line_number`
- When referencing GitHub issues: use `owner/repo#123` format

### 第二层 `Output efficiency`（内容约束）
```
IMPORTANT: Go straight to the point.
Try the simplest approach first without going in circles.
Do not overdo it. Be extra concise.

Keep your text output brief and direct.
Lead with the answer or action, not the reasoning.
Skip filler words, preamble, and unnecessary transitions.
Do not restate what the user said — just do it.

Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan
```

这对CLI产品体验至关重要：
- 终端屏幕小，不需要散文
- 用户打开终端就是来干活的，要看答案，要看操作，不是来看你聊天
- 反复强调"不废话，直扑主题"，模型才能get到

---

## Prompt Caching 架构验证

这份实际转储完美验证了我们之前的分析：

```
...
If you can say it in one sentence, don't use three.
Prefer short, direct sentences over long explanations.
This does not apply to code or tool calls.
__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__
# auto memory
...
# Environment
You have been invoked in the following environment:
 - Primary working directory: /Users/songtaoyu/cc-haha
 ...
```

✅ 验证点：
1. 所有静态内容都在边界**之前**
2. 所有动态内容都在边界**之后**
3. 边界标记本身只给客户端代码看，模型能看到但不影响（就是个分隔）
4. 正好符合 `splitSysPromptPrefix()` 的切分逻辑

---

## auto memory：创新的持久化记忆设计

这是一个很有意思的创新设计：**把跨会话记忆放在本地文件，而不是全靠LLM上下文窗口**。

### 四种记忆类型，分工清晰

| 类型 | 用途 |
|------|------|
| `user` | 用户角色、知识水平、偏好 → 用来调整回答风格，比如对资深工程师不用讲基础概念 |
| `feedback` | 用户纠正过什么、确认过什么 → 不用用户重复说第二遍，一次纠正永久生效 |
| `project` | 项目背景、当前任务、截止日期、约束 → 跨会话记住上下文，不用每次重复说 |
| `reference` | 外部资源位置 → 哪里能找到什么信息 |

### 明确说了**什么不该存**

```
- Code patterns, conventions, architecture, file paths, or project structure
  — these can be derived by reading the current project state.
- Git history, recent changes, or who-changed-what — git log/blame are authoritative.
- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context.
- Anything already documented in CLAUDE.md files.
- Ephemeral task details: in-progress work, temporary state, current conversation context.
```

**设计思想：**
- 不存能从代码仓库推出来的东西
- 只存**不能从代码仓库直接推导**的信息（用户偏好、背景上下文、外部链接）
- 避免记忆腐烂：如果信息已经在代码里了，让代码说了算

### 两阶段保存

```
Step 1: 写记忆文件 xxx.md（带frontmatter）
Step 2: 在 MEMORY.md 加索引入口
```

这样：
- MEMORY.md 总能放下，超过200行自动截断，保证不会太占context
- 具体内容存在单独文件，要用的时候再读
- 按主题组织，方便更新删除

---

## 整体评价

| 维度 | 评价 |
|------|------|
| **完整性** | 从安全 → 行为 → 风险 → 工具 → 输出 → 记忆 → 环境，全覆盖 |
| **层次性** | 从一般原则到具体例子，逐步深入，结构清晰 |
| **实践性** | 每条规则都解决真实问题，不是空想，都是踩坑踩出来的 |
| **可演进** | 静态/动态分离配合 Prompt Caching，架构支持持续演进 |
| **工业化** | 考虑了缓存配额、安全治理、用户体验等产品级问题 |

---

## 一句话总结

> 这不是一个简单的"你是一个助手"，这是一本**"软件工程代理操作手册"**，把Anthropic做Claude Code这么久积累的最佳实践全编码进去了。每个章节都解决一类问题，每个规则都踩过坑，结构清晰，配合 Prompt Caching 架构，兼顾了成本、正确性和可演进性。
