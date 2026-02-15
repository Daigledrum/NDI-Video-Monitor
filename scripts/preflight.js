const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

const rootDir = path.resolve(__dirname, '..');

function logResult(ok, label, details = '') {
  const status = ok ? 'OK' : 'FAIL';
  const detailText = details ? ` - ${details}` : '';
  console.log(`[${status}] ${label}${detailText}`);
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: isWindows });
  return result.status === 0;
}

function findNDISdkCandidates() {
  if (isWindows) {
    return [
      {
        label: 'NDI 6 SDK',
        sdk: 'C:\\Program Files\\NDI\\NDI 6 SDK',
        include: 'C:\\Program Files\\NDI\\NDI 6 SDK\\include',
        lib: 'C:\\Program Files\\NDI\\NDI 6 SDK\\lib\\x64'
      },
      {
        label: 'NDI 5 SDK',
        sdk: 'C:\\Program Files\\NDI\\NDI 5 SDK',
        include: 'C:\\Program Files\\NDI\\NDI 5 SDK\\include',
        lib: 'C:\\Program Files\\NDI\\NDI 5 SDK\\lib\\x64'
      }
    ];
  }

  if (isMac) {
    return [
      {
        label: 'NDI SDK for Apple',
        sdk: '/Library/NDI SDK for Apple',
        include: '/Library/NDI SDK for Apple/include',
        lib: '/Library/NDI SDK for Apple/lib/macOS'
      }
    ];
  }

  if (isLinux) {
    return [
      {
        label: 'NDI SDK for Linux',
        sdk: '/opt/ndi',
        include: '/opt/ndi/include',
        lib: '/opt/ndi/lib/x86_64-linux-gnu'
      }
    ];
  }

  return [];
}

function resolveInstalledNdiSdk() {
  const candidates = findNDISdkCandidates();
  return candidates.find((candidate) => fs.existsSync(candidate.include) && fs.existsSync(candidate.lib)) || null;
}

function checkCompilers() {
  if (isWindows) {
    const hasCl = commandExists('where', ['cl']);
    logResult(hasCl, 'MSVC compiler', hasCl ? 'cl.exe found' : 'Install Visual C++ Build Tools');
    return hasCl;
  }

  const hasGcc = commandExists('gcc');
  logResult(hasGcc, 'GCC compiler', hasGcc ? 'gcc found' : 'Install gcc/build-essential');
  return hasGcc;
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  const ok = Number.isInteger(major) && major >= 18;
  logResult(ok, 'Node.js version', `detected v${process.versions.node}, recommended >=18`);
  return ok;
}

function checkNativeSources() {
  const recvPath = path.join(rootDir, 'ndi_recv.c');
  const listPath = path.join(rootDir, 'ndi_list.c');
  const ok = fs.existsSync(recvPath) && fs.existsSync(listPath);
  logResult(ok, 'Native source files', ok ? 'ndi_recv.c and ndi_list.c found' : 'Missing native source files');
  return ok;
}

function checkNdiSdk() {
  const sdk = resolveInstalledNdiSdk();
  const ok = !!sdk;
  logResult(ok, 'NDI SDK paths', ok ? `${sdk.label} at ${sdk.sdk}` : 'Install NDI SDK (NDI 6 preferred)');

  if (ok) {
    const versionPath = path.join(sdk.sdk, 'Version.txt');
    if (fs.existsSync(versionPath)) {
      const version = fs.readFileSync(versionPath, 'utf8').trim();
      logResult(true, 'NDI SDK version', version);
    }
  }

  return ok;
}

function checkGitignore() {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    logResult(false, '.gitignore', 'Missing .gitignore');
    return false;
  }

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const hasNodeModules = content.includes('node_modules/');
  const hasEnv = content.includes('.env');
  const ok = hasNodeModules && hasEnv;
  logResult(ok, '.gitignore coverage', ok ? 'node_modules and .env ignored' : 'Add node_modules/ and .env entries');
  return ok;
}

function main() {
  console.log('NDI Video Monitor preflight checks');
  console.log(`Platform: ${process.platform}`);

  const checks = [
    checkNodeVersion(),
    checkNdiSdk(),
    checkCompilers(),
    checkNativeSources(),
    checkGitignore()
  ];

  const allPassed = checks.every(Boolean);
  console.log(allPassed ? '\nPreflight passed.' : '\nPreflight found issues.');
  process.exit(allPassed ? 0 : 1);
}

main();
