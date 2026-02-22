# aif-ext-remote-skills

AI Factory extension for managing remote skills from GitHub repositories.

## Install

```bash
ai-factory extension add ./path/to/ai-factory-extension-remote-skills
```

Or from a git repository:

```bash
ai-factory extension add https://github.com/user/ai-factory-extension-remote-skills
```

## Commands

### `skill add <source>`

Install skills from a GitHub repository into all configured agents.

```bash
# Short format
ai-factory skill add github:owner/repo

# With branch
ai-factory skill add github:owner/repo#develop

# With specific skill path
ai-factory skill add github:owner/repo/my-skill

# Full GitHub URL
ai-factory skill add https://github.com/owner/repo

# URL with branch and path
ai-factory skill add https://github.com/owner/repo/tree/main/my-skill
```

If the repository contains multiple skills, an interactive prompt lets you select which ones to install.

### `skill remove [name]`

Remove an installed remote skill from all agents.

```bash
# Remove by name
ai-factory skill remove my-skill

# Interactive selection (no name argument)
ai-factory skill remove
```

### `skill list`

List all installed remote skills with their source, agents, and install date.

```bash
ai-factory skill list
```

### `skill update [name]`

Re-download and reinstall remote skills from their original sources.

```bash
# Update a specific skill
ai-factory skill update my-skill

# Update all (interactive: all or select)
ai-factory skill update
```

## Skill Detection

The extension detects skills in downloaded repositories using three patterns (checked in order):

1. **Single skill** -- `SKILL.md` at the repository root
2. **Collection in skills/** -- `skills/*/SKILL.md` subdirectories
3. **Collection at root** -- `*/SKILL.md` first-level subdirectories

Each skill directory must contain a `SKILL.md` file. Optional YAML frontmatter provides metadata:

```markdown
---
name: my-skill
description: Short description of the skill
---

# Skill instructions here...
```

## Lock File

Installed skills are tracked in `remote-skills-lock.json` at the project root:

```json
{
  "version": 1,
  "skills": {
    "my-skill": {
      "source": "github:owner/repo",
      "sourceType": "github",
      "ref": "main",
      "path": "my-skill",
      "installedAt": "2026-02-23T10:00:00.000Z"
    }
  },
  "agents": {
    "claude": ["my-skill"],
    "opencode": ["my-skill"]
  }
}
```

## How It Works

1. Parses the source URI (GitHub shorthand or full URL)
2. Downloads the repository as a `.tar.gz` archive via GitHub's archive API
3. Extracts using a pure Node.js tar parser (no shell dependencies)
4. Detects skills by scanning for `SKILL.md` files
5. Copies skill directories into each agent's `skillsDir` (from `.ai-factory.json`)
6. Records installation in `remote-skills-lock.json`

## Requirements

- Node.js 18+ (for native `fetch`)
- ai-factory v2.2.0+ (extension system support)
