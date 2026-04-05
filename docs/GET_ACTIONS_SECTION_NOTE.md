# `getActionsSection()` 函数解读

## 函数位置
`src/constants/prompts.ts:272-284`

## 功能：风险治理 - 执行动作的风险决策框架

这一节给模型讲清楚：**什么样的动作可以直接做，什么样的动作必须先问用户**。核心是**风险分层决策**。

---

## 核心规则

```
Carefully consider the reversibility and blast radius of actions.

Generally you can freely take:
  local, reversible actions → editing files / running tests

But for:
  actions hard to reverse / affect shared systems beyond local / risky or destructive
→ CHECK WITH USER BEFORE PROCEEDING
```

### 基本原则

| 原则 | 说明 |
|------|------|
| **可逆性** | 能本地撤销的动作 → 自由做。不能撤销的 → 要确认 |
| **爆炸半径** | 只影响本地 → 自由做。影响共享系统 → 要确认 |
| **成本收益** | 暂停一下问用户成本很低，做错了代价很高 → 宁肯问也不要错 |

### 权限原则

```
A user approving an action once does NOT mean that they approve it in all contexts.
unless actions are authorized in advance in durable instructions like CLAUDE.md files,
always confirm first.
Authorization stands for the scope specified, not beyond.
Match the scope of your actions to what was actually requested.
```

意思就是：**用户这次批准了这个动作，不代表永远批准所有同类动作**。必须每次都确认，除非 `CLAUDE.md` 已经提前授权。

---

## 具体例子：哪些动作必须确认

分类举例，模型更容易理解：

| 分类 | 例子 |
|------|------|
| **破坏性操作** | deleting files/branches, dropping database tables, killing processes, `rm -rf`, overwriting uncommitted changes |
| **难逆转操作** | force-pushing, `git reset --hard`, amending published commits, removing dependencies, modifying CI/CD pipelines |
| **影响他人/共享状态** | pushing code, creating/closing/commenting on PRs/issues, sending messages (Slack/email), posting to external services, modifying shared infrastructure/permissions |
| **上传第三方** | uploading to diagram renderers/pastebins/gists → 考虑敏感信息，上传了就算删除也可能被缓存索引 |

---

## 遇到障碍怎么办

```
When you encounter an obstacle, do not use destructive actions as a shortcut.
For instance, try to identify root causes and fix underlying issues
rather than bypassing safety checks (e.g. --no-verify).

If you discover unexpected state like unfamiliar files/branches/configuration,
investigate before deleting or overwriting, it may be user's in-progress work.

For example: typically resolve merge conflicts rather than discarding changes;
if a lock file exists, investigate what process holds it rather than deleting it.

In short: only take risky actions carefully, and when in doubt, ask before acting.
Follow both the spirit and letter of these instructions - measure twice, cut once.
```

核心思想：**不要用破坏性操作当捷径**。遇到奇怪的东西先调查，不要上来就删。

---

## 在整个系统提示词中的位置

```
getSimpleIntro     → 开篇
getSimpleSystem   → 框架规则
getSimpleDoingTasks → 做事准则
getActionsSection ← 【这里就是它】风险治理
getUsingYourToolsSection → 工具使用规范
...
```

顺序：**先讲怎么做任务，再讲做动作的风险，再讲怎么用工具** → 逻辑递进正确。

---

## 设计亮点

| 设计点 | 评价 |
|------|------|
| **风险分层** | 不是一刀切"所有操作都要确认"，也不是"随便做"，而是按可逆性和爆炸半径分层决策 |
| **具体例子** | 给模型举了各种分类例子，模型更容易理解哪些该确认 |
| **权限清晰** | 明确说了"一次批准不代表永久批准"，"必须匹配 scope"，避免模型越权 |
| **最后总结** | `measure twice, cut once` (三思而后行) → 一句口号记住核心思想 |

---

## 总结

这一节是**风险治理的决策框架**，把人类对操作风险的思考经验编码给模型：
- 能逆转、影响小的 → 放心做
- 难逆转、影响大的 → 必须确认
- 遇到不确定的 → 先调查再动手，不要瞎删

这就是把**软件工程最佳实践**直接教给模型，让模型像一个谨慎的工程师那样做事。
