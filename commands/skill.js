import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { selectMultiple, selectOne } from '../lib/prompt.js';
import {
  parseRemoteSource,
  downloadAndExtract,
  detectSkills,
  resolveCommitHash,
  cleanupTemp,
} from '../lib/remote-skill.js';
import {
  loadLock,
  saveLock,
  addSkillToLock,
  removeSkillFromLock,
  getAllSkillNames,
} from '../lib/lock.js';
import {
  installSkillForAgent,
  removeSkillForAgent,
  skillExistsForAgent,
} from '../lib/installer.js';

/**
 * Load .ai-factory.json from the project directory.
 * @param {string} projectDir
 * @returns {Promise<object|null>}
 */
async function loadManifest(projectDir) {
  try {
    const raw = await readFile(resolve(projectDir, '.ai-factory.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get agent IDs and their skillsDir from the manifest.
 * @param {object} manifest
 * @returns {{ id: string, skillsDir: string }[]}
 */
function getAgents(manifest) {
  if (!manifest?.agents || !Array.isArray(manifest.agents)) return [];
  return manifest.agents.map(a => ({
    id: a.id,
    skillsDir: a.skillsDir,
  }));
}

// ----------------------------------------------------------------
// skill add
// ----------------------------------------------------------------

async function skillAddCommand(source) {
  const projectDir = process.cwd();

  console.log('\n  AI Factory - Add Remote Skill\n');

  const manifest = await loadManifest(projectDir);
  const agents = getAgents(manifest);
  if (agents.length === 0) {
    console.error('Error: No .ai-factory.json found or no agents configured.');
    console.error('Run "ai-factory init" first.');
    process.exit(1);
  }

  // 1. Parse source
  let parsed;
  try {
    parsed = parseRemoteSource(source);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  // 2. Download
  console.log(`  Downloading ${parsed.owner}/${parsed.repo}...`);
  let repoDir;
  try {
    repoDir = await downloadAndExtract(parsed);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  try {
    // 3. Detect skills
    const allDetected = await detectSkills(repoDir);

    // 4. Filter by skillPath if specified
    let selectedSkills;

    if (parsed.skillPath) {
      const match = allDetected.find(
        s => s.relativePath === parsed.skillPath || s.name === parsed.skillPath,
      );
      if (!match) {
        console.error(`Skill "${parsed.skillPath}" not found in repository.`);
        console.log('Available skills:');
        for (const s of allDetected) {
          console.log(`  - ${s.name} (${s.relativePath || 'root'})`);
        }
        process.exit(1);
      }
      selectedSkills = [match];
    } else if (allDetected.length === 1) {
      selectedSkills = allDetected;
      console.log(`  Detected skill: ${allDetected[0].name}`);
    } else {
      // Interactive selection for collections
      console.log(`  Found ${allDetected.length} skills:\n`);

      const chosen = await selectMultiple(
        allDetected.map(s => ({
          label: `${s.name}${s.description ? ` -- ${s.description}` : ''}`,
          value: s.name,
        })),
        'Select skills to install',
      );

      selectedSkills = allDetected.filter(s => chosen.includes(s.name));
    }

    if (selectedSkills.length === 0) {
      console.log('No skills to install.');
      return;
    }

    // 5. Resolve commit hash for versioning
    const version = await resolveCommitHash(parsed);

    // 6. Load lock file
    const lock = await loadLock(projectDir);
    const agentIds = agents.map(a => a.id);

    // 7. Install for each agent
    console.log('');
    for (const skill of selectedSkills) {
      for (const agent of agents) {
        await installSkillForAgent(projectDir, agent.skillsDir, skill.name, skill.dirPath);
      }

      addSkillToLock(lock, skill.name, {
        source: `github:${parsed.owner}/${parsed.repo}`,
        sourceType: 'github',
        ref: parsed.ref,
        path: skill.relativePath,
      }, agentIds);

      const agentNames = agents.map(a => a.id).join(', ');
      console.log(`  + ${skill.name} [${agentNames}]`);
    }

    // 8. Save lock
    await saveLock(projectDir, lock);
    console.log(`\n  Done. ${selectedSkills.length} skill(s) installed.\n`);
  } finally {
    await cleanupTemp(repoDir);
  }
}

// ----------------------------------------------------------------
// skill remove
// ----------------------------------------------------------------

async function skillRemoveCommand(name) {
  const projectDir = process.cwd();

  console.log('\n  AI Factory - Remove Remote Skill\n');

  const manifest = await loadManifest(projectDir);
  const agents = getAgents(manifest);
  if (agents.length === 0) {
    console.error('Error: No .ai-factory.json found or no agents configured.');
    process.exit(1);
  }

  const lock = await loadLock(projectDir);
  const allNames = getAllSkillNames(lock);

  if (allNames.length === 0) {
    console.log('No remote skills installed.');
    return;
  }

  // Determine which skills to remove
  let skillsToRemove;

  if (name) {
    if (!lock.skills[name]) {
      console.error(`Remote skill "${name}" not found.`);
      return;
    }
    skillsToRemove = [name];
  } else {
    // Interactive selection
    const chosen = await selectMultiple(
      allNames.map(n => {
        const info = lock.skills[n];
        const source = info ? ` (${info.source})` : '';
        return { label: `${n}${source}`, value: n };
      }),
      'Select remote skills to remove',
    );

    if (chosen.length === 0) return;
    skillsToRemove = chosen;
  }

  // Remove selected skills from all agents
  const affectedAgents = new Set();

  for (const skillName of skillsToRemove) {
    for (const agent of agents) {
      // Check if this agent had the skill
      if (lock.agents[agent.id]?.includes(skillName)) {
        await removeSkillForAgent(projectDir, agent.skillsDir, skillName);
        affectedAgents.add(agent.id);
        console.log(`  - Removed "${skillName}" from ${agent.id}`);
      }
    }
    removeSkillFromLock(lock, skillName);
  }

  await saveLock(projectDir, lock);

  const skillLabel = skillsToRemove.length === 1 ? `"${skillsToRemove[0]}"` : `${skillsToRemove.length} skill(s)`;
  const agentLabel = affectedAgents.size === 1 ? '1 agent' : `${affectedAgents.size} agents`;
  console.log(`\n  Done. Removed ${skillLabel} from ${agentLabel}.\n`);
}

// ----------------------------------------------------------------
// skill list
// ----------------------------------------------------------------

async function skillListCommand() {
  const projectDir = process.cwd();

  const manifest = await loadManifest(projectDir);
  const agents = getAgents(manifest);

  const lock = await loadLock(projectDir);
  const allNames = getAllSkillNames(lock);

  if (allNames.length === 0) {
    console.log('\n  No remote skills installed.\n');
    return;
  }

  console.log('\n  Remote Skills\n');

  for (const name of allNames) {
    const info = lock.skills[name];
    const age = timeSince(info.installedAt);
    const skillAgents = [];
    for (const [agentId, skills] of Object.entries(lock.agents)) {
      if (skills.includes(name)) skillAgents.push(agentId);
    }

    console.log(`  ${name}`);
    console.log(`    Source:  ${info.source}${info.ref ? `#${info.ref}` : ''}`);
    console.log(`    Agents:  ${skillAgents.join(', ') || 'none'}`);
    console.log(`    Added:   ${age}`);
    console.log('');
  }
}

function timeSince(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

// ----------------------------------------------------------------
// skill update
// ----------------------------------------------------------------

async function skillUpdateCommand(name) {
  const projectDir = process.cwd();

  console.log('\n  AI Factory - Update Remote Skills\n');

  const manifest = await loadManifest(projectDir);
  const agents = getAgents(manifest);
  if (agents.length === 0) {
    console.error('Error: No .ai-factory.json found or no agents configured.');
    process.exit(1);
  }

  const lock = await loadLock(projectDir);
  let allNames = getAllSkillNames(lock);

  if (allNames.length === 0) {
    console.log('No remote skills installed.');
    return;
  }

  // Filter by name if specified
  if (name) {
    if (!lock.skills[name]) {
      console.error(`Remote skill "${name}" not found.`);
      return;
    }
    allNames = [name];
  } else if (allNames.length > 1) {
    // Ask: update all or select
    const mode = await selectOne(
      [
        { label: 'All remote skills', value: 'all' },
        { label: 'Select skills to update', value: 'select' },
      ],
      'What would you like to update?',
    );

    if (mode === 'select') {
      const chosen = await selectMultiple(
        allNames.map(n => {
          const info = lock.skills[n];
          const source = info ? ` (${info.source})` : '';
          return { label: `${n}${source}`, value: n };
        }),
        'Select skills to update',
      );
      if (chosen.length === 0) return;
      allNames = chosen;
    }
  }

  // Group skills by source+ref for efficient downloading
  const sourceGroups = new Map();

  for (const skillName of allNames) {
    const info = lock.skills[skillName];
    if (!info) continue;
    const key = `${info.source}#${info.ref}`;
    if (!sourceGroups.has(key)) {
      const parsed = parseRemoteSource(info.source + (info.ref && info.ref !== 'main' ? `#${info.ref}` : ''));
      sourceGroups.set(key, {
        source: info.source,
        ref: info.ref,
        owner: parsed.owner,
        repo: parsed.repo,
        skills: [],
      });
    }
    sourceGroups.get(key).skills.push(skillName);
  }

  let updatedCount = 0;

  console.log('');

  for (const [, group] of sourceGroups) {
    const source = { host: 'github', owner: group.owner, repo: group.repo, ref: group.ref };

    // Download repo
    console.log(`  Downloading ${group.owner}/${group.repo}...`);
    let repoDir;
    try {
      repoDir = await downloadAndExtract(source);
    } catch (error) {
      console.error(`  Failed to download ${group.source}: ${error.message}`);
      continue;
    }

    try {
      const allDetected = await detectSkills(repoDir);

      for (const skillName of group.skills) {
        const info = lock.skills[skillName];
        const detected = allDetected.find(
          d => d.name === skillName || d.relativePath === info.path,
        );

        if (!detected) {
          console.log(`  ${skillName}: not found in updated repo, skipping`);
          continue;
        }

        // Reinstall for all agents that have it
        const skillAgents = [];
        for (const [agentId, skills] of Object.entries(lock.agents)) {
          if (skills.includes(skillName)) skillAgents.push(agentId);
        }

        for (const agentId of skillAgents) {
          const agent = agents.find(a => a.id === agentId);
          if (!agent) continue;
          await installSkillForAgent(projectDir, agent.skillsDir, skillName, detected.dirPath);
        }

        // Update lock entry timestamp
        lock.skills[skillName].installedAt = new Date().toISOString();

        console.log(`  + ${skillName} updated [${skillAgents.join(', ')}]`);
        updatedCount++;
      }
    } finally {
      await cleanupTemp(repoDir);
    }
  }

  await saveLock(projectDir, lock);

  console.log('');
  if (updatedCount > 0) {
    console.log(`  Done. Updated ${updatedCount} skill(s).\n`);
  } else {
    console.log('  All skills are up to date.\n');
  }
}

// ----------------------------------------------------------------
// skill sync
// ----------------------------------------------------------------

async function skillSyncCommand() {
  const projectDir = process.cwd();

  console.log('\n  AI Factory - Sync Remote Skills\n');

  const manifest = await loadManifest(projectDir);
  const agents = getAgents(manifest);
  if (agents.length === 0) {
    console.error('Error: No .ai-factory.json found or no agents configured.');
    process.exit(1);
  }

  const lock = await loadLock(projectDir);
  const allNames = getAllSkillNames(lock);

  if (allNames.length === 0) {
    console.log('  No remote skills in lock file. Nothing to sync.\n');
    return;
  }

  const currentAgentIds = new Set(agents.map(a => a.id));
  const lockAgentIds = new Set(Object.keys(lock.agents));

  let installed = 0;
  let removed = 0;
  let cleaned = 0;

  // 1. Find skills that need to be installed for new/existing agents
  const needsDownload = new Map(); // source key -> { parsed, skillNames[] }

  for (const skillName of allNames) {
    const info = lock.skills[skillName];
    if (!info) continue;

    for (const agent of agents) {
      const hasInLock = lock.agents[agent.id]?.includes(skillName);
      const existsOnDisk = await skillExistsForAgent(projectDir, agent.skillsDir, skillName);

      if (!existsOnDisk) {
        // Need to re-download and install
        const key = `${info.source}#${info.ref}`;
        if (!needsDownload.has(key)) {
          needsDownload.set(key, { info, skills: new Map() });
        }
        const group = needsDownload.get(key);
        if (!group.skills.has(skillName)) {
          group.skills.set(skillName, []);
        }
        group.skills.get(skillName).push(agent);
      }
    }
  }

  // 2. Download and install missing skills
  for (const [, group] of needsDownload) {
    const { info } = group;
    let parsed;
    try {
      parsed = parseRemoteSource(info.source + (info.ref && info.ref !== 'main' ? `#${info.ref}` : ''));
    } catch (error) {
      console.error(`  Error parsing source "${info.source}": ${error.message}`);
      continue;
    }

    console.log(`  Downloading ${parsed.owner}/${parsed.repo}...`);
    let repoDir;
    try {
      repoDir = await downloadAndExtract(parsed);
    } catch (error) {
      console.error(`  Failed to download ${info.source}: ${error.message}`);
      continue;
    }

    try {
      const allDetected = await detectSkills(repoDir);

      for (const [skillName, agentsToInstall] of group.skills) {
        const lockInfo = lock.skills[skillName];
        const detected = allDetected.find(
          d => d.name === skillName || d.relativePath === lockInfo?.path,
        );

        if (!detected) {
          console.log(`  ${skillName}: not found in repo, skipping`);
          continue;
        }

        for (const agent of agentsToInstall) {
          await installSkillForAgent(projectDir, agent.skillsDir, skillName, detected.dirPath);
          console.log(`  + ${skillName} -> ${agent.id}`);
          installed++;
        }
      }
    } finally {
      await cleanupTemp(repoDir);
    }
  }

  // 3. Update lock.agents to match current agents
  //    - Add new agents (install all lock skills for them)
  for (const agent of agents) {
    if (!lock.agents[agent.id]) {
      lock.agents[agent.id] = [...allNames];
    } else {
      // Ensure all skills are listed
      for (const skillName of allNames) {
        if (!lock.agents[agent.id].includes(skillName)) {
          lock.agents[agent.id].push(skillName);
        }
      }
    }
  }

  // 4. Remove agents from lock that no longer exist in .ai-factory.json
  for (const agentId of lockAgentIds) {
    if (!currentAgentIds.has(agentId)) {
      delete lock.agents[agentId];
      console.log(`  - Removed agent "${agentId}" from lock (no longer in .ai-factory.json)`);
      cleaned++;
    }
  }

  // 5. Remove skill directories from agents that were removed from .ai-factory.json
  //    (they're gone from config, so we can't know their skillsDir — just clean the lock)

  await saveLock(projectDir, lock);

  console.log('');
  if (installed > 0 || removed > 0 || cleaned > 0) {
    const parts = [];
    if (installed > 0) parts.push(`${installed} installed`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (cleaned > 0) parts.push(`${cleaned} agent(s) cleaned from lock`);
    console.log(`  Done. ${parts.join(', ')}.\n`);
  } else {
    console.log('  Everything is in sync.\n');
  }
}

// ----------------------------------------------------------------
// register
// ----------------------------------------------------------------

export function register(program) {
  const skill = program
    .command('skill')
    .description('Manage remote skills');

  skill
    .command('add <source>')
    .description('Install skill from GitHub repository')
    .action(skillAddCommand);

  skill
    .command('remove [name]')
    .description('Remove a remote skill')
    .action(skillRemoveCommand);

  skill
    .command('list')
    .description('List installed remote skills')
    .action(skillListCommand);

  skill
    .command('update [name]')
    .description('Update remote skills from their sources')
    .action(skillUpdateCommand);

  skill
    .command('sync')
    .description('Sync remote skills with current agents from .ai-factory.json')
    .action(skillSyncCommand);
}
