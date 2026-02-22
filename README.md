# ai-factory-extension-remote-skills

AI Factory extension for managing remote skills from GitHub repositories.

## Install

```bash
ai-factory extension add https://github.com/user/ai-factory-extension-remote-skills
```

## Commands

```bash
ai-factory skill add github:owner/repo       # install skills from repo
ai-factory skill add github:owner/repo#dev   # specific branch
ai-factory skill remove [name]               # remove skill (interactive if no name)
ai-factory skill list                        # list installed remote skills
ai-factory skill update [name]               # re-download from source
ai-factory skill sync                        # sync skills with current agents
```

## Requirements

- Node.js 18+
- ai-factory v2.2.0+
