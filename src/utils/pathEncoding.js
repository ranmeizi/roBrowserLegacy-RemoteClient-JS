const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

/**
 * Filename encoding on disk for unpacked Korean RO clients (Windows CP949).
 * Set LOOSE_FILENAME_ENCODING=utf-8 if files were converted to UTF-8 names.
 */
function getLooseFilenameEncoding() {
  const raw = process.env.LOOSE_FILENAME_ENCODING;
  if (raw) return raw;
  if (process.env.USE_LOOSE_FILES === 'true') return 'cp949';
  return 'cp949';
}

/**
 * Decode a raw directory entry name (Buffer) to Unicode for lookup keys.
 */
function decodeBufferFilename(nameBuf, encoding = 'cp949') {
  if (!nameBuf || nameBuf.length === 0) return '';
  if (Buffer.isBuffer(nameBuf)) {
    try {
      return iconv.decode(nameBuf, encoding);
    } catch {
      return nameBuf.toString('utf8');
    }
  }
  return decodeFilesystemName(String(nameBuf), encoding);
}

/**
 * Decode a filesystem string entry (readdir) to Unicode.
 */
function decodeFilesystemName(name, encoding = 'cp949') {
  if (!name) return name;
  if (/[가-힣]/.test(name)) return name;
  try {
    const fromLatin1 = iconv.decode(Buffer.from(name, 'latin1'), encoding);
    if (fromLatin1 && fromLatin1 !== name && /[가-힣]/.test(fromLatin1)) {
      return fromLatin1;
    }
    const fromUtf8Bytes = iconv.decode(Buffer.from(name, 'utf8'), encoding);
    if (fromUtf8Bytes && fromUtf8Bytes !== name && /[가-힣]/.test(fromUtf8Bytes)) {
      return fromUtf8Bytes;
    }
  } catch {
    // ignore
  }
  return name;
}

/**
 * Build a POSIX filesystem path as Buffer (CP949 bytes) for legacy Korean filenames.
 */
function joinRootWithEncodedPath(rootDir, relativePath, filenameEncoding, stripDataPrefix = false) {
  let rel = relativePath.replace(/\\/g, '/');
  if (stripDataPrefix) {
    rel = rel.replace(/^data[\/\\]/i, '');
  }

  if (!filenameEncoding || filenameEncoding === 'utf-8' || filenameEncoding === 'utf8') {
    return path.join(rootDir, rel);
  }

  const segments = rel.split('/').filter(Boolean);
  const chunks = [Buffer.from(rootDir)];
  for (const seg of segments) {
    chunks.push(Buffer.from([0x2f]));
    chunks.push(iconv.encode(seg, filenameEncoding));
  }
  return Buffer.concat(chunks);
}

/**
 * Build a filesystem path using Latin-1 bytes per segment (GRF mojibake on disk).
 * path.join() would UTF-8-encode U+00B3-style chars and break CP949 directory names.
 */
function joinRootWithLatin1Path(rootDir, relativePath, stripDataPrefix = false) {
  let rel = relativePath.replace(/\\/g, '/');
  if (stripDataPrefix) {
    rel = rel.replace(/^data[\/\\]/i, '');
  }

  const segments = rel.split('/').filter(Boolean);
  const chunks = [Buffer.from(rootDir)];
  for (const seg of segments) {
    chunks.push(Buffer.from([0x2f]));
    chunks.push(Buffer.from(seg, 'latin1'));
  }
  return Buffer.concat(chunks);
}

function normalizeSegmentKey(segment) {
  return segment.toLowerCase();
}

function getSegmentMatchKeys(segment) {
  const keys = new Set();
  const add = (value) => {
    if (value) {
      keys.add(normalizeSegmentKey(value));
    }
  };

  add(segment);

  if (/[\u0080-\u00ff]/.test(segment)) {
    const decoded = decodeMojibake(segment);
    if (decoded !== segment) {
      add(decoded);
    }
  }

  if (/[가-힣]/.test(segment)) {
    const mojibake = encodeMojibake(segment);
    if (mojibake !== segment) {
      add(mojibake);
    }

    // CP949 bytes shown as Chinese in GBK terminals (aidlux default): 내부소품 → 郴何家前
    try {
      const cp949Buf = iconv.encode(segment, 'cp949');
      add(iconv.decode(cp949Buf, 'gbk'));
      add(iconv.decode(cp949Buf, 'gb18030'));
    } catch {
      // ignore
    }
  }

  try {
    add(Buffer.from(segment, 'utf8').toString('latin1'));
  } catch {
    // ignore
  }

  return keys;
}

