import { cp, rm, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Install a skill directory into an agent's skills directory.
 *
 * Copies the entire skill directory (containing SKILL.md and any
 * references, templates, etc.) into the agent's skillsDir.
 *
 * @param {string} projectDir - Project root directory
 * @param {string} agentSkillsDir - Agent's skills directory relative to projectDir (e.g. ".claude/skills")
 * @param {string} skillName - Name of the skill (used as directory name)
 * @param {string} sourceDir - Absolute path to the source skill directory
 */
export async function installSkillForAgent(projectDir, agentSkillsDir, skillName, sourceDir) {
  const targetDir = path.join(projectDir, agentSkillsDir, skillName);
  await mkdir(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

/**
 * Remove a skill directory from an agent's skills directory.
 *
 * @param {string} projectDir - Project root directory
 * @param {string} agentSkillsDir - Agent's skills directory relative to projectDir
 * @param {string} skillName - Name of the skill to remove
 */
export async function removeSkillForAgent(projectDir, agentSkillsDir, skillName) {
  const targetDir = path.join(projectDir, agentSkillsDir, skillName);
  await rm(targetDir, { recursive: true, force: true });
}

/**
 * Check if a skill directory exists in an agent's skills directory.
 *
 * @param {string} projectDir - Project root directory
 * @param {string} agentSkillsDir - Agent's skills directory relative to projectDir
 * @param {string} skillName - Name of the skill
 * @returns {Promise<boolean>}
 */
export async function skillExistsForAgent(projectDir, agentSkillsDir, skillName) {
  const targetDir = path.join(projectDir, agentSkillsDir, skillName);
  try {
    await access(targetDir);
    return true;
  } catch {
    return false;
  }
}
