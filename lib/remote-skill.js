import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { readFile, readdir, rm, mkdir } from 'node:fs/promises';
import zlib from 'node:zlib';

/**
 * Fetch with timeout helper.
 */
function fetchWithTimeout(url, init = {}) {
  const { timeout = 15000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...rest, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * @typedef {{ host: 'github', owner: string, repo: string, skillPath?: string, ref: string }} RemoteSource
 * @typedef {{ name: string, description: string, dirPath: string, relativePath: string }} DetectedSkill
 */

/**
 * Convert a GitHub URL to the internal github: format.
 *
 * Examples:
 *   https://github.com/owner/repo          -> github:owner/repo
 *   https://github.com/owner/repo.git      -> github:owner/repo
 *   https://github.com/owner/repo/tree/dev -> github:owner/repo#dev
 *   https://github.com/owner/repo/tree/dev/path/to/skill -> github:owner/repo/path/to/skill#dev
 */
function normalizeGitHubUrl(url) {
  let cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '');

  const match = cleaned.match(/^https?:\/\/github\.com\/(.+)$/);
  if (!match) return url;

  const segments = match[1].split('/');
  if (segments.length < 2) return url;

  const owner = segments[0];
  const repo = segments[1];

  // /tree/<ref>[/path...] pattern
  if (segments.length >= 4 && segments[2] === 'tree') {
    const ref = segments[3];
    const skillPath = segments.length > 4 ? segments.slice(4).join('/') : '';
    let result = `github:${owner}/${repo}`;
    if (skillPath) result += `/${skillPath}`;
    result += `#${ref}`;
    return result;
  }

  return `github:${owner}/${repo}`;
}

/**
 * Parse a remote source URI.
 *
 * Supported formats:
 *   github:owner/repo
 *   github:owner/repo#ref
 *   github:owner/repo/skill-path
 *   github:owner/repo/skill-path#ref
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo/tree/branch/skill-path
 *
 * @param {string} uri
 * @returns {RemoteSource}
 */
export function parseRemoteSource(uri) {
  // Normalize GitHub URLs to github: format
  if (uri.startsWith('https://github.com/') || uri.startsWith('http://github.com/')) {
    uri = normalizeGitHubUrl(uri);
  }

  if (!uri.startsWith('github:')) {
    throw new Error(`Unsupported source format: "${uri}". Use github:owner/repo or https://github.com/owner/repo`);
  }

  let body = uri.slice('github:'.length);
  let ref = '';

  const hashIdx = body.indexOf('#');
  if (hashIdx !== -1) {
    ref = body.slice(hashIdx + 1);
    body = body.slice(0, hashIdx);
  }

  const parts = body.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub source: "${uri}". Expected github:owner/repo`);
  }

  const owner = parts[0];
  const repo = parts[1];
  const skillPath = parts.length > 2 ? parts.slice(2).join('/') : undefined;

  return { host: 'github', owner, repo, skillPath, ref };
}

/**
 * Format a RemoteSource back to a URI string.
 * @param {RemoteSource} source
 * @returns {string}
 */
export function formatSourceUri(source) {
  let uri = `github:${source.owner}/${source.repo}`;
  if (source.skillPath) {
    uri += `/${source.skillPath}`;
  }
  if (source.ref && source.ref !== 'main') {
    uri += `#${source.ref}`;
  }
  return uri;
}

/**
 * Resolve the default branch for a GitHub repository.
 * Falls back to 'main' if the API call fails.
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<string>}
 */
async function resolveDefaultBranch(owner, repo) {
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.default_branch) return data.default_branch;
    }
  } catch {
    // API failed, fall back to 'main'
  }
  return 'main';
}

/**
 * Download a repository archive and extract it to a temp directory.
 * Returns the path to the extracted repo root.
 * Also mutates source.ref to the resolved branch if it was empty.
 *
 * Uses Node.js native fetch + zlib + tar parser -- no shell dependencies.
 *
 * @param {RemoteSource} source
 * @returns {Promise<string>}
 */
export async function downloadAndExtract(source) {
  // Resolve default branch if not specified
  if (!source.ref) {
    source.ref = await resolveDefaultBranch(source.owner, source.repo);
  }

  const tmpBase = path.join(os.tmpdir(), `aif-remote-skill-${Date.now()}`);
  await mkdir(tmpBase, { recursive: true });

  const archiveUrl = `https://github.com/${source.owner}/${source.repo}/archive/refs/heads/${source.ref}.tar.gz`;

  try {
    const res = await fetchWithTimeout(archiveUrl, { timeout: 60000 });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${archiveUrl}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    // Decompress gzip -> raw tar
    const tarBuffer = zlib.gunzipSync(buffer);

    // Extract tar archive using pure Node.js parser
    extractTar(tarBuffer, tmpBase);

    // GitHub archives extract to {repo}-{ref}/ directory
    const entries = await listDirectories(tmpBase);
    const repoDir = entries.find(e => e.startsWith(`${source.repo}-`));

    if (!repoDir) {
      throw new Error('Could not find extracted repository directory');
    }

    return path.join(tmpBase, repoDir);
  } catch (error) {
    await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
    const msg = error.message;
    if (msg.includes('HTTP') || msg.includes('fetch') || msg.includes('404')) {
      throw new Error(
        `Failed to download from ${archiveUrl}. ` +
        `Check that the repository "${source.owner}/${source.repo}" exists and branch "${source.ref}" is correct.`,
      );
    }
    throw error;
  }
}

