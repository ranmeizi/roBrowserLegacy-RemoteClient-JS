#!/usr/bin/env node
/**
 * Find duplicate "유저인터페이스" folders under data/texture (CP949 vs UTF-8 Chinese).
 * Run on aidlux:
 *   node tools/diagnose-texture-folder.mjs
 */
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const textureDir = path.join(projectRoot, 'data', 'texture');
const kr = '유저인터페이스';

function hex(buf) {
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join(' ');
}

function joinBuf(...parts) {
  const chunks = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      chunks.push(Buffer.from([0x2f]));
    }
    chunks.push(Buffer.isBuffer(parts[i]) ? parts[i] : Buffer.from(parts[i]));
  }
  return Buffer.concat(chunks);
}

console.log('texture dir:', textureDir);
console.log('');

const cp949Folder = iconv.encode(kr, 'cp949');
const utf8ChineseFolder = Buffer.from('蜡历牢磐其捞胶', 'utf8');

const targets = [
  { label: 'CP949(유저인터페이스)', buf: cp949Folder },
  { label: 'UTF-8(蜡历牢磐其捞胶)', buf: utf8ChineseFolder }
];

for (const t of targets) {
  const dirBuf = joinBuf(textureDir, t.buf);
  const scBuf = joinBuf(dirBuf, Buffer.from('select_character'));
  const fileBuf = joinBuf(scBuf, Buffer.from('btn_add_out.bmp'));
  console.log(`=== ${t.label} ===`);
  console.log('hex:', hex(t.buf));
  console.log('dir exists:', fs.existsSync(dirBuf));
  console.log('select_character exists:', fs.existsSync(scBuf));
  console.log('btn_add_out.bmp exists:', fs.existsSync(fileBuf));
  if (fs.existsSync(scBuf)) {
    try {
      console.log('select_character file count:', fs.readdirSync(scBuf).length);
    } catch (e) {
      console.log('readdir err:', e.message);
    }
  }
  console.log('');
}

console.log('=== all texture subdirs that look like UI folder ===');
for (const entry of fs.readdirSync(textureDir, { encoding: 'buffer' })) {
  const gbk = iconv.decode(entry, 'gbk');
  const cp949 = iconv.decode(entry, 'cp949');
  if (gbk.includes('蜡') || cp949.includes('유저') || entry.toString('latin1').includes('À¯')) {
    const sc = joinBuf(textureDir, entry, Buffer.from('select_character'));
    console.log({
      hex: hex(entry),
      latin1: entry.toString('latin1'),
      cp949,
      gbk,
      select_character: fs.existsSync(sc) ? fs.readdirSync(sc).length + ' files' : 'MISSING'
    });
  }
}

// Simulate RemoteClient joinRootWithEncodedPath
const filePath = 'data/texture/유저인터페이스/select_character/btn_add_out.bmp';
const segments = filePath.split('/').filter(Boolean);
const chunks = [Buffer.from(projectRoot)];
for (const seg of segments) {
  chunks.push(Buffer.from([0x2f]));
  chunks.push(iconv.encode(seg, 'cp949'));
}
const nodePath = Buffer.concat(chunks);
console.log('');
console.log('=== Node HTTP resolver path ===');
console.log('exists:', fs.existsSync(nodePath));
console.log('latin1:', nodePath.toString('latin1'));
