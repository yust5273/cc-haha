# `resolvedDynamicSections` 动态内容注册机制解读

## 概念

`resolvedDynamicSections` 不是一个函数，是 `getSystemPrompt()` 中的一个变量，它是**所有放在边界之后的动态内容**，通过 `resolveSystemromptSections` 从注册式的定义计算出来。

---

## 完整机制：注册 → 解析 → 拼接到系统提示词

### 第一步：定义 `dynamicSections` 数组

在 `getSystemPrompt()` 中：

```typescript
const dynamicSections = [
  systemPromptSection('session_guidance', () =>
    getSessionSpecificGuidanceSection(enabledTools, skillToolCommands),
  ),
  systemPromptSection('memory', () => loadMemoryPrompt()),
  systemPromptSection('ant_model_override', () =>
    getAntModelOverrideSection(),
  ),
  systemPromptSection('env_info_simple', () =>
    computeSimpleEnvInfo(model, additionalWorkingDirectories),
  ),
  systemPromptSection('language', () =>
    getLanguageSection(settings.language),
  ),
  systemPromptSection('output_style', () =>
    getOutputStyleSection(outputStyleConfig),
  ),
  DANGEROUS_uncachedSystemPromptSection(
    'mcp_instructions',
    () =>
      isMcpInstructionsDeltaEnabled()
        ? null
        : getMcpInstructionsSection(mcpClients),
    'MCP servers connect/disconnect between turns',
  ),
  systemPromptSection('scratchpad', () => getScratchpadInstructions()),
  systemPromptSection('frc', () => getFunctionResultClearingSection(model)),
  systemPromptSection('summarize_tool_results', () =>
    SUMMARIZE_TOOL_RESULTS_SECTION),
  systemPromptSection('proactive', getProactiveSection),
  ...(feature('KAIROS') || feature('KAIROS_BRIEF')
    ? [systemPromptSection('brief', () => getBriefSection())]
    : []),
];
```

每个元素通过 `systemPromptSection()` 注册，携带：
- `name` → section 名称，用于缓存
- `() => string | null` → 计算函数，惰性计算

### 第二步：resolve 计算得到内容

```typescript
const resolvedDynamicSections =
  await resolveSystemPromptSections(dynamicSections);
```

进入 `resolveSystemPromptSections` 函数（在 `systemPromptSections.ts`）：

```typescript
export async function resolveSystemPromptSections(
  sections: SystemPromptSection[],
): Promise<(string | null)[]> {
  const cache = getSystemPromptSectionCache()

  return Promise.all(
    sections.map(async s => {
      if (!s.cacheBreak && cache.has(s.name)) {
        return cache.get(s.name) ?? null
      }
      const value = await s.compute()
      setSystemPromptSectionCacheEntry(s.name, value)
      return value
    }),
  )
}
```

**缓存机制**：
- 如果 `!s.cacheBreak` (不需要每次都重新计算) **并且**缓存里已经有了 → 直接返回缓存
- 否则 → 调用 `compute()` 计算，存入缓存，返回结果

所以**同一个会话多次生成系统提示词**，不会重复计算，直接从缓存拿。

---

## 特殊：`DANGEROUS_uncachedSystemPromptSection`

```typescript
DANGEROUS_uncachedSystemPromptSection(
  name: string,
  compute: () => string | null,
  reason: string,
): SystemPromptSection {
  return { name, compute, cacheBreak: true }
}
```

这个标记 **强制每次都重新计算**，因为：
- 内容每次都可能变
- 比如 `mcp_instructions` → MCP 服务器可以在对话中途连接/断开，所以每次都要重新计算
- 注释说："This WILL break the prompt cache when the value changes" → 这是故意的，因为内容变了，缓存必须破掉

---

## 第三步：拼接到最终系统提示词

```typescript
return [
  // --- Static content (cacheable) ---
  getSimpleIntroSection(outputStyleConfig),
  getSimpleSystemSection(),
  ... // 其他静态 sections
  // === BOUNDARY MARKER - DO NOT MOVE OR REMOVE ===
  ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
  // --- Dynamic content (registry-managed) ---
  ...resolvedDynamicSections,
].filter(s => s !== null)
```

所有动态内容放在 **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 之后**，所以：
- 这些都是动态内容，不会被缓存 ✅
- 如果内容变了，不会影响静态缓存 ✅

---

## 设计亮点

### 1. **注册式扩展**

新增一个动态区块只需要加一行：

```typescript
systemPromptSection('your_section_name', () => getYourSection()),
```

不需要改其他地方，符合**开放封闭原则**。

### 2.**惰性计算 + 会话级缓存**

- 惰性计算：只有 `resolveSystemPromptSections` 才调用计算函数
- 会话内缓存：一次计算，多次使用，不需要重新计算
- `clearSystemPromptSections()` 在 `/clear` `/compact` 时清空缓存，重新计算

### 3.**区分缓存还是不缓存**

- 默认 `cacheBreak: false` → 缓存，效率高
- 如果内容确实每次都变 → 使用 `DANGEROUS_uncachedSystemPromptSection` 标记 `cacheBreak: true` → 每次重新计算
- 必须写 reason 说明为什么需要打破缓存 → 文档化，方便维护

### 4.**所有动态内容集中管理**

所有动态区块都在这里注册，一目了然：

| 区块名称 | 内容 | 缓存？ |
|---------|------|--------|
| `session_guidance` | 当前会话启用的工具/技能 | ✅ 缓存 |
| `memory` | auto memory | ✅ 缓存 |
| `ant_model_override` | 内部模型覆盖 | ✅ 缓存 |
| `env_info_simple` | 当前环境信息（CWD/日期/模型） | ✅ 缓存（会话内不变） |
| `language` | 用户语言偏好 | ✅ 缓存 |
| `output_style` | 用户输出风格 | ✅ 缓存 |
| `mcp_instructions` | 已连接的 MCP 服务器指令 | ❌ 不缓存（MCP 连接会变） |
| `scratchpad` | 草稿本说明 | ✅ 缓存 |
| `frc` | 工具结果清理策略 | ✅ 缓存 |
| `summarize_tool_results` | 工具结果总结 | ✅ 缓存 |
| `proactive` | 主动模式提示 | ✅ 缓存 |

---

## 整体架构回顾

```
┌─────────────────────────────────────────────────────────────┐
│  静态内容（全部拼好，放边界之前）                             │
│    getSimpleIntroSection                                    │
│    getSimpleSystemSection                                  │
│    getSimpleDoingTasksSection                              │
│    getActionsSection                                       │
│    getUsingYourToolsSection                                │
│    getSimpleToneAndStyleSection                            │
│    getOutputEfficiencySection                              │
├─────────────────────────────────────────────────────────────┤
│             __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__               │
├─────────────────────────────────────────────────────────────┤
│  动态内容（注册式，resolve 后放边界之后）                   │
│  resolvedDynamicSections ← resolveSystemPromptSections()    │
│    每个区块可以选择缓存或不缓存                             │
└─────────────────────────────────────────────────────────────┘
```

这个设计完美配合了 Prompt Caching 的架构：
- 静态内容一块缓存 → 只用 1 个缓存配额
- 动态内容全部在边界之后 → 不缓存，保证正确
- 注册式扩展方便添加新的动态区块

---

## 总结

`resolvedDynamicSections` 这套机制是：

> **把所有动态内容用注册式收集起来，惰性计算，会话级缓存，最后集中放到边界之后不缓存**

这是一个**干净、可扩展**的设计，完美适配了 Prompt Caching 的静态/动态分离架构。
