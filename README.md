# Hardcode

An early developer-first agentic code editor prototype.

Is this you? You start a project determined to check everything your agents do. Then the diffs pile up, two agents need separate worktrees, the setup gets copied three times, and eventually you stop looking quite so closely. The agents keep coding. The project turns to slop.

Hardcode is built for that exact problem. Every task gets its own lightweight overlay, so multiple agents can work on the same project without duplicating the repo. You can inspect, mount, and switch between their changes without losing track of what belongs where. It’s an agentic editor for people who want agents to help them write code, not quietly take over their project. So basically taking the vibe out of vibe coding and replacing it with your hard logic and a good overiew.

## What Hardcode Offers

### Work with Tasks by Default

Hardcode works with overlays instead of git worktrees, meaning the agent tools simulate a full environment when in reality the changed files get created automatically. No large worktrees, no waiting, no additional setups.

### Multi Repo

Bigger Projects consist of multiple git repositories. A Hardcode workspace can include multiple repos, so your agents can work holistically.

### Task Mounting

You can mount a task to have it be automatically mirrored to your master directory giving you all your usual features like hot reloads while still having the advantages of working in an overlay. With one click you can switch the mounting of different tasks.

### Sparse and Comprehensible

No endless prose and long-winded explanations. The Pi agent gives concise responses while the chat stays clean of unnecessary clutter. You see all important things like when the agent reads files but in a very compact way instead of stuffing your chat window with large command outputs. Code diffs are of course also directly viewable in the chat.

### Powerful Task and Change Based Diff

Not only that you get a diff for each task but you can also commit changes to your task and work with change-based diffs as well. No more huge diffs with multiple different features crammed together.

### Code Editing

While Hardcode doesn't try to be a full IDE or feature-rich code editor you can still make changes directly in a task overlay yourself.

## Install and run

`npm install`
`npm run dev` (WIP project: currently full build untested, therefore use `npm run dev`)

Pi is embedded as the coding-agent runtime. Once you open Hardcode type `/login`, to log in to your AI provider of choice, run `/model` to change the model.

## Info: Secure agent Bash

The embedded Pi SDK session replaces the agent-facing `bash` tool with a fail-closed, read-only sandbox.

- Linux requires `bubblewrap` (`bwrap`) on `PATH`.
- On Windows 10/11, Hardcode uses an already-installed WSL distribution; it does not add another distribution if one exists. If `bubblewrap` is missing, it installs the package in the first existing distribution as WSL `root` using `apt-get`, `dnf`, or `pacman`, then verifies it. If no WSL distribution exists, startup offers an elevated `wsl --install -d Ubuntu` setup. A restart may be required.
- On macOS Bash is fully disabled until a dedicated sandbox adapter is implemented.

## But Why Electron?!!!1111!1!1

I am not a fan of having a full Chromium for every small app either but the choice is only natural. The Pi Agent on which Hardcode is built already uses Node.js anyway and with projects like CodeMirror and the vast web ecosystem functionality can be added quickly and if needed or wanted in the future we could even use components of VS Code.