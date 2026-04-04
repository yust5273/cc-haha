import { c as _c } from "react/compiler-runtime"; // 导入 React Compiler 的 c 函数，用于编译时优化
import * as React from 'react'; // 导入 React 核心库
import { Box, Text } from '../../ink.js'; // 从自定义 ink.js 导入 Ink 的 Box 和 Text 组件
import { env } from '../../utils/env.js'; // 导入环境变量工具，获取终端类型等信息
export type ClawdPose = 'default' | 'arms-up' // 默认姿态，双臂下垂
| 'look-left' // 向左看姿态，双眼都看向左边
| 'look-right'; // 向右看姿态，双眼都看向右边

type Props = {
  pose?: ClawdPose; // 可选的 pose 属性，用于控制 Clawd 的姿态，默认为 'default'
};

// Standard-terminal pose fragments. Each row is split into segments so we can
// vary only the parts that change (eyes, arms) while keeping the body/bg spans
// stable. All poses end up 9 cols wide.
//
// arms-up: the row-2 arm shapes (▝▜ / ▛▘) move to row 1 as their
// bottom-heavy mirrors (▗▟ / ▙▖) — same silhouette, one row higher.
//
// look-* use top-quadrant eye chars (▙/▟) so both eyes change from the
// default (▛/▜, bottom pupils) — otherwise only one eye would appear to move.
// 标准终端姿态片段 - 每行分割成多段以便只改变变化部分（眼睛、手臂）
// 同时保持身体/背景部分稳定，所有姿态宽度为 9 列
// arms-up: 第2行的手臂形状移动到第1行作为镜像
// look-*: 使用左上角眼睛字符，使双眼同时变化
type Segments = {
  /** row 1 left (no bg): optional raised arm + side */ // 第1行左侧（无背景）：可选的举起手臂+边
  r1L: string;
  /** row 1 eyes (with bg): left-eye, forehead, right-eye */ // 第1行眼睛（带背景）：左眼、额头、右眼
  r1E: string;
  /** row 1 right (no bg): side + optional raised arm */ // 第1行右侧（无背景）：边+可选的举起手臂
  r1R: string;
  /** row 2 left (no bg): arm + body curve */ // 第2行左侧（无背景）：手臂+身体曲线
  r2L: string;
  /** row 2 right (no bg): body curve + arm */ // 第2行右侧（无背景）：身体曲线+手臂
  r2R: string;
};
const POSES: Record<ClawdPose, Segments> = { // 定义所有姿态的字符映射（狗的形象）
  default: { // 默认姿态：狗耳朵自然下垂
    r1L: '▗▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌', // 左耳下垂ß
    r1E: '▛▄▀▄▜', // 狗脸：宽额头+鼻子
    r1R: '▐▖', // 右耳下垂
    r2L: '▝▜', // 第2行左侧：身体
    r2R: '▛▘' // 第2行右侧：身体
  },
  'look-left': { // 向左看姿态：狗歪头看左
    r1L: '▗▌', // 左耳
    r1E: '▟▄▀▄▟', // 双眼看左
    r1R: '▐▖', // 右耳
    r2L: '▝▜', // 第2行左侧
    r2R: '▛▘' // 第2行右侧
  },
  'look-right': { // 向右看姿态：狗歪头看右
    r1L: '▗▌', // 左耳
    r1E: '▙▄▀▄▙', // 双眼看右
    r1R: '▐▖', // 右耳
    r2L: '▝▜', // 第2行左侧
    r2R: '▛▘' // 第2行右侧
  },
  'arms-up': { // 前爪抬起姿态：狗举起前爪
    r1L: '▗▟', // 左耳+左前爪抬起
    r1E: '▛▄▀▄▜', // 狗脸
    r1R: '▙▖', // 右前爪抬起+右耳
    r2L: ' ▜', // 第2行左侧：身体
    r2R: '▛ ' // 第2行右侧：身体
  }
};

