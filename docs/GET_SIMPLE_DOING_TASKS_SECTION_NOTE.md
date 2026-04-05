# `getSimpleDoingTasksSection()` 函数解读

本文解读 `src/constants/prompts.ts` 中的 `getSimpleDoingTasksSection()` 函数，这是 Claude Code 系统提示词定义**软件工程任务核心行为准则**的地方。

---

## 函数概述

```typescript
function getSimpleDoingTasksSection(): string {
  1. codeStyleSubitems ← 代码风格具体规则
  2. userHelpSubitems ← 用户帮助指引
  3. items ← 总体做事准则 + codeStyleSubitems + 用户帮助
  4. return "# Doing tasks" + 项目符号列表
}
```

**位置**：`src/constants/prompts.ts:211-269`

---

## 第一层：总体做事准则

| 规则 | 解决什么问题 |
|------|-------------|
| `The user will primarily request you to perform software engineering tasks...` | 定位身份：你是软件工程助手，不是聊天AI。举例：用户说"改方法名到snake case"，**不要只回复方法名，要找到代码实际修改** |
| `You are highly capable... defer to user judgement about whether a task is too large` | 摆正位置：用户判断任务规模，你执行，不要自己决定做不做 |
| `In general, do not propose changes to code you haven't read... read it first` | 防止幻觉：不要瞎改你没读过的文件，先读再改 |
| `Do not create files unless absolutely necessary... prefer editing existing` | 防止仓库膨胀：尽量不改就不要新建文件 |
| `Avoid giving time estimates... Focus on what needs to be done` | 用户不关心你猜要多久，专注做事就好 |
| `If an approach fails, diagnose why... don't retry blindly, don't abandon after one failure` | 错误处理：失败要诊断，不要瞎重试也不要轻易放弃 |
| `Be careful not to introduce security vulnerabilities... if you wrote it, fix it immediately` | 安全第一：引入漏洞要立刻修复 |

这几条是**最基本的定位**，告诉模型"你是谁，该怎么干活"。

---

## 第二层：代码风格规则 `codeStyleSubitems`

这几条是**约束过度设计**，解决 LLM 天生喜欢"多做一点"的问题：

| 规则 | 解决什么问题 | 设计思想 |
|------|-------------|---------|
| `Don't add features/refactor beyond what was asked` | LLM 喜欢"顺便优化"，用户只想要修bug，结果被改了一堆东西 | **只做要求的，不做额外的"改进"** |
| `Don't add docstrings/comments to code you didn't change` | LLM 喜欢画蛇添足，没改的代码也要加注释 | 不动的代码不动它 |
| `Don't add error handling for scenarios that can't happen` | LLM 喜欢过度防御，加一堆永远不会执行的错误处理 | 只在系统边界做校验（用户输入、外部API） |
| `Don't use feature flags/backwards-compatibility shims when you can just change code` | LLM 喜欢留后路，其实直接改更干净 | 要改就直接改，不要畏首畏尾 |
| `Don't create abstractions/helpers for one-time operations` | LLM 喜欢过早抽象，一次性代码也要抽 | **三次重复再抽象，一次就别瞎抽**，"三行重复胜过一次过早抽象" |
| `If something is unused, delete it completely` | LLM 喜欢留着兼容，其实删掉更干净 | 不要`// removed`注释，直接删掉 |

**核心设计思想：KISS + YAGNI**
> **KISS** = Keep It Simple, Stupid\n
> **YAGNI** = You Ain't Gonna Need It
>
> 就是说：不要给你不需要的东西提前设计，保持简单。

这几条规则每一条都对应 LLM 的一个常见"坏习惯"，都是无数用户反馈踩坑踩出来的。

---

## 第三层：针对新版本模型的特定纠正（内部验证阶段）

代码里看到很多 `process.env.USER_TYPE === 'ant'` 条件加载：

| 规则 | 针对什么模型问题 |
|------|-----------------|
| **注释规则** (`Default to writing no comments`) | Capybara v8 默认过度注释，所以约束它：只在"why不明显"的时候才加注释，"what"不用解释（好命名已经解释了） |
| **不要解释代码做什么** | 好命名已经说了，注释放PR，不要放代码里 |
| **不要乱删已有注释** | 看起来没用的注释可能藏着历史经验，删代码才删注释 |
| **完成前要验证** (`Before reporting complete, verify it works`) | Capybara v8 有时候做完不验证就说完成了，所以强制要求验证 |
| **你是合作者，不是执行者** (`If user request is wrong, speak up`) | Capybara v8 过度顺从，用户错了也不说，所以鼓励它指出问题 |
| **如实报告结果** (`Never claim all tests pass if they don't`) | Capybara v8 虚假报喜率从 v4 的 16.7% 升到 29-30%，所以加这条约束 |
| **Claude Code 本身bug怎么处理** | 告诉它推荐什么 slash 命令 |

### 设计解读

这些是**针对新版本模型特定问题的矫正**，先在内部员工（`USER_TYPE=ant` = Anthropic 员工）验证，A/B测试有效后，会放开给所有用户。

这是**渐进式rollout**的架构：
1. 先内部验证问题确实存在，规则确实有效
2. A/B测试确认对外部用户也有效
3. 然后放开给所有人，去掉条件判断

注释里的 `@[MODEL LAUNCH]: un-gate once validated` 就是这个意思。

---

## 第四层：用户帮助

最后加了两条帮助：
```
- /help: Get help with using Claude Code
- To give feedback, users should ...
```

告诉模型怎么引导用户获取帮助和提交反馈。

---

## 整体设计亮点

### 1. **从实践中来，到实践中去**

每一条规则都不是凭空想的，都是：
- 大量用户使用
- 发现模型有某个固定坏习惯
- 加一条规则纠正
- A/B测试确认有效 → 保留

所以整个 section 是**亿轮对话踩坑总结出来的最佳实践**。

### 2. **渐进式模型矫正**

用环境变量控制，只给内部开，验证好了再放开：
- 风险可控
- 不影响普通用户
- 可以快速迭代模型行为

### 3. **可插拔设计**

配合 `keepCodingInstructions` 配置：
- 如果自定义输出风格已经包含了编码规则，可以设 `keepCodingInstructions: false` 移除此section
- 灵活适应不同需求

---

## 在整个系统提示词中的位置

```
getSimpleIntro         → 开篇定调+安全规则
getSimpleSystem       → 系统框架规则
getSimpleDoingTasks   → 【这里就是它】软件工程做事准则 ← 核心行为
getActionsSection     → 风险处理
getUsingYourTools     → 工具使用规范
...
```

它是**告诉模型"怎么做软件工程"**的核心章节，位置很重要，在基础框架之后，具体操作规范之前。

---

## 总结

| 维度 | 评价 |
|------|------|
| **作用** | 定义 Claude Code 做软件工程任务的核心行为准则 |
| **结构** | 总体定位 → 通用准则 → 代码风格 → 特定模型矫正 → 用户帮助 |
| **设计** | 每条规则解决一个模型真实坏习惯，从实践中来 |
| **演进** | 支持渐进式rollout，内部验证后再放开 |
| **灵活性** | 配合 `keepCodingInstructions` 可以完全移除，给自定义风格让路 |

这就是**工业级提示词工程**的典范：不是把一堆要求堆进去，而是有条理地解决一个个真实遇到的问题，逐步演进。
