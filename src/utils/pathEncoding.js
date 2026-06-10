const iconv = require('iconv-lite');

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
  decodeMojibake,
  encodeMojibake,
  getFilePathVariants,
};
