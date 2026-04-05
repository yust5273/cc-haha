# Prompt Caching 学习笔记

本文档总结了 Anthropic Messages API Prompt Caching 特性，以及 Claude Code 源码中的实现设计。

---

## 目录

- [什么是 Prompt Caching](#什么是-prompt-caching)
- [Anthropic API 基本用法](#anthropic-api-基本用法)
- [常见问题](#常见问题)
  - [第二轮对话还要发送完整缓存内容吗？](#第二轮对话还要发送完整缓存内容吗)
  - [怎么节省了成本？](#怎么节省了成本)
  - [Anthropic 服务端具体省下了什么资源？](#anthropic-服务端具体省下了什么资源)
- [API 限制](#api-限制)
- [Claude Code 中的架构设计](#claude-code-中的架构设计)
  - [`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 分界标记](#__system_prompt_dynamic_boundary__-分界标记)
  - [当前实际使用多少缓存块](#当前实际使用多少缓存块)
  - [动态内容列表](#动态内容列表)
- [官方文档](#官方文档)

---

## 什么是 Prompt Caching

Prompt Caching（提示词缓存）是 Anthropic Messages API 提供的特性，允许你**缓存重复发送的提示词块**，避免每次请求都重复计费和重复计算。

### 解决的问题

在交互式对话（比如 Claude Code）中，系统提示词大部分内容是不变的，但每一轮对话都要重新发送：

| 没有缓存 | 有缓存 |
|---------|--------|
| 每轮都发送完整系统提示词 (~1500 token) | 第一轮发送全量，后续轮次缓存命中只计费动态内容 |
| 每轮都为 1500 token 付费 | 只付费一次，后续轮次免费 |
| 每轮都要重新分词+计算embedding | 分词+embedding 只做一次 |

---

## Anthropic API 基本用法

### 请求格式

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "system": [
    {
      "type": "text",
      "text": "这部分内容不变，所有对话都一样...",
      "cache_control": {
        "type": "ephemeral",
        "scope": "global"
      }
    },
    {
      "type": "text",
      "text": "这部分内容每次变化..."
      // 没有 cache_control → 不缓存，每次全价
    }
  ],
  "messages": [...]
}
```

### `cache_control` 参数说明

| 参数 | 说明 |
|------|------|
| `"type": "ephemeral"` | 临时缓存，目前只有这一种类型 |
| `"scope": "global"` | 全局缓存，所有用户可以共享 |
| `"scope": "org"` | 同机构内共享 |
| 不设置 `cache_control` | 不缓存，每次全价计费 |

---

## 常见问题

### 第二轮对话还要发送完整缓存内容吗？

**✅ 是的，客户端必须完整发送一遍**。原因：

1. **API 需要验证内容没变**：只有内容完全一样才能用缓存
2. **分布式服务端设计**：不同节点可能都需要缓存，客户端发送完整内容保证任何节点都能处理
3. **协议简单**：不需要额外的"引用缓存"机制

**但这不影响节省成本**：服务端检查哈希匹配后，就不会重复计费和重复计算。

### 怎么节省了成本？

#### 对**你（用户）**来说：节省 Token 费用

Anthropic 只对缓存未命中的内容计费。例子（10 轮对话，1500 token 静态）：

| 方式 | 每轮计费 | 总计费 |
|------|---------|--------|
| 无缓存 | 1500 + 200 = 1700 | 1700 × 10 = **17,000 token** |
| 有缓存 | 第一轮：1700<br>后续 9 轮：每轮 200 | 1700 + (200 × 9) = **3,500 token** |

**节省了 79% 费用**。

#### 对**Anthropic 服务端**来说：节省计算资源

详细分析见下一节。

### Anthropic 服务端具体省下了什么资源？

一次请求完整处理流水线：

```
客户端发送 → 网络接收 → JSON解析 → [分词] → [embedding计算] → Transformer推理 → 返回
```

Prompt Caching **缓存了分词和 embedding 计算的结果**：

| 环节 | 没有缓存 | 缓存命中 | 节省了什么 | 资源类型 |
|------|---------|-----------|-----------|----------|
| 网络接收 | 需要做 | 需要做（客户端重发） | ❌ 不省 | - |
| JSON解析 | 需要做 | 需要做 | ❌ 不省 | - |
| **Tokenization 分词** | 需要做 | 跳过 | ✅ **CPU** | CPU 计算 |
| **Embedding 计算** | 需要做 | 跳过 | ✅ **GPU** | GPU 计算 |
| **读取词表** | 需要从 HBM 读每个 token 向量 | 跳过 | ✅ **内存带宽** | GPU 内存带宽 |
| Transformer 推理 | 需要做 | 需要做（完整输入还是要推理） | ❌ 不省 | - |

**为什么客户端重发还是省了？**

- 网络接收 10000 字符只需要**几微秒**
- 分词+embedding 需要**几毫秒**
- 网络成本比计算成本便宜**几百倍**
- 所以就算重发文本，净节省还是很大

**实际效果：**

| 内容大小 | 节省时间 per 请求 |
|---------|-------------------|
| 系统提示词 1500 token | ~2-5ms → ~0.1ms → 节省 95% 预处理时间 |
| 小说 10000 token | ~15-30ms 完全省掉 |

对大规模服务端来说，每秒几十万请求积累起来，节省了成千上万核 CPU 和几百卡 GPU。

---

## API 限制

**最重要限制：单次请求最多 4 个缓存块**。

超过 4 个会返回 `400 bad_request_error`。

所以设计架构时必须控制缓存块数量。

---

## Claude Code 中的架构设计

### `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 分界标记

这是 Claude Code 源码中为了适配 Prompt Caching 设计的内部分界标记：

```typescript
return [
  // --- Static content (cacheable) ---
  getSimpleIntroSection(),      // 开篇定调+安全规则
  getSimpleSystemSection(),     // 系统基础规则
  getSimpleDoingTasksSection(),// 做事准则
  getActionsSection(),          // 执行动作风险处理
  getUsingYourToolsSection(),  // 工具使用规范
  getSimpleToneAndStyleSection(),// 输出风格
  getOutputEfficiencySection(), // 输出效率要求
  // === BOUNDARY MARKER - DO NOT MOVE OR REMOVE ===
  ...(shouldUseGlobalCacheScope() ? [SYSTEM_PROMPT_DYNAMIC_BOUNDARY] : []),
  // --- Dynamic content (registry-managed) ---
  ...resolvedDynamicSections,
];
```

**设计思想：**

| 位置 | 内容性质 | 缓存策略 |
|------|---------|---------|
| 边界之前 | 静态不变规则，所有用户/所有会话都一样 | `cache_scope: "global"` → 缓存 |
| 边界之后 | 动态内容，因用户/会话/环境而异 | `cache_scope: null` → 不缓存 |

**好处：**

- 所有静态内容合并成**一个缓存块** → 只用掉 1 个配额
- 把剩下 3 个配额留给其他功能（CLAUDE.md、权限分类器等）
- 永远不会超过 4 个块的 API 限制

### 当前实际使用多少缓存块

| 场景 | 系统提示词 | CLAUDE.md | 权限分类器 | 总计 | 是否超限 |
|------|-----------|-----------|-----------|------|---------|
| 无 CLAUDE.md，无权限分类 | 1 | 0 | 0 | 1 | ✅ OK |
| 有 CLAUDE.md，无权限分类 | 1 | 1 | 0 | 2 | ✅ OK |
| 无 CLAUDE.md，有权限分类 | 1 | 0 | 1 | 2 | ✅ OK |
| 有 CLAUDE.md，有权限分类 | 1 | 1 | 1 | 3 | ✅ OK |

**结论：最少 1 个，最多 3 个 → 永远不碰 4 个的红线**。设计上就预留了空间。

### 动态内容列表（边界之后，不缓存）

| 动态区块 | 为什么不缓存 |
|---------|-------------|
| `session_guidance` | 当前会话启用的工具/权限不同 |
| `memory` | auto memory 会随着对话更新 |
| `ant_model_override` | 内部员工模型覆盖不同 |
| `env_info_simple` | CWD工作目录、日期、平台随时变 |
| `language` | 用户语言偏好可能改 |
| `output_style` | 用户输出风格配置可能改 |
| `mcp_instructions` | MCP服务器可以中途连接/断开 |
| `scratchpad` | 草稿本使用说明属于可变配置 |
| `tool_result_clearing` | 根据模型不同策略不同 |

**核心原则：只要内容有可能变，就放在动态区域不缓存。宁可多不缓存，绝不错误缓存。**

### 对第三方模型支持吗？

**不支持**。原因：

- Prompt Caching 是 Anthropic API 特有特性
- 第三方模型（OpenAI/Ollama/DeepSeek 等）不支持 `cache_control`
- Claude Code 代码判断：`shouldUseGlobalCacheScope()` → 只有 Anthropic 官方 API 才开启
- 不开启时，不会插入 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`

---

## 官方文档

- [Anthropic Prompt Caching 官方文档](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)

---

## 总结

| 设计要点 | 说明 |
|---------|------|
| **分界标记** | `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 分隔静态/动态，客户端内部使用，API 不感知 |
| **缓存配额** | 全静态合并为 1 块，省出配额给其他功能 |
| **正确性优先** | 任何可能变化的内容都放动态，绝不缓存可变内容 |
| **双赢** | 用户节省 Token 费用，Anthropic 节省 CPU/GPU 资源 |
| **限额遵守** | 设计上控制在最多 3 块，永远不超过 API 限制 4 块 |
