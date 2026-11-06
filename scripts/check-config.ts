import { existsSync, statSync } from 'node:fs';
import { configurationIssues } from '../src/lib/server/config';

// Values never leave this process. Do not print process.env or parsed files.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const production = process.argv.includes('--production');
if (production) Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1' });
const issues = configurationIssues();
const pref = process.env.EASYAPPLY_PROVIDER || 'auto';
const hasKey = pref === 'openai' ? !!process.env.OPENAI_API_KEY
  : pref === 'api' ? !!process.env.ANTHROPIC_API_KEY
  : !!(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
if (production && !hasKey && pref !== 'demo') issues.push('ai_api_key');
if (production && pref === 'cli') issues.push('local_cli_cannot_deploy');
if (existsSync('.env.local') && (statSync('.env.local').mode & 0o077)) issues.push('local_env_permissions_use_chmod_600');
console.log(JSON.stringify({ mode: production ? 'vercel-production' : 'local', ready: issues.length === 0, api_key_present: hasKey, issues }, null, 2));
if (issues.length) process.exitCode = 1;
