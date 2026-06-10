const fs = require('fs');
const path = require('path');

function isDirectoryWithContent(dirPath) {
  if (!fs.existsSync(dirPath)) return false;
  try {
    return fs.readdirSync(dirPath).some((f) => !f.startsWith('add-'));
  } catch {
    return false;
  }
}

function hasLooseAssets(root = process.cwd()) {
  const dirs = ['data', 'BGM', 'System'];
  if (dirs.some((d) => isDirectoryWithContent(path.join(root, d)))) {
    return true;
  }

  const overridePath = process.env.DATA_OVERRIDE_PATH;
  if (overridePath) {
    const resolved = path.resolve(root, overridePath);
    if (isDirectoryWithContent(resolved)) return true;
  }

  const looseRoot = process.env.LOOSE_FILES_ROOT;
  if (looseRoot) {
    const resolved = path.resolve(root, looseRoot);
    if (isDirectoryWithContent(resolved)) return true;
  }

  return false;
}

function isLooseFilesMode(root = process.cwd()) {
  if (process.env.USE_LOOSE_FILES === 'true') return true;
  if (process.env.GRF_ENABLED === 'false') return true;
  if (process.env.GRF_ENABLED === 'true') return false;
  return hasLooseAssets(root);
}

module.exports = {
  isLooseFilesMode,
  hasLooseAssets,
  isDirectoryWithContent,
};
