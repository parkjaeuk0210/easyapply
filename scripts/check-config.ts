import { existsSync, statSync } from 'node:fs';
import { configurationIssues, providerSetting } from '../src/lib/server/config';
import { detectProvider } from '../src/lib/llm';

// Values never leave this process. Do not print process.env or parsed files.
async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const production = process.argv.includes('--production');
  if (production) Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1' });
  const issues = configurationIssues();
  // Use the app's own provider choice so a misspelled provider can never pass as ready.
  const provider = await detectProvider();
  const setting = providerSetting();
  if (production && provider === 'none' && setting !== 'demo') issues.push('ai_provider');
  if (production && setting === 'cli') issues.push('local_cli_cannot_deploy');
  if (existsSync('.env.local') && (statSync('.env.local').mode & 0o077)) issues.push('local_env_permissions_use_chmod_600');
  console.log(JSON.stringify({ mode: production ? 'vercel-production' : 'local', ready: issues.length === 0, provider, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
