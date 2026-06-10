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
  getLooseFilenameEncoding,
  decodeBufferFilename,
  decodeFilesystemName,
  joinRootWithEncodedPath,
  getKoreanPathVariants,
  decodeMojibake,
  encodeMojibake,
  getFilePathVariants,
};
