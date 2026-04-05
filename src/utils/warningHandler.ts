import { posix, win32 } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import { getPlatform } from './platform.js'

// 最大跟踪多少种不同警告，防止无限内存增长
// 超过这个上限后，新的警告不再跟踪，总是上报计数 1
export const MAX_WARNING_KEYS = 1000
// Map 保存每种警告已经出现多少次，key 是 "name: message(前50字符)"
const warningCounts = new Map<string, number>()

/**
 * 检查是否从构建目录运行（开发模式）
 * 这是 getCurrentInstallationType() 中逻辑的同步版本
 * 因为我们必须在初始化早期同步判断，不能异步
 */
function isRunningFromBuildDirectory(): boolean {
  // 获取调用路径和可执行文件路径
  let invokedPath = process.argv[1] || ''
  let execPath = process.execPath || process.argv[0] || ''

  // Windows 上，把反斜杠换成正斜杠，方便路径匹配一致
  if (getPlatform() === 'windows') {
    invokedPath = invokedPath.split(win32.sep).join(posix.sep)
    execPath = execPath.split(win32.sep).join(posix.sep)
  }

  // 需要检查两个路径
  const pathsToCheck = [invokedPath, execPath]
  // 构建目录关键字，只要路径包含这些关键字就是开发构建
  const buildDirs = [
    '/build-ant/',
    '/build-external/',
    '/build-external-native/',
    '/build-ant-native/',
  ]

  // 只要任意一个路径包含任意一个构建目录关键字，就判断为开发构建
  return pathsToCheck.some(path => buildDirs.some(dir => path.includes(dir)))
}

/**
 * 已知的内部警告列表，这些警告不影响使用，对用户隐藏
 * 目前主要是 EventEmitter MaxListeners 警告，来自第三方库
 */
const INTERNAL_WARNINGS = [
  /MaxListenersExceededWarning.*AbortSignal/,
  /MaxListenersExceededWarning.*EventTarget/,
]

/**
 * 判断一个警告是否是已知内部警告
 */
function isInternalWarning(warning: Error): boolean {
  const warningStr = `${warning.name}: ${warning.message}`
  // 正则匹配看是否命中已知内部警告
  return INTERNAL_WARNINGS.some(pattern => pattern.test(warningStr))
}

// 保存我们的警告处理器引用，方便检测是否已经安装过
// 防止重复添加同一个监听器
let warningHandler: ((warning: Error) => void) | null = null

/**
 * 仅用于测试：重置警告处理器状态
 * 移除监听器，清空计数 Map
 */
export function resetWarningHandler(): void {
  if (warningHandler) {
    process.removeListener('warning', warningHandler)
  }
  warningHandler = null
  warningCounts.clear()
}

/**
 * 初始化全局警告处理器
 *
 * 功能：
 * 1. 移除 Node.js 默认警告处理器，不对用户显示警告，避免干扰
 * 2. 所有警告统一收集，上报到数据分析用于监控
 * 3. Debug 模式下才显示给开发者看
 * 4. 限制内存增长，保护内存安全
 */
export function initializeWarningHandler(): void {
  // 获取当前 'warning' 事件的所有监听器
  const currentListeners = process.listeners('warning')
  // 如果我们的处理器已经安装过，就直接返回，不重复安装
  // 幂等操作，多次调用没问题
  if (warningHandler && currentListeners.includes(warningHandler)) {
    return
  }

  // 对外部用户，移除 Node.js 默认处理器，这样警告不会输出到 stderr
  // 对内部用户，只有开发构建保留默认警告输出，方便开发调试
  // 直接在这里同步检查开发模式，避免在初始化阶段异步调用
  // 这保持了和 getCurrentInstallationType() 一样的逻辑，但是同步
  const isDevelopment =
    process.env.NODE_ENV === 'development' || isRunningFromBuildDirectory()
  // 如果不是开发构建（就是发布给用户的版本）
  // 移除所有现存的 warning 监听器，包括 Node 默认的
  if (!isDevelopment) {
    process.removeAllListeners('warning')
  }

  // 创建并保存我们的警告处理器闭包
  warningHandler = (warning: Error) => {
    // 整个处理器包在 try-catch 中
    // 如果处理警告本身出错，静默失败，不影响主程序
    // 不能因为处理警告又抛出新错误，那就雪上加霜了
    try {
      // 生成警告去重 key：警告名称 + 消息前 50 个字符
      // 太长不截的话，相同类型警告因为消息细节不同会被当成不同警告
      // 截前 50 足够区分类型了，也限制了 key 长度
      const warningKey = `${warning.name}: ${warning.message.slice(0, 50)}`
      // 获取这个警告已经出现多少次，默认 0
      const count = warningCounts.get(warningKey) || 0

      // 限制 Map 大小，防止无限内存增长
      // 如果：
      //   1. 这个警告已经有了 → 更新计数，不管大小
      //   2. Map 还没满 → 添加进去
      // 否则：
      //   Map 满了，而且是全新警告 → 不添加，总是上报 count+1 = 1
      // 这样能保证内存不会无限增长，极端情况也没问题
      if (
        warningCounts.has(warningKey) ||
        warningCounts.size < MAX_WARNING_KEYS
      ) {
        // 计数加一
        warningCounts.set(warningKey, count + 1)
      }

      // 判断是不是已知内部警告
      const isInternal = isInternalWarning(warning)

      // 总是上报到 Statsig 数据分析，用于监控
      // 只对内部员工包含完整详情，因为警告可能包含用户代码或文件路径
      // 外部用户不上报具体消息，保护隐私
      logEvent('tengu_node_warning', {
        is_internal: isInternal ? 1 : 0,   // 1 表示是内部警告
        occurrence_count: count + 1,      // 这次是第几次出现
        classname:                         // 警告类名
          warning.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        // 只有内部员工才上报完整消息，隐私保护
        ...(process.env.USER_TYPE === 'ant' && {
          message:
            warning.message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        }),
      })

      // 如果开启了 Debug 模式（CLAUDE_DEBUG 环境变量）
      // 在 debug log 中显示完整警告，方便开发者调试
      if (isEnvTruthy(process.env.CLAUDE_DEBUG)) {
        const prefix = isInternal ? '[Internal Warning]' : '[Warning]'
        logForDebugging(`${prefix} ${warning.toString()}`, { level: 'warn' })
      }
      // 对普通用户：这里什么都不输出，隐藏所有警告
      // 只在后台上报数据分析，不干扰用户
    } catch {
      // 捕获处理过程中的任何错误，静默失败
      // 我们不希望警告处理器本身导致问题
      // 用户本来只是一个警告，结果变崩溃，那就太糟了
    }
  }

  // 把我们的处理器安装到 process 'warning' 事件
  process.on('warning', warningHandler)
}
