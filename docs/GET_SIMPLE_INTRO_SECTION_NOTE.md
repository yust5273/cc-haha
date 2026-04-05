# `getSimpleIntroSection()` 函数解读

## 函数位置
`src/constants/prompts.ts:187-196`

## 函数代码

```typescript
function getSimpleIntroSection(
  outputStyleConfig: OutputStyleConfig | null,
): string {
  return `
You are an interactive agent that helps users ${outputStyleConfig !== null
  ? 'according to your "Output Style" below, which describes how you should respond to user queries.'
  : 'with software engineering tasks.'}
Use the instructions below and the tools available to you to assist the user.

${CYBER_RISK_INSTRUCTION}
IMPORTANT: You must NEVER generate or guess URLs for the user unless you are confident that the URLs are for helping the user with programming.
You may use URLs provided by the user in their messages or local files.`
}
```

---

## 功能分析

这是**系统提示词开篇第一段**，作用是：

### 1. **开篇定调**

第一句话就告诉模型：
- 你是 **interactive agent**（交互式代理）
- 你的任务是 **help users with software engineering tasks**（帮助用户做软件工程任务）
- 如果有自定义输出风格，提前打招呼："according to your Output Style below" → 告诉模型后面还有输出风格规则要遵守

### 2. **注入网络安全红线**

直接插入 `CYBER_RISK_INSTRUCTION`：

```
IMPORTANT: Assist with authorized security testing, defensive security,
CTF challenges, and educational contexts.
Refuse requests for destructive techniques, DoS attacks, mass targeting,
supply chain compromise, or detection evasion for malicious purposes.
Dual-use security tools (C2 frameworks, credential testing, exploit development)
require clear authorization context:
pentesting engagements, CTF competitions, security research, or defensive use cases.
```

**为什么安全规则放在最开头？**
- LLM 对开头的内容权重更高
- 安全红线必须让模型第一眼就看到
- 这是**安全优先**的设计

### 3. **防幻觉：禁止瞎编URL**

```
IMPORTANT: You must NEVER generate or guess URLs for the user
unless you are confident that the URLs are for helping the user with programming.
You may use URLs provided by the user in their messages or local files.
```

解决一个常见幻觉问题：LLM 喜欢编造不存在的链接。直接禁止：
- 只有用户给过的URL才能用
- 不能瞎猜瞎编

---

## 在整个系统提示词中的位置

```
getSimpleIntroSection    ← 【这里就是它】第一个出场
  ↓
getSimpleSystemSection
  ↓
getSimpleDoingTasksSection
  ↓
getActionsSection
  ↓
...
```

**为什么放在第一个？**
- 开门见山：告诉模型你是谁，你要做什么
- 安全规则放在最开头，权重最高

---

## 设计亮点

| 设计点 | 评价 |
|------|------|
| **短小精悍** | 三句话搞定：身份定位 + 安全红线 + 防瞎编URL |
| **安全前置** | 安全规则放在最开头，符合人类阅读顺序，模型权重也最高 |
| **适配自定义输出风格** | 如果有自定义输出风格，提前告知模型"后面有风格规则，请遵守" |
| **解决真问题** | 禁止瞎编URL就是解决一个真实存在的幻觉问题 |

---

## 总结

这是**完美的开篇**：短小，到位，该说的都说了，不该说的不说。把最重要的身份定位和安全规则放在最前面，模型一眼就能看到。
