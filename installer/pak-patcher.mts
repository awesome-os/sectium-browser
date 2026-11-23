#!/usr/bin/env node
/**
 * @file intersections/sectium-browser/installer/pak-patcher.mts
 * @description Zero-GN, Zero-Ninja Chromium GRIT DataPack v5 (`resources.pak`) binary patcher.
 *
 * Parses Chromium's documented DataPack v5 format (12-byte header + N*(u16 id, u32 offset)
 * + sentinel + alias table + payload blobs) and replaces the built-in `chrome://newtab`
 * (`<ntp-app>`) resource directly inside `resources.pak` with our pure-art `Sectium Canvas`
 * HTML in < 100 ms — ZERO `--load-extension`, ZERO "Wieder zu Google wechseln?" popup!
 *
 * Strictly `erasableSyntaxOnly: true` & zero external dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export interface DataPackV5Entry {
  readonly id: number;
  readonly data: Buffer;
}

export interface DataPackV5Alias {
  readonly resourceId: number;
  readonly entryIndex: number;
}

export interface DataPackV5 {
  readonly version: number;
  readonly encoding: number;
  readonly entries: DataPackV5Entry[];
  readonly aliases: DataPackV5Alias[];
}

export function parseDataPackV5(buf: Buffer): DataPackV5 {
  if (buf.length < 12) {
    throw new Error(`Invalid DataPack: too short (${buf.length} B)`);
  }
  const version = buf.readUInt32LE(0);
  if (version !== 5) {
    throw new Error(`Unsupported DataPack version: ${version} (expected 5)`);
  }
  const encoding = buf.readUInt8(4);
  const resourceCount = buf.readUInt16LE(8);
  const aliasCount = buf.readUInt16LE(10);

  const tableStart = 12;
  const sentinelOffset = tableStart + resourceCount * 6;
  const aliasStart = sentinelOffset + 6;
  if (aliasStart + aliasCount * 4 > buf.length) {
    throw new Error('Truncated DataPack v5 table');
  }

  const entries: DataPackV5Entry[] = [];
  for (let i = 0; i < resourceCount; i++) {
    const id = buf.readUInt16LE(tableStart + i * 6);
    const off = buf.readUInt32LE(tableStart + i * 6 + 2);
    const nextOff = buf.readUInt32LE(tableStart + (i + 1) * 6 + 2);
    entries.push({ id, data: Buffer.from(buf.subarray(off, nextOff)) });
  }

  const aliases: DataPackV5Alias[] = [];
  for (let i = 0; i < aliasCount; i++) {
    const resourceId = buf.readUInt16LE(aliasStart + i * 4);
    const entryIndex = buf.readUInt16LE(aliasStart + i * 4 + 2);
    aliases.push({ resourceId, entryIndex });
  }

  return { version, encoding, entries, aliases };
}

export function serializeDataPackV5(pack: DataPackV5): Buffer {
  const resourceCount = pack.entries.length;
  const aliasCount = pack.aliases.length;
  const headerAndTablesSize = 12 + (resourceCount + 1) * 6 + aliasCount * 4;

  let payloadSize = 0;
  for (const e of pack.entries) {
    payloadSize += e.data.length;
  }

  const out = Buffer.alloc(headerAndTablesSize + payloadSize);
  out.writeUInt32LE(5, 0);
  out.writeUInt8(pack.encoding, 4);
  out.writeUInt8(0, 5);
  out.writeUInt16LE(0, 6);
  out.writeUInt16LE(resourceCount, 8);
  out.writeUInt16LE(aliasCount, 10);

  let dataCursor = headerAndTablesSize;
  for (let i = 0; i < resourceCount; i++) {
    const e = pack.entries[i];
    out.writeUInt16LE(e.id, 12 + i * 6);
    out.writeUInt32LE(dataCursor, 12 + i * 6 + 2);
    e.data.copy(out, dataCursor);
    dataCursor += e.data.length;
  }

  // Sentinel entry (id = 0, offset = end of payload)
  const sentinelPos = 12 + resourceCount * 6;
  out.writeUInt16LE(0, sentinelPos);
  out.writeUInt32LE(dataCursor, sentinelPos + 2);

  const aliasPos = sentinelPos + 6;
  for (let i = 0; i < aliasCount; i++) {
    out.writeUInt16LE(pack.aliases[i].resourceId, aliasPos + i * 4);
    out.writeUInt16LE(pack.aliases[i].entryIndex, aliasPos + i * 4 + 2);
  }

  return out;
}

export function patchResourceByIdInPak(
  pakPath: string,
  resourceId: number,
  replacementContent: Buffer | string,
): { resourceId: number; oldBytes: number; newBytes: number; compression: 'gzip' | 'brotli' | 'raw'; totalResources: number } {
  const raw = fs.readFileSync(pakPath);
  const pack = parseDataPackV5(raw);
  const replacementBuf = typeof replacementContent === 'string' ? Buffer.from(replacementContent, 'utf8') : replacementContent;

  const idx = pack.entries.findIndex((e) => e.id === resourceId);
  if (idx < 0) {
    throw new Error(`Resource ID ${resourceId} not found in ${pakPath}`);
  }

  const old = pack.entries[idx].data;
  const isGzip = old.length >= 2 && old[0] === 0x1f && old[1] === 0x8b;
  const isChromiumBrotli = old.length >= 8 && old[0] === 0x1e && old[1] === 0x9b;

  let nextPayload: Buffer;
  let compression: 'gzip' | 'brotli' | 'raw' = 'raw';
  if (isGzip) {
    compression = 'gzip';
    nextPayload = zlib.gzipSync(replacementBuf, { level: 9 });
  } else if (isChromiumBrotli) {
    compression = 'brotli';
    const compressed = zlib.brotliCompressSync(replacementBuf);
    const header = Buffer.alloc(8);
    header[0] = 0x1e;
    header[1] = 0x9b;
    header.writeUIntLE(replacementBuf.length, 2, 6);
    nextPayload = Buffer.concat([header, compressed]);
  } else {
    nextPayload = replacementBuf;
  }

  pack.entries[idx] = { id: resourceId, data: nextPayload };
  const outBuf = serializeDataPackV5(pack);
  fs.writeFileSync(pakPath, outBuf);
  return {
    resourceId,
    oldBytes: old.length,
    newBytes: nextPayload.length,
    compression,
    totalResources: pack.entries.length,
  };
}

export function patchNewTabInResourcesPak(
  pakPath: string,
  replacementHtml: string,
): { patchedIds: number[]; totalResources: number; outputBytes: number } {
  const raw = fs.readFileSync(pakPath);
  const pack = parseDataPackV5(raw);
  const replacementBuf = Buffer.from(replacementHtml, 'utf8');
  const patchedIds: number[] = [];

  for (let i = 0; i < pack.entries.length; i++) {
    const e = pack.entries[i];
    if (e.data.length < 24 || e.data.length > 65_536) continue;
    const isGzip = e.data[0] === 0x1f && e.data[1] === 0x8b;
    // Chromium GRIT Brotli prefix: 0x1e 0x9b + 6-byte little-endian uncompressed size
    const isChromiumBrotli = e.data[0] === 0x1e && e.data[1] === 0x9b;
    let text = '';
    try {
      if (isGzip) {
        text = zlib.gunzipSync(e.data).toString('utf8');
      } else if (isChromiumBrotli) {
        text = zlib.brotliDecompressSync(e.data.subarray(8)).toString('utf8');
      } else {
        text = e.data.toString('utf8');
      }
    } catch {
      continue;
    }
    if (
      (text.includes('<ntp-app>') || text.includes('new_tab_page.js') || text.includes('SECTIUM_NATIVE_CANVAS')) &&
      (text.includes('<!doctype html>') || text.includes('<!DOCTYPE html>'))
    ) {
      let nextPayload: Buffer;
      if (isGzip) {
        nextPayload = zlib.gzipSync(replacementBuf, { level: 9 });
      } else if (isChromiumBrotli) {
        const compressed = zlib.brotliCompressSync(replacementBuf);
        const header = Buffer.alloc(8);
        header[0] = 0x1e;
        header[1] = 0x9b;
        header.writeUIntLE(replacementBuf.length, 2, 6);
        nextPayload = Buffer.concat([header, compressed]);
      } else {
        nextPayload = replacementBuf;
      }
      pack.entries[i] = { id: e.id, data: nextPayload };
      patchedIds.push(e.id);
    }
  }

  if (patchedIds.length === 0) {
    throw new Error(`No native chrome://newtab HTML resource found inside ${pakPath}`);
  }

  const outBuf = serializeDataPackV5(pack);
  fs.writeFileSync(pakPath, outBuf);
  return {
    patchedIds,
    totalResources: pack.entries.length,
    outputBytes: outBuf.length,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv[2] === '--find') {
    const needle = process.argv[3] ?? 'new_tab_page.js';
    const pakPath = process.argv[4] ?? 'D:\\Sectium\\resources.pak';
    const pack = parseDataPackV5(fs.readFileSync(pakPath));
    for (const e of pack.entries) {
      let s = '';
      try {
        if (e.data[0] === 0x1f && e.data[1] === 0x8b) s = zlib.gunzipSync(e.data).toString('utf8');
        else if (e.data[0] === 0x1e && e.data[1] === 0x9b) s = zlib.brotliDecompressSync(e.data.subarray(8)).toString('utf8');
        else s = e.data.toString('utf8');
      } catch {
        continue;
      }
      if (s.includes(needle)) {
        console.log(`MATCH id=${e.id} raw=${e.data.length} txt=${s.length} head=${JSON.stringify(s.slice(0, 120))}`);
      }
    }
    process.exit(0);
  }
  if (process.argv[2] === '--id') {
    const id = Number.parseInt(process.argv[3] ?? '693', 10);
    const pakPath = process.argv[4] ?? 'D:\\Sectium\\resources.pak';
    const htmlPath =
      process.argv[5] ?? 'E:\\b8g-chromium-real\\src\\chrome\\browser\\resources\\new_tab_page\\new_tab_page.html';
    const html = fs.readFileSync(htmlPath, 'utf8');
    const res = patchResourceByIdInPak(pakPath, id, html);
    console.log(
      `[pak-patcher] Patched resource ID ${res.resourceId} (${res.compression}, ${res.oldBytes} B -> ${res.newBytes} B) in ${pakPath} (${res.totalResources} total resources)`,
    );
    process.exit(0);
  }
  const pakPath = process.argv[2] ?? 'D:\\Sectium\\resources.pak';
  const htmlPath =
    process.argv[3] ?? 'E:\\b8g-chromium-real\\src\\chrome\\browser\\resources\\new_tab_page\\new_tab_page.html';
  const html = fs.readFileSync(htmlPath, 'utf8');
  const res = patchNewTabInResourcesPak(pakPath, html);
  console.log(
    `[pak-patcher] Patched native chrome://newtab in ${pakPath}: resource IDs [${res.patchedIds.join(', ')}] (${res.totalResources} total resources, ${res.outputBytes} B)`,
  );
}