// Apple Terminal uses a bg-fill trick (see below), so only eye poses make
// sense. Arm poses fall back to default.
// Apple Terminal 使用背景填充技巧，所以只有眼睛姿态有意义，手臂姿态回退到默认
const APPLE_EYES: Record<ClawdPose, string> = { // Apple Terminal 的眼睛字符映射（狗形象）
  default: ' ▗▄ ▄▖ ', // 狗默认眼睛（带鼻子）
  'look-left': ' ▘▄ ▄▘ ', // 狗向左看的眼睛
  'look-right': ' ▝▄ ▄▝ ', // 狗向右看的眼睛
  'arms-up': ' ▗▄ ▄▖ ' // 举起前爪时（回退到默认眼睛）
};
export function Clawd(t0) { // Clawd 主组件函数
  const $ = _c(26); // 初始化 React Compiler 缓存数组（26个槽位）
  let t1; // 声明临时变量 t1
  if ($[0] !== t0) { // 如果 props 变化了
    t1 = t0 === undefined ? {} : t0; // 处理 undefined 的 props
    $[0] = t0; // 缓存 props 对象
    $[1] = t1; // 缓存解构后的 props
  } else { // 如果 props 没变
    t1 = $[1]; // 使用缓存的解构 props
  }
  const { pose: t2 } = t1; // 从 props 解构出 pose
  const pose = t2 === undefined ? "default" : t2; // 如果 pose 为 undefined，默认为 "default"
  if (env.terminal === "Apple_Terminal") { // 如果是 Apple Terminal
    let t3; // 声明临时变量 t3
    if ($[2] !== pose) { // 如果 pose 变化了
      t3 = <AppleTerminalClawd pose={pose} />; // 渲染 Apple Terminal 专用版本
      $[2] = pose; // 缓存 pose
      $[3] = t3; // 缓存渲染结果
    } else { // 如果 pose 没变
      t3 = $[3]; // 使用缓存的渲染结果
    }
    return t3; // 返回渲染结果
  }
  const p = POSES[pose]; // 获取当前 pose 的字符配置
  let t3; // 声明临时变量 t3
  if ($[4] !== p.r1L) { // 如果 r1L 变化了
    t3 = <Text color="clawd_body">{p.r1L}</Text>; // 渲染第1行左侧（身体颜色）
    $[4] = p.r1L; // 缓存 r1L
    $[5] = t3; // 缓存渲染结果
  } else { // 如果 r1L 没变
    t3 = $[5]; // 使用缓存的渲染结果
  }
  let t4; // 声明临时变量 t4
  if ($[6] !== p.r1E) { // 如果 r1E（眼睛）变化了
    t4 = <Text color="clawd_body" backgroundColor="clawd_background">{p.r1E}</Text>; // 渲染第1行眼睛（带背景色）
    $[6] = p.r1E; // 缓存 r1E
    $[7] = t4; // 缓存渲染结果
  } else { // 如果 r1E 没变
    t4 = $[7]; // 使用缓存的渲染结果
  }
  let t5; // 声明临时变量 t5
  if ($[8] !== p.r1R) { // 如果 r1R 变化了
    t5 = <Text color="clawd_body">{p.r1R}</Text>; // 渲染第1行右侧（身体颜色）
    $[8] = p.r1R; // 缓存 r1R
    $[9] = t5; // 缓存渲染结果
  } else { // 如果 r1R 没变
    t5 = $[9]; // 使用缓存的渲染结果
  }
  let t6; // 声明临时变量 t6
  if ($[10] !== t3 || $[11] !== t4 || $[12] !== t5) { // 如果任意一个子元素变化了
    t6 = <Text>{t3}{t4}{t5}</Text>; // 将第1行的三部分组合
    $[10] = t3; // 缓存 t3
    $[11] = t4; // 缓存 t4
    $[12] = t5; // 缓存 t5
    $[13] = t6; // 缓存组合结果
  } else { // 如果都没变
    t6 = $[13]; // 使用缓存的组合结果
  }
  let t7; // 声明临时变量 t7
  if ($[14] !== p.r2L) { // 如果 r2L 变化了
    t7 = <Text color="clawd_body">{p.r2L}</Text>; // 渲染第2行左侧（手臂）
    $[14] = p.r2L; // 缓存 r2L
    $[15] = t7; // 缓存渲染结果
  } else { // 如果 r2L 没变
    t7 = $[15]; // 使用缓存的渲染结果
  }
  let t8; // 声明临时变量 t8
  if ($[16] === Symbol.for("react.memo_cache_sentinel")) { // 如果是首次渲染（哨兵值）
    t8 = <Text color="clawd_body" backgroundColor="clawd_background">█████</Text>; // 渲染第2行中间的身体填充
    $[16] = t8; // 缓存结果
  } else { // 如果不是首次
    t8 = $[16]; // 使用缓存的结果
  }
  let t9; // 声明临时变量 t9
  if ($[17] !== p.r2R) { // 如果 r2R 变化了
    t9 = <Text color="clawd_body">{p.r2R}</Text>; // 渲染第2行右侧
    $[17] = p.r2R; // 缓存 r2R
    $[18] = t9; // 缓存渲染结果
  } else { // 如果 r2R 没变
    t9 = $[18]; // 使用缓存的渲染结果
  }
  let t10; // 声明临时变量 t10
  if ($[19] !== t7 || $[20] !== t9) { // 如果第2行的部分变化了
    t10 = <Text>{t7}{t8}{t9}</Text>; // 将第2行的三部分组合
    $[19] = t7; // 缓存 t7
    $[20] = t9; // 缓存 t9
    $[21] = t10; // 缓存组合结果
  } else { // 如果都没变
    t10 = $[21]; // 使用缓存的组合结果
  }
  let t11; // 声明临时变量 t11
  if ($[22] === Symbol.for("react.memo_cache_sentinel")) { // 如果是首次渲染
    t11 = <Text color="clawd_body">{"  "}▌▌ ▐▐{"  "}</Text>; // 渲染第3行（狗的四条腿/爪子）
    $[22] = t11; // 缓存结果
  } else { // 如果不是首次
    t11 = $[22]; // 使用缓存的结果
  }
  let t12; // 声明临时变量 t12
  if ($[23] !== t10 || $[24] !== t6) { // 如果第1或第2行组合变化了
    t12 = <Box flexDirection="column">{t6}{t10}{t11}</Box>; // 垂直排列三行，组成完整 Logo
    $[23] = t10; // 缓存 t10
    $[24] = t6; // 缓存 t6
    $[25] = t12; // 缓存最终结果
  } else { // 如果都没变
    t12 = $[25]; // 使用缓存的最终结果
  }
  return t12; // 返回渲染的 Clawd Logo
}
function AppleTerminalClawd(t0) { // Apple Terminal 专用版本组件
  const $ = _c(10); // 初始化缓存数组（10个槽位）
  const { pose } = t0; // 从 props 解构 pose
  let t1; // 声明临时变量 t1
  if ($[0] === Symbol.for("react.memo_cache_sentinel")) { // 如果是首次渲染
    t1 = <Text color="clawd_body">▗</Text>; // 渲染左眼
    $[0] = t1; // 缓存结果
  } else { // 如果不是首次
    t1 = $[0]; // 使用缓存的结果
  }
  const t2 = APPLE_EYES[pose]; // 根据 pose 获取眼睛字符
  let t3; // 声明临时变量 t3
  if ($[1] !== t2) { // 如果眼睛字符变化了
    t3 = <Text color="clawd_background" backgroundColor="clawd_body">{t2}</Text>; // 用背景色作为眼睛颜色（反色）
    $[1] = t2; // 缓存眼睛字符
    $[2] = t3; // 缓存渲染结果
  } else { // 如果没变
    t3 = $[2]; // 使用缓存的结果
  }
  let t4; // 声明临时变量 t4
  if ($[3] === Symbol.for("react.memo_cache_sentinel")) { // 如果是首次渲染
    t4 = <Text color="clawd_body">▖</Text>; // 渲染右眼
    $[3] = t4; // 缓存结果
  } else { // 如果不是首次
    t4 = $[3]; // 使用缓存的结果
  }
  let t5; // 声明临时变量 t5
  if ($[4] !== t3) { // 如果眼睛区域变化了
    t5 = <Text>{t1}{t3}{t4}</Text>; // 组合：左眼+眼睛+右眼
    $[4] = t3; // 缓存 t3
    $[5] = t5; // 缓存组合结果
  } else { // 如果没变
    t5 = $[5]; // 使用缓存的结果
  }
  let t6; // 声明临时变量 t6
  let t7; // 声明临时变量 t7
  if ($[6] === Symbol.for("react.memo_cache_sentinel")) { // 如果是首次渲染
    t6 = <Text backgroundColor="clawd_body">{" ".repeat(7)}</Text>; // 渲染7个空格的身体填充
    t7 = <Text color="clawd_body">▘▘ ▝▝</Text>; // 渲染脚部装饰
    $[6] = t6; // 缓存 t6
    $[7] = t7; // 缓存 t7
  } else { // 如果不是首次
    t6 = $[6]; // 使用缓存的 t6
    t7 = $[7]; // 使用缓存的 t7
  }
  let t8; // 声明临时变量 t8
  if ($[8] !== t5) { // 如果头部变化了
    t8 = <Box flexDirection="column" alignItems="center">{t5}{t6}{t7}</Box>; // 垂直居中排列头部、身体、脚
    $[8] = t5; // 缓存 t5
    $[9] = t8; // 缓存最终结果
  } else { // 如果没变
    t8 = $[9]; // 使用缓存的结果
  }
  return t8; // 返回 Apple Terminal 版本的 Clawd
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJSZWFjdCIsIkJveCIsIlRleHQiLCJlbnYiLCJDbGF3ZFBvc2UiLCJQcm9wcyIsInBvc2UiLCJTZWdtZW50cyIsInIxTCIsInIxRSIsInIxUiIsInIyTCIsInIyUiIsIlBPU0VTIiwiUmVjb3JkIiwiZGVmYXVsdCIsIkFQUExFX0VZRVMiLCJDbGF3ZCIsInQwIiwiJCIsIl9jIiwidDEiLCJ1bmRlZmluZWQiLCJ0MiIsInRlcm1pbmFsIiwidDMiLCJwIiwidDQiLCJ0NSIsInQ2IiwidDciLCJ0OCIsIlN5bWJvbCIsImZvciIsInQ5IiwidDEwIiwidDExIiwidDEyIiwiQXBwbGVUZXJtaW5hbENsYXdkIiwicmVwZWF0Il0sInNvdXJjZXMiOlsiQ2xhd2QudHN4Il0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIFJlYWN0IGZyb20gJ3JlYWN0J1xuaW1wb3J0IHsgQm94LCBUZXh0IH0gZnJvbSAnLi4vLi4vaW5rLmpzJ1xuaW1wb3J0IHsgZW52IH0gZnJvbSAnLi4vLi4vdXRpbHMvZW52LmpzJ1xuXG5leHBvcnQgdHlwZSBDbGF3ZFBvc2UgPVxuICB8ICdkZWZhdWx0J1xuICB8ICdhcm1zLXVwJyAvLyBib3RoIGFybXMgcmFpc2VkICh1c2VkIGR1cmluZyBqdW1wKVxuICB8ICdsb29rLWxlZnQnIC8vIGJvdGggcHVwaWxzIHNoaWZ0ZWQgbGVmdFxuICB8ICdsb29rLXJpZ2h0JyAvLyBib3RoIHB1cGlscyBzaGlmdGVkIHJpZ2h0XG5cbnR5cGUgUHJvcHMgPSB7XG4gIHBvc2U/OiBDbGF3ZFBvc2Vcbn1cblxuLy8gU3RhbmRhcmQtdGVybWluYWwgcG9zZSBmcmFnbWVudHMuIEVhY2ggcm93IGlzIHNwbGl0IGludG8gc2VnbWVudHMgc28gd2UgY2FuXG4vLyB2YXJ5IG9ubHkgdGhlIHBhcnRzIHRoYXQgY2hhbmdlIChleWVzLCBhcm1zKSB3aGlsZSBrZWVwaW5nIHRoZSBib2R5L2JnIHNwYW5zXG4vLyBzdGFibGUuIEFsbCBwb3NlcyBlbmQgdXAgOSBjb2xzIHdpZGUuXG4vL1xuLy8gYXJtcy11cDogdGhlIHJvdy0yIGFybSBzaGFwZXMgKOKWneKWnCAvIOKWm+KWmCkgbW92ZSB0byByb3cgMSBhcyB0aGVpclxuLy8gYm90dG9tLWhlYXZ5IG1pcnJvcnMgKOKWl+KWnyAvIOKWmeKWlikg4oCUIHNhbWUgc2lsaG91ZXR0ZSwgb25lIHJvdyBoaWdoZXIuXG4vL1xuLy8gbG9vay0qIHVzZSB0b3AtcXVhZHJhbnQgZXllIGNoYXJzICjilpkv4pafKSBzbyBib3RoIGV5ZXMgY2hhbmdlIGZyb20gdGhlXG4vLyBkZWZhdWx0ICjilpsv4pacLCBib3R0b20gcHVwaWxzKSDigJQgb3RoZXJ3aXNlIG9ubHkgb25lIGV5ZSB3b3VsZCBhcHBlYXIgdG8gbW92ZS5cbnR5cGUgU2VnbWVudHMgPSB7XG4gIC8qKiByb3cgMSBsZWZ0IChubyBiZyk6IG9wdGlvbmFsIHJhaXNlZCBhcm0gKyBzaWRlICovXG4gIHIxTDogc3RyaW5nXG4gIC8qKiByb3cgMSBleWVzICh3aXRoIGJnKTogbGVmdC1leWUsIGZvcmVoZWFkLCByaWdodC1leWUgKi9cbiAgcjFFOiBzdHJpbmdcbiAgLyoqIHJvdyAxIHJpZ2h0IChubyBiZyk6IHNpZGUgKyBvcHRpb25hbCByYWlzZWQgYXJtICovXG4gIHIxUjogc3RyaW5nXG4gIC8qKiByb3cgMiBsZWZ0IChubyBiZyk6IGFybSArIGJvZHkgY3VydmUgKi9cbiAgcjJMOiBzdHJpbmdcbiAgLyoqIHJvdyAyIHJpZ2h0IChubyBiZyk6IGJvZHkgY3VydmUgKyBhcm0gKi9cbiAgcjJSOiBzdHJpbmdcbn1cblxuY29uc3QgUE9TRVM6IFJlY29yZDxDbGF3ZFBvc2UsIFNlZ21lbnRzPiA9IHtcbiAgZGVmYXVsdDogeyByMUw6ICcg4paQJywgcjFFOiAn4pab4paI4paI4paI4pacJywgcjFSOiAn4paMJywgcjJMOiAn4pad4pacJywgcjJSOiAn4pab4paYJyB9LFxuICAnbG9vay1sZWZ0JzogeyByMUw6ICcg4paQJywgcjFFOiAn4paf4paI4paI4paI4pafJywgcjFSOiAn4paMJywgcjJMOiAn4pad4pacJywgcjJSOiAn4pab4paYJyB9LFxuICAnbG9vay1yaWdodCc6IHsgcjFMOiAnIOKWkCcsIHIxRTogJ+KWmeKWiOKWiOKWiOKWmScsIHIxUjogJ+KWjCcsIHIyTDogJ+KWneKWnCcsIHIyUjogJ+KWm+KWmCcgfSxcbiAgJ2FybXMtdXAnOiB7IHIxTDogJ+KWl+KWnycsIHIxRTogJ+KWm+KWiOKWiOKWiOKWnCcsIHIxUjogJ+KWmeKWlicsIHIyTDogJyDilpwnLCByMlI6ICfilpsgJyB9LFxufVxuXG4vLyBBcHBsZSBUZXJtaW5hbCB1c2VzIGEgYmctZmlsbCB0cmljayAoc2VlIGJlbG93KSwgc28gb25seSBleWUgcG9zZXMgbWFrZVxuLy8gc2Vuc2UuIEFybSBwb3NlcyBmYWxsIGJhY2sgdG8gZGVmYXVsdC5cbmNvbnN0IEFQUExFX0VZRVM6IFJlY29yZDxDbGF3ZFBvc2UsIHN0cmluZz4gPSB7XG4gIGRlZmF1bHQ6ICcg4paXICAg4paWICcsXG4gICdsb29rLWxlZnQnOiAnIOKWmCAgIOKWmCAnLFxuICAnbG9vay1yaWdodCc6ICcg4padICAg4padICcsXG4gICdhcm1zLXVwJzogJyDilpcgICDilpYgJyxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIENsYXdkKHsgcG9zZSA9ICdkZWZhdWx0JyB9OiBQcm9wcyA9IHt9KTogUmVhY3QuUmVhY3ROb2RlIHtcbiAgaWYgKGVudi50ZXJtaW5hbCA9PT0gJ0FwcGxlX1Rlcm1pbmFsJykge1xuICAgIHJldHVybiA8QXBwbGVUZXJtaW5hbENsYXdkIHBvc2U9e3Bvc2V9IC8+XG4gIH1cbiAgY29uc3QgcCA9IFBPU0VTW3Bvc2VdXG4gIHJldHVybiAoXG4gICAgPEJveCBmbGV4RGlyZWN0aW9uPVwiY29sdW1uXCI+XG4gICAgICA8VGV4dD5cbiAgICAgICAgPFRleHQgY29sb3I9XCJjbGF3ZF9ib2R5XCI+e3AucjFMfTwvVGV4dD5cbiAgICAgICAgPFRleHQgY29sb3I9XCJjbGF3ZF9ib2R5XCIgYmFja2dyb3VuZENvbG9yPVwiY2xhd2RfYmFja2dyb3VuZFwiPlxuICAgICAgICAgIHtwLnIxRX1cbiAgICAgICAgPC9UZXh0PlxuICAgICAgICA8VGV4dCBjb2xvcj1cImNsYXdkX2JvZHlcIj57cC5yMVJ9PC9UZXh0PlxuICAgICAgPC9UZXh0PlxuICAgICAgPFRleHQ+XG4gICAgICAgIDxUZXh0IGNvbG9yPVwiY2xhd2RfYm9keVwiPntwLnIyTH08L1RleHQ+XG4gICAgICAgIDxUZXh0IGNvbG9yPVwiY2xhd2RfYm9keVwiIGJhY2tncm91bmRDb2xvcj1cImNsYXdkX2JhY2tncm91bmRcIj5cbiAgICAgICAgICDilojilojilojilojilohcbiAgICAgICAgPC9UZXh0PlxuICAgICAgICA8VGV4dCBjb2xvcj1cImNsYXdkX2JvZHlcIj57cC5yMlJ9PC9UZXh0PlxuICAgICAgPC9UZXh0PlxuICAgICAgPFRleHQgY29sb3I9XCJjbGF3ZF9ib2R5XCI+XG4gICAgICAgIHsnICAnfeKWmOKWmCDilp3ilp17JyAgJ31cbiAgICAgIDwvVGV4dD5cbiAgICA8L0JveD5cbiAgKVxufVxuXG5mdW5jdGlvbiBBcHBsZVRlcm1pbmFsQ2xhd2QoeyBwb3NlIH06IHsgcG9zZTogQ2xhd2RQb3NlIH0pOiBSZWFjdC5SZWFjdE5vZGUge1xuICAvLyBBcHBsZSdzIFRlcm1pbmFsIHJlbmRlcnMgdmVydGljYWwgc3BhY2UgYmV0d2VlbiBjaGFycyBieSBkZWZhdWx0LlxuICAvLyBJdCBkb2VzIE5PVCByZW5kZXIgdmVydGljYWwgc3BhY2UgYmV0d2VlbiBiYWNrZ3JvdW5kIGNvbG9yc1xuICAvLyBzbyB3ZSB1c2UgYmFja2dyb3VuZCBjb2xvciB0byBkcmF3IHRoZSBtYWluIHNoYXBlLlxuICByZXR1cm4gKFxuICAgIDxCb3ggZmxleERpcmVjdGlvbj1cImNvbHVtblwiIGFsaWduSXRlbXM9XCJjZW50ZXJcIj5cbiAgICAgIDxUZXh0PlxuICAgICAgICA8VGV4dCBjb2xvcj1cImNsYXdkX2JvZHlcIj7ilpc8L1RleHQ+XG4gICAgICAgIDxUZXh0IGNvbG9yPVwiY2xhd2RfYmFja2dyb3VuZFwiIGJhY2tncm91bmRDb2xvcj1cImNsYXdkX2JvZHlcIj5cbiAgICAgICAgICB7QVBQTEVfRVlFU1twb3NlXX1cbiAgICAgICAgPC9UZXh0PlxuICAgICAgICA8VGV4dCBjb2xvcj1cImNsYXdkX2JvZHlcIj7ilpY8L1RleHQ+XG4gICAgICA8L1RleHQ+XG4gICAgICA8VGV4dCBiYWNrZ3JvdW5kQ29sb3I9XCJjbGF3ZF9ib2R5XCI+eycgJy5yZXBlYXQoNyl9PC9UZXh0PlxuICAgICAgPFRleHQgY29sb3I9XCJjbGF3ZF9ib2R5XCI+4paY4paYIOKWneKWnTwvVGV4dD5cbiAgICA8L0JveD5cbiAgKVxufVxuIl0sIm1hcHBpbmdzIjoiO0FBQUEsT0FBTyxLQUFLQSxLQUFLLE1BQU0sT0FBTztBQUM5QixTQUFTQyxHQUFHLEVBQUVDLElBQUksUUFBUSxjQUFjO0FBQ3hDLFNBQVNDLEdBQUcsUUFBUSxvQkFBb0I7QUFFeEMsT0FBTyxLQUFLQyxTQUFTLEdBQ2pCLFNBQVMsR0FDVCxTQUFTLENBQUM7QUFBQSxFQUNWLFdBQVcsQ0FBQztBQUFBLEVBQ1osWUFBWSxFQUFDOztBQUVqQixLQUFLQyxLQUFLLEdBQUc7RUFDWEMsSUFBSSxDQUFDLEVBQUVGLFNBQVM7QUFDbEIsQ0FBQzs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxLQUFLRyxRQUFRLEdBQUc7RUFDZDtFQUNBQyxHQUFHLEVBQUUsTUFBTTtFQUNYO0VBQ0FDLEdBQUcsRUFBRSxNQUFNO0VBQ1g7RUFDQUMsR0FBRyxFQUFFLE1BQU07RUFDWDtFQUNBQyxHQUFHLEVBQUUsTUFBTTtFQUNYO0VBQ0FDLEdBQUcsRUFBRSxNQUFNO0FBQ2IsQ0FBQztBQUVELE1BQU1DLEtBQUssRUFBRUMsTUFBTSxDQUFDVixTQUFTLEVBQUVHLFFBQVEsQ0FBQyxHQUFHO0VBQ3pDUSxPQUFPLEVBQUU7SUFBRVAsR0FBRyxFQUFFLElBQUk7SUFBRUMsR0FBRyxFQUFFLE9BQU87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