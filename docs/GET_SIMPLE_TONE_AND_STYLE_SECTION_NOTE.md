# `getSimpleToneAndStyleSection()` 函数解读

## 函数位置
`src/constants/prompts.ts:447-459`

## 函数代码

```typescript
function getSimpleToneAndStyleSection(): string {
  const items = [
    `Only use emojis if the user explicitly requests it. Avoid using emojis in all communication unless asked.`,
    process.env.USER_TYPE === 'ant'
      ? null
      : `Your responses should be short and concise.`,
    `When referencing specific functions or pieces of code include the pattern file_path:line_number
to allow the user to easily navigate to the source code location.`,
    `When referencing GitHub issues or pull requests, use the owner/repo#123 format (e.g. anthropics/claude-code#100)
so they render as clickable links.`,
    `Do not use a colon before tool calls. Your tool calls may not be shown directly in the output,
so text like "Let me read the file:" followed by a read tool call should just be "Let me read the file." with a period.`,
  ].filter(item => item !== null)

  return [`# Tone and style`, ...prependBullets(items)].join(`\n`)
}
```

---

## 功能：输出语气和格式规范

这一节定义**模型输出的格式规范**，告诉模型怎么输出才能让用户在终端里舒服地阅读。

逐条分析：

| 规则 | 为什么要有这条规则 |
|------|------------------|
| `Only use emojis if the user explicitly requests it` | 终端里过多emoji显得很乱，而且很多人不喜欢。用户没说要就不要加 |
| `Your responses should be short and concise` (非内部用户才有这条) | 对普通用户，要求简洁回答。内部用户可能需要更多信息，所以拿掉了 |
| `reference specific functions → include file_path:line_number` | 方便用户直接点击跳转到对应代码位置（IDE支持跳转） |
| `reference GitHub issues → use owner/repo#123 format` | GitHub 会自动渲染成可点击链接，用户直接点就能开 |
| `Do not use a colon before tool calls` | 因为 tool calls 在UI里不一定显示出来，文字描述结尾用句号就好，不用冒号引出 |

---

## 在整个系统提示词中的位置

```
getSimpleIntro     → 开篇
getSimpleSystem   → 框架规则
getSimpleDoingTasks → 做事准则
getActionsSection → 风险治理
getUsingYourTools → 工具使用规范
getSimpleToneAndStyleSection ← 【这里就是它】语气格式规范
getOutputEfficiencySection → 输出效率
...
```

顺序：讲完怎么做，讲完工具，再讲输出格式 → 逻辑正确。

---

## 设计亮点

| 设计点 | 评价 |
|------|------|
| **配合终端体验** | 所有规则都是为了在终端 monospace 字体环境下输出干净好读 |
| **环境区分** | 内部员工不需要"short and concise"（因为内部需要更多信息），所以条件编译去掉 |
| **实用导航** | 直接告诉模型输出正确的跳转格式，方便IDE和GitHub集成 |
| **配合UI设计** | 考虑了tool calls不一定显示在输出，所以文字描述结尾不要用冒号 |

---

## 总结

这一节很短，但每条规则都是**从实际使用体验总结出来的**——告诉模型怎么输出才能适配 Claude Code 这个终端产品，让用户看得舒服，导航方便。都是小细节，但细节决定体验。