/**
 * Minimal tar extractor -- reads a POSIX/UStar tar buffer and writes files to disk.
 * Supports regular files and directories. Handles long names via pax headers (type 'x').
 *
 * @param {Buffer} tar
 * @param {string} destDir
 */
function extractTar(tar, destDir) {
  let offset = 0;
  let paxPath = '';

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);

    // End-of-archive: two consecutive zero blocks
    if (header.every(b => b === 0)) break;

    // Parse header fields
    const rawName = header.subarray(0, 100).toString('utf-8').replace(/\0+$/g, '');
    const sizeStr = header.subarray(124, 136).toString('utf-8').replace(/\0+$/g, '').trim();
    const typeFlag = String.fromCharCode(header[156]);
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0+$/g, '');

    const fileSize = sizeStr ? parseInt(sizeStr, 8) : 0;
    const entryName = paxPath || (prefix ? `${prefix}/${rawName}` : rawName);
    paxPath = ''; // reset after use

    offset += 512; // advance past header

    if (typeFlag === 'x' || typeFlag === 'g') {
      // Pax extended header -- extract path= field
      const paxData = tar.subarray(offset, offset + fileSize).toString('utf-8');
      const pathMatch = paxData.match(/(?:^|\n)\d+ path=([^\n]+)/);
      if (pathMatch) paxPath = pathMatch[1];
      offset += Math.ceil(fileSize / 512) * 512;
      continue;
    }

    if (typeFlag === '5' || entryName.endsWith('/')) {
      // Directory
      const dirPath = path.join(destDir, entryName);
      fs.mkdirSync(dirPath, { recursive: true });
    } else if (typeFlag === '0' || typeFlag === '' || typeFlag === '\0') {
      // Regular file
      const filePath = path.join(destDir, entryName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const data = tar.subarray(offset, offset + fileSize);
      fs.writeFileSync(filePath, data);
    }
    // Skip symlinks, hardlinks, etc.

    // Advance past data blocks (512-byte aligned)
    offset += Math.ceil(fileSize / 512) * 512;
  }
}

/**
 * Resolve the current commit hash for a remote source using the GitHub API.
 * @param {RemoteSource} source
 * @returns {Promise<string>}
 */
export async function resolveCommitHash(source) {
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${source.ref}`,
      { headers: { Accept: 'application/vnd.github.sha' } },
    );
    if (res.ok) {
      const text = await res.text();
      return text.trim().slice(0, 12);
    }
  } catch {
    // Fallback below
  }
  return `unknown-${Date.now()}`;
}

/**
 * Extract the `name:` and `description:` from SKILL.md YAML frontmatter.
 * @param {string} content
 * @returns {{ name: string, description: string }}
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) {
    return { name: '', description: '' };
  }

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch ? nameMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim().slice(0, 100) : '',
  };
}

/**
 * List subdirectory names in a given directory.
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
async function listDirectories(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

/**
 * Check if a file exists.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a text file, return null if it doesn't exist.
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function readTextFile(filePath) {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Detect skills in a downloaded repository.
 *
 * Detection order:
 * 1. SKILL.md at root -> single skill (entire repo is one skill)
 * 2. skills\/*\/SKILL.md -> collection in skills/ subdirectory
 * 3. *\/SKILL.md at first level -> collection at root level
 *
 * @param {string} repoDir
 * @returns {Promise<DetectedSkill[]>}
 */
export async function detectSkills(repoDir) {
  // Pattern 1: Single skill -- SKILL.md at root
  const rootSkillMd = path.join(repoDir, 'SKILL.md');
  if (await fileExists(rootSkillMd)) {
    const content = await readTextFile(rootSkillMd);
    const { name, description } = parseFrontmatter(content ?? '');
    const dirName = path.basename(repoDir);
    return [{
      name: name || dirName,
      description,
      dirPath: repoDir,
      relativePath: '',
    }];
  }

  // Pattern 2: Collection in skills/ directory
  const skillsSubDir = path.join(repoDir, 'skills');
  if (await fileExists(skillsSubDir)) {
    const skills = await scanForSkills(skillsSubDir, 'skills');
    if (skills.length > 0) return skills;
  }

  // Pattern 3: Collection at root level
  const rootSkills = await scanForSkills(repoDir, '');
  if (rootSkills.length > 0) return rootSkills;

  throw new Error('No skills found in repository. Expected SKILL.md at root or in subdirectories.');
}

/**
 * Scan a directory for skill subdirectories (those containing SKILL.md).
 * @param {string} parentDir
 * @param {string} relativePrefix
 * @returns {Promise<DetectedSkill[]>}
 */
async function scanForSkills(parentDir, relativePrefix) {
  const skills = [];
  const dirs = await listDirectories(parentDir);

  for (const dir of dirs) {
    // Skip hidden directories and common non-skill directories
    if (dir.startsWith('.') || dir.startsWith('_') || dir === 'node_modules') continue;

    const skillMdPath = path.join(parentDir, dir, 'SKILL.md');
    if (await fileExists(skillMdPath)) {
      const content = await readTextFile(skillMdPath);
      const { name, description } = parseFrontmatter(content ?? '');
      skills.push({
        name: name || dir,
        description,
        dirPath: path.join(parentDir, dir),
        relativePath: relativePrefix ? `${relativePrefix}/${dir}` : dir,
      });
    }
  }

  return skills;
}

/**
 * Clean up a temp directory created by downloadAndExtract.
 * @param {string} repoDir
 */
export async function cleanupTemp(repoDir) {
  const tmpBase = path.dirname(repoDir);
  if (tmpBase.includes('aif-remote-skill-')) {
    await rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  }
}