function getEntryMatchKeys(nameBuf, filenameEncoding) {
  const keys = new Set();
  const add = (value) => {
    if (value) {
      keys.add(normalizeSegmentKey(value));
    }
  };

  add(nameBuf.toString('latin1'));
  add(decodeBufferFilename(nameBuf, filenameEncoding));

  try {
    add(iconv.decode(nameBuf, 'gbk'));
    add(iconv.decode(nameBuf, 'gb18030'));
  } catch {
    // ignore
  }

  try {
    add(nameBuf.toString('utf8'));
  } catch {
    // ignore
  }

  return keys;
}

function segmentsShareKeys(targetKeys, entryKeys) {
  for (const key of targetKeys) {
    if (entryKeys.has(key)) {
      return true;
    }
  }
  return false;
}

function bytesMatchSegment(nameBuf, segment, filenameEncoding) {
  const variants = [segment];
  const decoded = decodeMojibake(segment);
  if (decoded !== segment) {
    variants.push(decoded);
  }

  for (const variant of variants) {
    try {
      if (nameBuf.equals(iconv.encode(variant, filenameEncoding))) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

function getBufferEntryType(parentBuf, nameBuf) {
  const fullPath = Buffer.concat([parentBuf, Buffer.from([0x2f]), nameBuf]);
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      return 'dir';
    }
    if (stat.isFile()) {
      return 'file';
    }
  } catch {
    // ignore
  }
  return null;
}

function describeBufferName(nameBuf, filenameEncoding) {
  return {
    latin1: nameBuf.toString('latin1'),
    utf8: nameBuf.toString('utf8'),
    decoded: decodeBufferFilename(nameBuf, filenameEncoding),
    hex: [...nameBuf].map(b => b.toString(16).padStart(2, '0')).join(' '),
  };
}

/**
 * Walk unpacked client directories and match each segment by Unicode / mojibake / CP949 bytes.
 * Returns { path: Buffer } or { failedAt, segment, entries } when diagnose=true.
 */
function resolveLooseFilePath(
  projectRoot,
  filePath,
  filenameEncoding = 'cp949',
  stripDataPrefix = false,
  diagnose = false
) {
  let rel = filePath.replace(/\\/g, '/');
  if (stripDataPrefix) {
    rel = rel.replace(/^data[\/\\]/i, '');
  }

  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) {
    return null;
  }

  let dirBuf = Buffer.from(projectRoot);

  for (let i = 0; i < parts.length; i++) {
    const targetSeg = parts[i];
    const isFile = i === parts.length - 1;
    const targetKeys = getSegmentMatchKeys(targetSeg);

    let entries;
    try {
      entries = fs.readdirSync(dirBuf, { encoding: 'buffer', withFileTypes: true });
    } catch {
      return null;
    }

    let matchedName = null;
    for (const entry of entries) {
      const nameBuf = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(String(entry.name));
      const rawLatin = nameBuf.toString('latin1');
      if (rawLatin.startsWith('add-')) {
        continue;
      }

      const entryType = getBufferEntryType(dirBuf, nameBuf);
      if (isFile && entryType !== 'file') {
        continue;
      }
      if (!isFile && entryType !== 'dir') {
        continue;
      }

      const entryKeys = getEntryMatchKeys(nameBuf, filenameEncoding);
      if (segmentsShareKeys(targetKeys, entryKeys) || bytesMatchSegment(nameBuf, targetSeg, filenameEncoding)) {
        matchedName = nameBuf;
        break;
      }
    }

    if (!matchedName) {
      if (!diagnose) {
        return null;
      }

      const sample = entries.slice(0, 40).map(entry => {
        const nameBuf = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(String(entry.name));
        return describeBufferName(nameBuf, filenameEncoding);
      });

      return {
        ok: false,
        failedAt: i,
        segment: targetSeg,
        segmentKeys: [...targetKeys],
        parent: dirBuf.toString('utf8'),
        entriesTotal: entries.length,
        entriesSample: sample,
      };
    }

    dirBuf = Buffer.concat([dirBuf, Buffer.from([0x2f]), matchedName]);
  }

  if (diagnose) {
    return { ok: true, path: dirBuf.toString('latin1'), exists: fs.existsSync(dirBuf) };
  }

  return dirBuf;
}

