/**
 * Parser Snapshot Test Script using REAL public Minecraft Bedrock / YSM model JSON fixtures.
 *
 * Fixtures are downloaded on demand into `.cache/ysm-fixtures/` (gitignored — NEVER committed
 * to the repository) and parsed with `BedrockModelParser` & `BedrockAnimationParser` to verify
 * structural compatibility against real-world community/official Bedrock & YSM models.
 *
 * Run via: npx tsx scripts/test-ysm-snapshots.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { BedrockModelParser } from '../src/lib/parser/BedrockModelParser';
import { BedrockAnimationParser } from '../src/lib/parser/BedrockAnimationParser';

interface FixtureSpec {
  id: string;
  kind: 'model' | 'animation';
  url: string;
  minBones?: number;
  minClips?: number;
}

const FIXTURES: FixtureSpec[] = [
  {
    id: 'bedrock-fox-geo',
    kind: 'model',
    url: 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/models/entity/fox.geo.json',
    minBones: 5,
  },
  {
    id: 'bedrock-fox-anim',
    kind: 'animation',
    url: 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/animations/fox.animation.json',
    minClips: 3,
  },
  {
    id: 'bedrock-allay-geo',
    kind: 'model',
    url: 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/models/entity/allay.geo.json',
    minBones: 5,
  },
  {
    id: 'bedrock-allay-anim',
    kind: 'animation',
    url: 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/animations/allay.animation.json',
    minClips: 2,
  },
  {
    id: 'bedrock-warden-geo',
    kind: 'model',
    url: 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/models/entity/warden.geo.json',
    minBones: 8,
  },
  {
    id: 'bedrock-warden-anim',
    kind: 'animation',
    url: 'https://raw.githubusercontent.com/Mojang/bedrock-samples/main/resource_pack/animations/warden.animation.json',
    minClips: 3,
  },
];

const CACHE_DIR = path.resolve(process.cwd(), '.cache/ysm-fixtures');

async function fetchFixture(spec: FixtureSpec): Promise<string | null> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${spec.id}.json`);

  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf-8');
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(spec.url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[skip] ${spec.id}: HTTP ${res.status} (${spec.url})`);
      return null;
    }
    const text = await res.text();
    fs.writeFileSync(cachePath, text, 'utf-8');
    return text;
  } catch (err) {
    console.warn(
      `[skip] ${spec.id}: network unavailable (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}

async function main() {
  const modelParser = new BedrockModelParser();
  const animParser = new BedrockAnimationParser();

  let verified = 0;

  for (const spec of FIXTURES) {
    const jsonText = await fetchFixture(spec);
    if (!jsonText) continue;

    if (spec.kind === 'model') {
      const parsed = modelParser.parse(jsonText);
      assert.ok(
        parsed.bones.length >= (spec.minBones ?? 1),
        `${spec.id}: expected >= ${spec.minBones} bones, got ${parsed.bones.length}`,
      );
      // Verify topological ordering: every parent appears before its children
      const seen = new Set<string>();
      for (const bone of parsed.bones) {
        if (bone.parent) {
          assert.ok(
            seen.has(bone.parent),
            `${spec.id}: bone "${bone.name}" appeared before parent "${bone.parent}"`,
          );
        }
        seen.add(bone.name);
      }
      console.log(
        `[PASS model] ${spec.id} -> ${parsed.description.identifier} (${parsed.bones.length} bones, ${parsed.cubeCount} cubes, ${parsed.description.textureWidth}x${parsed.description.textureHeight})`,
      );
      verified++;
    } else {
      const parsed = animParser.parse(jsonText);
      const clipNames = Object.keys(parsed.clips);
      assert.ok(
        clipNames.length >= (spec.minClips ?? 1),
        `${spec.id}: expected >= ${spec.minClips} clips, got ${clipNames.length}`,
      );
      console.log(
        `[PASS anim ] ${spec.id} -> ${clipNames.length} clips (${clipNames.slice(0, 4).join(', ')}...)`,
      );
      verified++;
    }
  }

  console.log(`\nSnapshot test complete: ${verified}/${FIXTURES.length} remote fixtures verified (cached in .cache/ysm-fixtures/).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
