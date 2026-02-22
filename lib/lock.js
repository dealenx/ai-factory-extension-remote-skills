import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const LOCK_FILENAME = 'remote-skills-lock.json';

/**
 * @typedef {{
 *   version: number,
 *   skills: Record<string, {
 *     source: string,
 *     sourceType: string,
 *     ref: string,
 *     path: string,
 *     installedAt: string
 *   }>,
 *   agents: Record<string, string[]>
 * }} LockFile
 */

/**
 * Create an empty lock structure.
 * @returns {LockFile}
 */
export function createEmptyLock() {
  return {
    version: 1,
    skills: {},
    agents: {},
  };
}

/**
 * Get the lock file path for a project.
 * @param {string} projectDir
 * @returns {string}
 */
function getLockPath(projectDir) {
  return path.join(projectDir, LOCK_FILENAME);
}

/**
 * Load the lock file from a project directory.
 * Returns an empty lock if the file doesn't exist.
 * @param {string} projectDir
 * @returns {Promise<LockFile>}
 */
export async function loadLock(projectDir) {
  const lockPath = getLockPath(projectDir);
  try {
    const raw = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.version) {
      return {
        version: parsed.version,
        skills: parsed.skills ?? {},
        agents: parsed.agents ?? {},
      };
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return createEmptyLock();
}

/**
 * Save the lock file to a project directory.
 * @param {string} projectDir
 * @param {LockFile} lock
 */
export async function saveLock(projectDir, lock) {
  const lockPath = getLockPath(projectDir);
  await mkdir(path.dirname(lockPath), { recursive: true });
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
}

/**
 * Add a skill to the lock file for the given agents.
 * @param {LockFile} lock
 * @param {string} skillName
 * @param {{ source: string, sourceType: string, ref: string, path: string }} info
 * @param {string[]} agentIds
 */
export function addSkillToLock(lock, skillName, info, agentIds) {
  lock.skills[skillName] = {
    source: info.source,
    sourceType: info.sourceType,
    ref: info.ref,
    path: info.path,
    installedAt: new Date().toISOString(),
  };

  for (const agentId of agentIds) {
    if (!lock.agents[agentId]) {
      lock.agents[agentId] = [];
    }
    if (!lock.agents[agentId].includes(skillName)) {
      lock.agents[agentId].push(skillName);
    }
  }
}

/**
 * Remove a skill from the lock file and from all agents.
 * @param {LockFile} lock
 * @param {string} skillName
 */
export function removeSkillFromLock(lock, skillName) {
  delete lock.skills[skillName];

  for (const agentId of Object.keys(lock.agents)) {
    lock.agents[agentId] = lock.agents[agentId].filter(s => s !== skillName);
    if (lock.agents[agentId].length === 0) {
      delete lock.agents[agentId];
    }
  }
}

/**
 * Get all unique skill names from the lock file.
 * @param {LockFile} lock
 * @returns {string[]}
 */
export function getAllSkillNames(lock) {
  return Object.keys(lock.skills);
}

/**
 * Get the agent IDs that have a specific skill.
 * @param {LockFile} lock
 * @param {string} skillName
 * @returns {string[]}
 */
export function getAgentsForSkill(lock, skillName) {
  const agents = [];
  for (const [agentId, skills] of Object.entries(lock.agents)) {
    if (skills.includes(skillName)) {
      agents.push(agentId);
    }
  }
  return agents;
}
