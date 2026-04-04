/**
 * Early Input Capture
 *
 * This module captures terminal input that is typed before the REPL is fully
 * initialized. Users often type `claude` and immediately start typing their
 * prompt, but those early keystrokes would otherwise be lost during startup.
 *
 * Usage:
 * 1. Call startCapturingEarlyInput() as early as possible in cli.tsx
 * 2. When REPL is ready, call consumeEarlyInput() to get any buffered text
 * 3. stopCapturingEarlyInput() is called automatically when input is consumed
 */

import { lastGrapheme } from './intl.js'

// Buffer for early input characters
let earlyInputBuffer = ''
// Flag to track if we're currently capturing
let isCapturing = false
// Reference to the readable handler so we can remove it later
let readableHandler: (() => void) | null = null

/**
 * Start capturing stdin data early, before the REPL is initialized.
 * Should be called as early as possible in the startup sequence.
 *
 * Only captures if stdin is a TTY (interactive terminal).
 */
export function startCapturingEarlyInput(): void {
  console.log('[earlyInput] 尝试开始捕获早期输入...');
  console.log(`[earlyInput] 检查条件: isTTY=${process.stdin.isTTY}, isCapturing=${isCapturing}, has-p=${process.argv.includes('-p') || process.argv.includes('--print')}`);
  // Only capture in interactive mode: stdin must be a TTY, and we must not
  // be in print mode. Raw mode disables ISIG (terminal Ctrl+C → SIGINT),
  // which would make -p uninterruptible.
  if (
    !process.stdin.isTTY ||
    isCapturing ||
    process.argv.includes('-p') ||
    process.argv.includes('--print')
  ) {
    console.log('[earlyInput] 不满足捕获条件，放弃捕获');
    return
  }

  isCapturing = true
  earlyInputBuffer = '';
  console.log('[earlyInput] 设置捕获状态: isCapturing=true, 缓冲区已清空');

  // Set stdin to raw mode and use 'readable' event like Ink does
  // This ensures compatibility with how the REPL will handle stdin later
  try {
    process.stdin.setEncoding('utf8')
    process.stdin.setRawMode(true)
    process.stdin.ref()

    readableHandler = () => {
      console.log('[earlyInput] readable 事件触发，有数据可读');
      let chunk = process.stdin.read()
      while (chunk !== null) {
        if (typeof chunk === 'string') {
          console.log(`[earlyInput] 读取到数据块: ${JSON.stringify(chunk)}, 长度=${chunk.length}`);
          processChunk(chunk)
        }
        chunk = process.stdin.read()
      }
    }

    process.stdin.on('readable', readableHandler);
    console.log('[earlyInput] 注册 readable 事件处理器成功，开始捕获');
  } catch (error) {
    // If we can't set raw mode, just silently continue without early capture
    isCapturing = false;
    console.error('[earlyInput] 设置捕获失败:', error);
  }
}

/**
 * Process a chunk of input data
 */
