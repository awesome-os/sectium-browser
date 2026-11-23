/**
 * @file upstream/semantic-diff.mts
 * @description Live Dual-Layer Semantic AST Diff Gate comparing released header trees
 * (from v0.6.0-v8-cloud / v0.6.0-chromium-shards) against fresh upstream HEAD.
 * Classifies every changed header as:
 *   - SKIP_NOISE         (blob_sha256 changed, abi_hash + impl_hash identical)
 *   - SAFE_GHOST_HOTSWAP (abi_hash identical, impl_hash changed)
 *   - ABI_BREAK_REBUILD  (abi_hash changed)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { computeSemanticModuleEntry } from './semantic-registry.mts';

function collectHeaders(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && (ent.name.endsWith('.h') || ent.name.endsWith('.hpp'))) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

export function diffHeaderTrees(name: string, oldDir: string, newDir: string) {
  const oldFiles = collectHeaders(oldDir);
  const newFiles = collectHeaders(newDir);
  const oldMap = new Map(oldFiles.map((f) => [relative(oldDir, f).replace(/\\/g, '/'), f]));
  const newMap = new Map(newFiles.map((f) => [relative(newDir, f).replace(/\\/g, '/'), f]));

  let totalFiles = 0;
  let blobChanged = 0;
  let abiChanged = 0;
  let implChanged = 0;
  let noiseEliminated = 0;
  const abiBreaks: string[] = [];

  for (const [rel, newPath] of newMap) {
    totalFiles++;
    const oldPath = oldMap.get(rel);
    if (!oldPath) {
      blobChanged++;
      abiChanged++;
      implChanged++;
      abiBreaks.push(`+ ${rel}`);
      continue;
    }
    const oldText = readFileSync(oldPath, 'utf8');
    const newText = readFileSync(newPath, 'utf8');
    if (oldText === newText) continue;

    const a = computeSemanticModuleEntry(rel, oldText);
    const b = computeSemanticModuleEntry(rel, newText);
    if (a.blob_sha256 !== b.blob_sha256) blobChanged++;
    if (a.abi_hash !== b.abi_hash) {
      abiChanged++;
      abiBreaks.push(`~ ${rel}`);
    }
    if (a.impl_hash !== b.impl_hash) implChanged++;
    if (a.blob_sha256 !== b.blob_sha256 && a.abi_hash === b.abi_hash && a.impl_hash === b.impl_hash) {
      noiseEliminated++;
    }
  }

  const decision =
    abiChanged > 0
      ? 'ABI_BREAK_REBUILD'
      : implChanged > 0
        ? 'SAFE_GHOST_HOTSWAP'
        : blobChanged > 0
          ? 'SKIP_NOISE'
          : 'IDENTICAL';

  return {
    shard: name,
    totalHeaders: totalFiles,
    blobChanged,
    abiChanged,
    implChanged,
    noiseEliminated,
    decision,
    abiBreaks: abiBreaks.slice(0, 10),
  };
}

if (process.argv[1]?.endsWith('semantic-diff.mts')) {
  const [, , name, oldDir, newDir, outJson] = process.argv;
  if (!name || !oldDir || !newDir) {
    console.error('Usage: node upstream/semantic-diff.mts <shardName> <oldHeaderDir> <newHeaderDir> [out.json]');
    process.exit(1);
  }
  const report = diffHeaderTrees(name, oldDir, newDir);
  console.log(
    `[semantic-diff] shard=${report.shard} headers=${report.totalHeaders} blobChanged=${report.blobChanged} abiChanged=${report.abiChanged} implChanged=${report.implChanged} noiseEliminated=${report.noiseEliminated} -> ${report.decision}`
  );
  if (outJson) writeFileSync(outJson, JSON.stringify(report, null, 2) + '\n');
}