/**
 * Find a loose file by basename under a subtree (debug / path-mapping discovery).
 */
function findLooseFileByName(projectRoot, basename, under = 'data', maxResults = 10, maxDepth = 8) {
  const results = [];
  const target = basename.toLowerCase();
  const filenameEncoding = getLooseFilenameEncoding();
  const startPath = path.join(projectRoot, under);

  const walk = (dirBuf, relParts, depth) => {
    if (depth > maxDepth || results.length >= maxResults) {
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dirBuf, { encoding: 'buffer', withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const nameBuf = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(String(entry.name));
      const rawLatin = nameBuf.toString('latin1');
      if (rawLatin.startsWith('add-')) {
        continue;
      }

      const fullBuf = Buffer.concat([dirBuf, Buffer.from([0x2f]), nameBuf]);
      const entryType = getBufferEntryType(dirBuf, nameBuf);
      const relPath = [...relParts, rawLatin].join('/');

      if (entryType === 'file' && rawLatin.toLowerCase() === target) {
        results.push({
          relPath,
          ...describeBufferName(nameBuf, filenameEncoding),
        });
      }

      if (entryType === 'dir') {
        walk(fullBuf, [...relParts, rawLatin], depth + 1);
      }
    }
  };

  if (fs.existsSync(startPath)) {
    walk(Buffer.from(startPath), [under.replace(/\\/g, '/')], 0);
  }

  return results;
}

/**
 * Collect Unicode path variants to try when encoding to CP949 bytes.
 */
function getKoreanPathVariants(filePath, pathMapping) {
  const variants = getFilePathVariants(filePath, pathMapping);
  const korean = new Set();
  for (const v of variants) {
    korean.add(v);
    const decoded = decodeMojibake(v);
    if (decoded) korean.add(decoded);
    if (/[가-힣]/.test(v)) korean.add(v);
    if (/[가-힣]/.test(decoded)) korean.add(decoded);
  }
  return [...korean];
}

/**
 * Convert mojibake (CP949 bytes interpreted as Latin-1) back to proper Korean Unicode.
 */
function decodeMojibake(str) {
  try {
    const latin1Buf = iconv.encode(str, 'iso-8859-1');
    return iconv.decode(latin1Buf, 'cp949');
  } catch {
    return str;
  }
}

/**
 * Convert Unicode Korean path to mojibake (roBrowser request form).
 */
function encodeMojibake(str) {
  try {
    const cp949Buf = iconv.encode(str, 'cp949');
    return iconv.decode(cp949Buf, 'iso-8859-1');
  } catch {
    return str;
  }
}

/**
 * All path variants to try when resolving a client asset request.
 */
function getFilePathVariants(filePath, pathMapping) {
  const variants = [];
  const seen = new Set();

  const add = (p) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    variants.push(p);
  };

  add(filePath);
  add(filePath.replace(/\//g, '\\'));
  add(filePath.replace(/\\/g, '/'));

  const decoded = decodeMojibake(filePath);
  if (decoded !== filePath) {
    add(decoded);
    add(decoded.replace(/\//g, '\\'));
    add(decoded.replace(/\\/g, '/'));
  }

  const mojibake = encodeMojibake(filePath);
  if (mojibake !== filePath) {
    add(mojibake);
    add(mojibake.replace(/\//g, '\\'));
    add(mojibake.replace(/\\/g, '/'));
  }

  if (pathMapping?.paths) {
    const grfStyle = filePath.replace(/\//g, '\\');
    const mapped = pathMapping.paths[grfStyle] || pathMapping.paths[filePath];
    if (mapped) {
      add(mapped);
      add(mapped.replace(/\\/g, '/'));
      add(mapped.replace(/\//g, '\\'));
    }
    const decodedMapped = pathMapping.paths[decoded?.replace(/\//g, '\\')] || pathMapping.paths[decoded];
    if (decodedMapped) {
      add(decodedMapped);
      add(decodedMapped.replace(/\\/g, '/'));
    }
  }

  return variants;
}

module.exports = {
  LOOSE_PATH_RESOLVER_VERSION: 3,
  getLooseFilenameEncoding,
  decodeBufferFilename,
  decodeFilesystemName,
  joinRootWithEncodedPath,
  joinRootWithLatin1Path,
  resolveLooseFilePath,
  findLooseFileByName,
  getKoreanPathVariants,
  decodeMojibake,
  encodeMojibake,
  getFilePathVariants,
};
