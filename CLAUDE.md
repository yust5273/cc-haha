# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Running the project
```bash
./bin/claude-haha                          # Start interactive TUI mode
./bin/claude-haha -p "your prompt here"  # Headless print mode
./bin/claude-haha --help                   # Show all CLI options
bun run start                              # Alternative via bun
```

### Install dependencies
```bash
bun install
cp .env.example .env                      # Configure environment
# Edit .env to add your ANTHROPIC_API_KEY
```

## Architecture Overview

This is a local build of Claude Code - a fully featured AI coding assistant terminal UI.

### Entry Points
- `bin/claude-haha` - Shell script launcher
- `src/entrypoints/cli.tsx` - CLI bootstrap with fast-path routing. Does early environment setup and quick handling for special commands before loading full TUI.
- `src/main.tsx` (~8000 lines) - Full interactive CLI main logic, sets up Commander.js and React/Ink TUI
- `src/localRecoveryCli.ts` - Fallback recovery CLI when TUI fails

### Key Systems

**Early Input Capture** (`src/utils/earlyInput.ts`): Captures user keystrokes during startup before REPL is ready to prevent input loss.

**Fast-path Routing**: Special commands (version, daemon, remote-control, etc.) are handled via dynamic imports in `cli.tsx` before loading the full `main.tsx` for faster startup.

**UI Layer**: Built with React + Ink for terminal rendering. Main REPL screen in `src/screens/REPL.tsx`, components in `src/components/`.

**Tool System**: Tools defined in `src/tools/` (Bash, Read, Edit, Grep, Glob, Agent, etc.), registered in `src/tools.ts`.

**Slash Commands**: `/commit`, `/review-pr`, `/memory`, `/tasks` etc. in `src/commands/`, registered in `src/commands.ts`.

**Skills System**: Extensible capability system for predefined workflows. See `docs/skills/` for documentation.

**Multi-Agent System**: Supports parallel agent execution and team collaboration. See `docs/agent/`.

**Memory System**: AutoDream persistent memory consolidation across sessions. See `docs/memory/`.

**Computer Use**: Desktop control (screenshot, mouse, keyboard) via MCP. See `docs/features/computer-use.md`.

### Key Directories
- `src/entrypoints/` - Entry points (cli.tsx is the main one)
- `src/utils/` - Utilities (earlyInput, config, auth, startup profiling)
- `src/tools/` - Individual tool implementations
- `src/commands/` - Slash command implementations
- `src/components/` - React UI components for Ink
- `src/services/` - Service layer (API, policy, MCP, etc.)
- `src/skills/` - Skill system implementation
- `docs/` - Detailed documentation (architecture, features, guides)

### Build Notes
- Uses Bun as the runtime/module bundler
- Uses TypeScript
- Uses `bun:bundle` feature flags for dead code elimination at build time
- Environment variables must be set early (before importing modules) because many features read them at module load time

### Environment Configuration
Copy `.env.example` to `.env` and set:
- `ANTHROPIC_API_KEY` - Your Anthropic API key (required)
- See `docs/guide/env-vars.md` for all available options

For third-party models (OpenAI, DeepSeek, Ollama, etc.), see `docs/guide/third-party-models.md`.
