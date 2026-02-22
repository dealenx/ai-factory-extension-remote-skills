import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function register(program) {
  program
    .command('hello-agents')
    .description('Say hello to all agents defined in .ai-factory.json manifest')
    .option('--manifest <path>', 'Path to .ai-factory.json', '.ai-factory.json')
    .action(async (opts) => {
      const manifestPath = resolve(process.cwd(), opts.manifest);

      let manifest;
      try {
        const raw = await readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(raw);
      } catch (err) {
        console.error(`Could not read manifest: ${manifestPath}`);
        console.error(err.message);
        process.exit(1);
      }

      const agents = manifest.agents;
      if (!agents || agents.length === 0) {
        console.log('No agents found in manifest.');
        return;
      }

      console.log(`Found ${agents.length} agent(s) in ${opts.manifest}:\n`);

      for (const agent of agents) {
        const name = agent.displayName || agent.id;
        const skillsCount = agent.installedSkills ? agent.installedSkills.length : 0;
        console.log(`  Hello, ${name}! (skills: ${skillsCount})`);
      }

      console.log('\nAll agents greeted!');
    });
}