function processChunk(str: string): void {
  console.log(`[earlyInput:processChunk] 开始处理数据块: ${JSON.stringify(str)}`);
  let i = 0
  while (i < str.length) {
    const char = str[i]!
    const code = char.charCodeAt(0)
    console.log(`[earlyInput:processChunk] 处理字符[${i}]: char=${JSON.stringify(char)}, code=${code}`);

    // Ctrl+C (code 3) - stop capturing and exit immediately.
    // We use process.exit here instead of gracefulShutdown because at this
    // early stage of startup, the shutdown machinery isn't initialized yet.
    if (code === 3) {
      console.log('[earlyInput:processChunk] 检测到 Ctrl+C，准备退出');
      stopCapturingEarlyInput()
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(130) // Standard exit code for Ctrl+C
      return
    }

    // Ctrl+D (code 4) - EOF, stop capturing
    if (code === 4) {
      console.log('[earlyInput:processChunk] 检测到 Ctrl+D (EOF)，停止捕获');
      stopCapturingEarlyInput()
      return
    }

    // Backspace (code 127 or 8) - remove last grapheme cluster
    if (code === 127 || code === 8) {
      console.log(`[earlyInput:processChunk] 退格键，当前缓冲区长度=${earlyInputBuffer.length}`);
      if (earlyInputBuffer.length > 0) {
        const last = lastGrapheme(earlyInputBuffer)
        earlyInputBuffer = earlyInputBuffer.slice(0, -(last.length || 1))
        console.log(`[earlyInput:processChunk] 删除后缓冲区长度=${earlyInputBuffer.length}`);
      }
      i++
      continue
    }

    // Skip escape sequences (arrow keys, function keys, focus events, etc.)
    // All escape sequences start with ESC (0x1B) and end with a byte in 0x40-0x7E
    if (code === 27) {
      console.log('[earlyInput:processChunk] 检测到转义序列开头，跳过整个序列');
      i++ // Skip the ESC character
      // Skip until the terminating byte (@ to ~) or end of string
      while (
        i < str.length &&
        !(str.charCodeAt(i) >= 64 && str.charCodeAt(i) <= 126)
      ) {
        i++
      }
      if (i < str.length) i++ // Skip the terminating byte
      continue
    }

    // Skip other control characters (except tab and newline)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      console.log(`[earlyInput:processChunk] 跳过控制字符 code=${code}`);
      i++
      continue
    }

    // Convert carriage return to newline
    if (code === 13) {
      console.log('[earlyInput:processChunk] 回车转换为换行，加入缓冲区');
      earlyInputBuffer += '\n'
      i++
      continue
    }

    // Add printable characters and allowed control chars to buffer
    console.log(`[earlyInput:processChunk] 添加字符到缓冲区: ${JSON.stringify(char)}`);
    earlyInputBuffer += char
    i++
  }
  console.log(`[earlyInput:processChunk] 处理完成，当前缓冲区内容: ${JSON.stringify(earlyInputBuffer)}, 长度=${earlyInputBuffer.length}`);
}

/**
 * Stop capturing early input.
 * Called automatically when input is consumed, or can be called manually.
 */
export function stopCapturingEarlyInput(): void {
  console.log(`[earlyInput:stop] 调用 stopCapturingEarlyInput，当前 isCapturing=${isCapturing}`);
  if (!isCapturing) {
    return
  }

  isCapturing = false

  if (readableHandler) {
    console.log('[earlyInput:stop] 移除 readable 事件处理器');
    process.stdin.removeListener('readable', readableHandler)
    readableHandler = null
  }

  console.log('[earlyInput:stop] 停止捕获完成');
  // Don't reset stdin state - the REPL's Ink App will manage stdin state.
  // If we call setRawMode(false) here, it can interfere with the REPL's
  // own stdin setup which happens around the same time.
}

/**
 * Consume any early input that was captured.
 * Returns the captured input and clears the buffer.
 * Automatically stops capturing when called.
 */
export function consumeEarlyInput(): string {
  console.log('[earlyInput:consume] 调用 consumeEarlyInput 消费早期输入');
  stopCapturingEarlyInput()
  const input = earlyInputBuffer.trim()
  console.log(`[earlyInput:consume] 捕获到的早期输入: ${JSON.stringify(input)}, 长度=${input.length}`);
  earlyInputBuffer = ''
  console.log('[earlyInput:consume] 清空缓冲区，返回结果');
  return input
}

/**
 * Check if there is any early input available without consuming it.
 */
export function hasEarlyInput(): boolean {
  const result = earlyInputBuffer.trim().length > 0;
  console.log(`[earlyInput:hasEarlyInput] 检查是否有输入: ${result}, 缓冲区长度=${earlyInputBuffer.length}`);
  return result
}

/**
 * Seed the early input buffer with text that will appear pre-filled
 * in the prompt input when the REPL renders. Does not auto-submit.
 */
export function seedEarlyInput(text: string): void {
  console.log(`[earlyInput:seedEarlyInput] 手动种入文本: ${JSON.stringify(text)}, 长度=${text.length}`);
  earlyInputBuffer = text
}

/**
 * Check if early input capture is currently active.
 */
export function isCapturingEarlyInput(): boolean {
  console.log(`[earlyInput:isCapturing] 当前捕获状态: ${isCapturing}`);
  return isCapturing
}
