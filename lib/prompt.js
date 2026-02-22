import readline from 'node:readline';

/**
 * Ask a single-line question and return the answer.
 * @param {string} question
 * @returns {Promise<string>}
 */
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Display a numbered list and let the user pick multiple items (comma-separated).
 *
 * Example output:
 *   1) skill-a -- Some description
 *   2) skill-b -- Another description
 *   3) skill-c
 *
 *   Select (1-3, comma-separated, or "all") [all]: 1,3
 *
 * @param {{ label: string, value: T }[]} choices
 * @param {string} message
 * @returns {Promise<T[]>}
 * @template T
 */
export async function selectMultiple(choices, message = 'Select') {
  if (choices.length === 0) return [];

  for (let i = 0; i < choices.length; i++) {
    console.log(`  ${i + 1}) ${choices[i].label}`);
  }
  console.log('');

  const range = `1-${choices.length}`;
  const answer = await ask(`  ${message} (${range}, comma-separated, or "all") [all]: `);

  // Default = all
  if (answer === '' || answer.toLowerCase() === 'all') {
    return choices.map(c => c.value);
  }

  const indices = answer
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n >= 1 && n <= choices.length);

  const unique = [...new Set(indices)];

  if (unique.length === 0) {
    console.log('  No valid selection. Aborting.');
    return [];
  }

  return unique.map(i => choices[i - 1].value);
}

/**
 * Display a numbered list and let the user pick exactly one item.
 *
 * @param {{ label: string, value: T }[]} choices
 * @param {string} message
 * @returns {Promise<T>}
 * @template T
 */
export async function selectOne(choices, message = 'Select') {
  if (choices.length === 0) return undefined;
  if (choices.length === 1) return choices[0].value;

  for (let i = 0; i < choices.length; i++) {
    console.log(`  ${i + 1}) ${choices[i].label}`);
  }
  console.log('');

  const answer = await ask(`  ${message} (1-${choices.length}) [1]: `);
  const idx = answer === '' ? 1 : parseInt(answer, 10);

  if (isNaN(idx) || idx < 1 || idx > choices.length) {
    console.log('  Invalid selection. Using default (1).');
    return choices[0].value;
  }

  return choices[idx - 1].value;
}
