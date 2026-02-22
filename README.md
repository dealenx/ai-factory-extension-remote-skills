# ai-factory-extension-remote-skills

AI Factory extension for managing remote skills from GitHub repositories.

## Install

```bash
ai-factory extension add https://github.com/dealenx/ai-factory-extension-remote-skills
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

## Usage

```bash
$ ai-factory skill add https://github.com/zarazhangrui/frontend-slides -y

  AI Factory - Add Remote Skill

  Downloading zarazhangrui/frontend-slides...
  Detected skill: frontend-slides

  + frontend-slides [claude, opencode]

  Done. 1 skill(s) installed.
```

## Requirements

- Node.js 18+
- ai-factory v2.2.0+
