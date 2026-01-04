/**
 * Telegram HTTPS Setup Command
 *
 * Sets up nginx reverse proxy with Let's Encrypt SSL for the Mini App.
 */

import { confirm, input } from '@inquirer/prompts';
import { spawnSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { getGlobalStore } from '../../core/global-store.js';

const NGINX_CONF_PATH = '/etc/nginx/sites-available/orchestrator-webapp';
const NGINX_ENABLED_PATH = '/etc/nginx/sites-enabled/orchestrator-webapp';

function runCommand(cmd: string, args: string[], silent = false): { success: boolean; output: string } {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    stdio: silent ? 'pipe' : 'inherit',
  });
  return {
    success: result.status === 0,
    output: result.stdout || result.stderr || '',
  };
}

function checkCommand(cmd: string): boolean {
  const result = spawnSync('which', [cmd], { encoding: 'utf-8' });
  return result.status === 0;
}

export async function setupHttps(): Promise<void> {
  console.log('\n🔒 HTTPS Setup for Telegram Mini App\n');

  // Check if running as root or with sudo
  if (process.getuid?.() !== 0) {
    console.log('⚠️  This command requires root privileges.');
    console.log('   Run with: sudo orchestrate telegram setup-https\n');
    return;
  }

  const store = getGlobalStore();
  const webappConfig = store.getWebAppConfig();

  // Get domain from user
  const domain = await input({
    message: 'Enter your domain (e.g., orchestrator.example.com):',
    validate: (value) => {
      if (!value.trim()) return 'Domain is required';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+[a-zA-Z0-9]$/.test(value)) {
        return 'Invalid domain format';
      }
      return true;
    },
  });

  const port = webappConfig.port || 3847;

  console.log(`\n📋 Setup Summary:`);
  console.log(`   Domain: ${domain}`);
  console.log(`   WebApp Port: ${port}`);
  console.log(`   Will install: nginx, certbot\n`);

  const proceed = await confirm({
    message: 'Proceed with setup?',
    default: true,
  });

  if (!proceed) {
    console.log('Setup cancelled.');
    return;
  }

  // Step 1: Install dependencies
  console.log('\n📦 Installing dependencies...');

  if (!checkCommand('nginx')) {
    console.log('   Installing nginx...');
    runCommand('apt-get', ['update']);
    runCommand('apt-get', ['install', '-y', 'nginx']);
  } else {
    console.log('   ✓ nginx already installed');
  }

  if (!checkCommand('certbot')) {
    console.log('   Installing certbot...');
    runCommand('apt-get', ['install', '-y', 'certbot', 'python3-certbot-nginx']);
  } else {
    console.log('   ✓ certbot already installed');
  }

  // Step 2: Create nginx config
  console.log('\n⚙️  Configuring nginx...');

  const nginxConfig = `
server {
    listen 80;
    server_name ${domain};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;

  // Ensure directory exists
  const sitesAvailable = '/etc/nginx/sites-available';
  const sitesEnabled = '/etc/nginx/sites-enabled';
  if (!existsSync(sitesAvailable)) {
    mkdirSync(sitesAvailable, { recursive: true });
  }
  if (!existsSync(sitesEnabled)) {
    mkdirSync(sitesEnabled, { recursive: true });
  }

  writeFileSync(NGINX_CONF_PATH, nginxConfig);
  console.log(`   ✓ Created ${NGINX_CONF_PATH}`);

  // Enable site
  if (!existsSync(NGINX_ENABLED_PATH)) {
    runCommand('ln', ['-s', NGINX_CONF_PATH, NGINX_ENABLED_PATH], true);
  }
  console.log('   ✓ Site enabled');

  // Test and reload nginx
  const testResult = runCommand('nginx', ['-t'], true);
  if (!testResult.success) {
    console.log('   ❌ nginx config test failed:', testResult.output);
    return;
  }

  runCommand('systemctl', ['reload', 'nginx'], true);
  console.log('   ✓ nginx reloaded');

  // Step 3: Get SSL certificate
  console.log('\n🔐 Obtaining SSL certificate...');

  const email = await input({
    message: 'Enter email for Let\'s Encrypt notifications:',
    validate: (value) => {
      if (!value.includes('@')) return 'Valid email required';
      return true;
    },
  });

  const certResult = runCommand('certbot', [
    '--nginx',
    '-d', domain,
    '--non-interactive',
    '--agree-tos',
    '-m', email,
  ]);

  if (!certResult.success) {
    console.log('\n❌ Failed to obtain certificate.');
    console.log('   Make sure:');
    console.log(`   1. DNS for ${domain} points to this server`);
    console.log('   2. Port 80 is open in firewall');
    console.log('   3. No other service is using port 80');
    return;
  }

  console.log('   ✓ SSL certificate obtained');

  // Step 4: Update orchestrator config
  console.log('\n💾 Updating orchestrator config...');

  const baseUrl = `https://${domain}`;
  store.setWebAppBaseUrl(baseUrl);
  console.log(`   ✓ webapp_base_url set to ${baseUrl}`);

  // Step 5: Setup auto-renewal cron
  console.log('\n⏰ Setting up certificate auto-renewal...');
  runCommand('systemctl', ['enable', 'certbot.timer'], true);
  runCommand('systemctl', ['start', 'certbot.timer'], true);
  console.log('   ✓ Auto-renewal enabled');

  // Done
  console.log('\n✅ HTTPS setup complete!\n');
  console.log('Next steps:');
  console.log('  1. Restart the daemon: orchestrate telegram daemon');
  console.log(`  2. The Mini App will be available at: ${baseUrl}`);
  console.log('  3. Menu button will appear in Telegram after restart\n');
}
