const fs = require('fs');
const path = require('path');
const {
  decodeBufferFilename,
  encodeMojibake,
  getLooseFilenameEncoding,
  readDirCached,
} = require('./pathEncoding');

const BATCH_ENTRIES = 400;

let building = false;
let indexComplete = false;
let filesIndexed = 0;
let dirsPending = 0;
let buildStartedAt = 0;

/**
 * GRF-style path segment for roBrowser (backslash, mojibake for Korean).
 */
function segmentToGrfName(nameBuf, filenameEncoding) {
  const decoded = decodeBufferFilename(nameBuf, filenameEncoding);
  if (/[가-힣]/.test(decoded)) {
    return encodeMojibake(decoded);
  }
  return nameBuf.toString('latin1');
}

function addIndexKeys(fileIndex, originalPath, diskPathBuf) {
  const entry = { loose: true, diskPath: diskPathBuf, originalPath };
  const normalizedForward = originalPath.toLowerCase().replace(/\\/g, '/');
  const normalizedBackslash = originalPath.toLowerCase().replace(/\//g, '\\');

  if (!fileIndex.has(normalizedForward)) {
    fileIndex.set(normalizedForward, entry);
  }
  if (!fileIndex.has(normalizedBackslash)) {
    fileIndex.set(normalizedBackslash, entry);
  }
}

function collectAssetRoots(projectRoot) {
  const roots = [];
  const assetDirs = ['data', 'BGM', 'System'];

  for (const dirName of assetDirs) {
    const full = path.join(projectRoot, dirName);
    if (fs.existsSync(full)) {
      roots.push({ dirBuf: Buffer.from(full), grfParts: [dirName] });
    }
  }

  if (process.env.LOOSE_FILES_ROOT) {
    const looseRoot = path.resolve(projectRoot, process.env.LOOSE_FILES_ROOT);
    for (const dirName of assetDirs) {
      const full = path.join(looseRoot, dirName);
      if (fs.existsSync(full)) {
        roots.push({ dirBuf: Buffer.from(full), grfParts: [dirName] });
      }
    }
  }

  if (process.env.DATA_OVERRIDE_PATH) {
    const overrideRoot = path.resolve(projectRoot, process.env.DATA_OVERRIDE_PATH);
    if (fs.existsSync(overrideRoot)) {
      roots.push({ dirBuf: Buffer.from(overrideRoot), grfParts: ['data'] });
    }
  }

  return roots;
}

/**
 * Non-blocking loose file index for search() / listFiles().
 * Phase 1: data/ root files (maps .rsw/.gat) — MapViewer ready quickly.
 * Phase 2: full tree under data/, BGM/, System/.
 */
function startLooseFileIndex(projectRoot, fileIndex, onComplete) {
  if (building || indexComplete) {
    return;
  }

  const filenameEncoding = getLooseFilenameEncoding();
  const queue = collectAssetRoots(projectRoot);

  if (!queue.length) {
    indexComplete = true;
    if (onComplete) {
      onComplete(0);
    }
    return;
  }

  building = true;
  buildStartedAt = Date.now();
  filesIndexed = 0;
  dirsPending = queue.length;

  const indexFile = (dirBuf, grfParts, nameBuf) => {
    const grfSeg = segmentToGrfName(nameBuf, filenameEncoding);
    const originalPath = [...grfParts, grfSeg].join('\\');
    const diskPathBuf = Buffer.concat([dirBuf, Buffer.from([0x2f]), nameBuf]);
    addIndexKeys(fileIndex, originalPath, diskPathBuf);
    filesIndexed += 1;
  };

  const enqueueDir = (dirBuf, grfParts) => {
    queue.push({ dirBuf, grfParts });
    dirsPending = queue.length;
  };

  // Phase 1: only top-level files in data/ (maps, tables, etc.)
  const dataRoot = path.join(projectRoot, 'data');
  if (fs.existsSync(dataRoot)) {
    const dataBuf = Buffer.from(dataRoot);
    const entries = readDirCached(dataBuf);
    if (entries) {
      for (const entry of entries) {
        const { nameBuf, entryType } = entry;
        const rawLatin = nameBuf.toString('latin1');
        if (rawLatin.startsWith('add-')) {
          continue;
        }
        if (entryType === 'file') {
          indexFile(dataBuf, ['data'], nameBuf);
        }
      }
    }
  }

  let processedThisTick = 0;

  const tick = () => {
    processedThisTick = 0;

    while (queue.length > 0 && processedThisTick < BATCH_ENTRIES) {
      const { dirBuf, grfParts } = queue.shift();
      dirsPending = queue.length;

      const entries = readDirCached(dirBuf);
      if (!entries) {
        continue;
      }

      for (const entry of entries) {
        processedThisTick += 1;
        const { nameBuf, entryType } = entry;
        const rawLatin = nameBuf.toString('latin1');
        if (rawLatin.startsWith('add-')) {
          continue;
        }

        if (entryType === 'file') {
          indexFile(dirBuf, grfParts, nameBuf);
        } else if (entryType === 'dir') {
          const grfSeg = segmentToGrfName(nameBuf, filenameEncoding);
          const childBuf = Buffer.concat([dirBuf, Buffer.from([0x2f]), nameBuf]);
          enqueueDir(childBuf, [...grfParts, grfSeg]);
        } else {
          const childBuf = Buffer.concat([dirBuf, Buffer.from([0x2f]), nameBuf]);
          try {
            const stat = fs.statSync(childBuf);
            if (stat.isFile()) {
              indexFile(dirBuf, grfParts, nameBuf);
            } else if (stat.isDirectory()) {
              const grfSeg = segmentToGrfName(nameBuf, filenameEncoding);
              enqueueDir(childBuf, [...grfParts, grfSeg]);
            }
          } catch {
            // ignore
          }
        }

        if (processedThisTick >= BATCH_ENTRIES) {
          break;
        }
      }
    }

    if (queue.length > 0) {
      setImmediate(tick);
      return;
    }

    building = false;
    indexComplete = true;
    dirsPending = 0;
    const elapsed = Date.now() - buildStartedAt;
    if (onComplete) {
      onComplete(elapsed);
    }
  };

  setImmediate(tick);
}

function getLooseIndexStats() {
  return {
    building,
    complete: indexComplete,
    filesIndexed,
    dirsPending,
    buildStartedAt,
  };
}

function isLooseIndexComplete() {
  return indexComplete;
}

function isLooseIndexBuilding() {
  return building;
}

module.exports = {
  startLooseFileIndex,
  getLooseIndexStats,
  isLooseIndexComplete,
  isLooseIndexBuilding,
};
