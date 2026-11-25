/** Modern YSM binary layout, adapted from OpenYSM (MIT); see THIRD_PARTY_NOTICES.md. */
import type { Vec3, YsmBakedFace } from '../../parser/types';
import type { VirtualFileSystem } from '../types';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ANIMATION_TYPES = ['unknown', 'main', 'arm', 'extra', 'tac', 'arrow', 'carryon', 'parcool', 'swem', 'slashblade', 'tlm', 'fp_arm', 'immersive_melodies', 'irons_spell_books'];
type JsonObject = Record<string, any>;

class Reader {
  offset = 0;
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  take(length: number): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`YSM: Truncated binary data at offset ${this.offset}.`);
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  byte(): number { return this.take(1)[0]; }
  uint32(): number { const start = this.offset; this.take(4); return this.view.getUint32(start, true); }
  float(allowInfinity = false): number {
    const start = this.offset;
    this.take(4);
    const value = this.view.getFloat32(start, true);
    if (!Number.isFinite(value) && !(allowInfinity && value === Infinity)) throw new Error(`YSM: Invalid float at offset ${start}.`);
    return value;
  }
  vector(): Vec3 { return [this.float(), this.float(), this.float()]; }
  varint(): number {
    let result = 0;
    for (let i = 0; i < 5; i++) {
      const value = this.byte();
      result += (value & 127) * 2 ** (7 * i);
      if (result > 0xffffffff) break;
      if (!(value & 128)) return result;
    }
    throw new Error(`YSM: Invalid VarInt at offset ${this.offset}.`);
  }
  count(): number {
    const count = this.varint();
    if (count > 1_000_000 || count > this.bytes.length - this.offset) throw new Error('YSM: Invalid collection size.');
    return count;
  }
  blob(): Uint8Array { return this.take(this.varint()); }
  string(): string { return decoder.decode(this.blob()); }
  scalar(): number | string {
    const type = this.byte();
    if (type === 1) return this.float();
    if (type === 2) return this.string();
    throw new Error(`YSM: Unknown MoLang value type ${type}.`);
  }
  skipInts(count: number): void { for (let i = 0; i < count; i++) this.varint(); }
  strings(): string[] { return Array.from({ length: this.count() }, () => this.string()); }
}

export interface YsmBinaryPack {
  files: VirtualFileSystem;
  /** Encoded image data or raw RGBA, converted to browser images by the archive adapter. */
  textures: { path: string; data: Uint8Array; width: number; height: number; format: number }[];
}

export function readYsmBinary(bytes: Uint8Array): YsmBinaryPack {
  const reader = new Reader(bytes);
  const format = reader.uint32();
  if (format < 16 || format > 32) throw new Error(`YSM: Unsupported binary format ${format}; supported formats are 16–32.`);
  const files: VirtualFileSystem = new Map();
  const textures: YsmBinaryPack['textures'] = [];
  const textureDescriptors: { id: string; path: string }[] = [];
  const animationPaths: string[] = [];
  const autoAnimations: string[] = [];
  const writeJson = (path: string, value: unknown): void => { files.set(path, encoder.encode(JSON.stringify(value))); };

  // Sounds and functions are preserved as data. Playback uses the engine's explicit clip API.
  for (const folder of ['sounds', 'functions']) {
    const count = reader.count();
    for (let i = 0; i < count; i++) {
      const name = reader.string();
      reader.string(); // Source hash.
      files.set(`${folder}/${name}${folder === 'functions' ? '.molang' : '.ogg'}`, reader.blob());
    }
  }
  for (let i = 0, count = reader.count(); i < count; i++) {
    const name = reader.string();
    reader.string();
    const translations = Object.create(null);
    for (let j = 0, nodes = reader.count(); j < nodes; j++) translations[reader.string()] = reader.string();
    writeJson(`lang/${name}.json`, translations);
  }

  function channel(): JsonObject | undefined {
    const count = reader.count();
    if (count === 0) return undefined;
    const result = Object.create(null);
    for (let i = 0; i < count; i++) {
      const time = reader.float() / 20;
      const interpolation = reader.varint();
      const pre = [reader.scalar(), reader.scalar(), reader.scalar()];
      const hasPost = reader.varint() !== 0;
      const post = hasPost ? [reader.scalar(), reader.scalar(), reader.scalar()] : pre;
      result[String(time)] = { pre, post, lerp_mode: interpolation === 2 ? 'catmullrom' : 'linear' };
    }
    return result;
  }

  function animations(): JsonObject {
    const result = Object.create(null);
    for (let i = 0, count = reader.count(); i < count; i++) {
      const name = reader.string();
      const rawLength = reader.float(true) / 20;
      const length = rawLength === Infinity ? 0 : rawLength;
      const loop = reader.varint();
      reader.skipInts(2);
      let weight: number | string = 1;
      for (let j = 0, weights = reader.count(); j < weights; j++) weight = reader.scalar();
      reader.varint();
      const bones = Object.create(null);
      for (let j = 0, boneCount = reader.count(); j < boneCount; j++) {
        const boneName = reader.string();
        bones[boneName] = { rotation: channel(), position: channel(), scale: channel() };
      }
      const timeline = Object.create(null);
      for (let j = 0, events = reader.count(); j < events; j++) {
        const expressions = reader.strings();
        timeline[String(reader.float() / 20)] = expressions;
      }
      const soundEffects = Object.create(null);
      for (let j = 0, effects = reader.count(); j < effects; j++) {
        const effect = reader.string();
        soundEffects[String(reader.float() / 20)] = { effect };
      }
      result[name] = { animation_length: length, loop: loop === 1 ? true : loop === 3 ? 'hold_on_last_frame' : false, blend_weight: weight, bones, timeline, sound_effects: soundEffects };
    }
    return { format_version: '1.8.0', animations: result };
  }

  function controllers(prefix: string, readName: boolean): void {
    for (let i = 0, count = reader.count(); i < count; i++) {
      const name = readName ? reader.string() : String(i);
      reader.string();
      const result = Object.create(null);
      for (let j = 0, total = reader.count(); j < total; j++) {
        const controllerName = reader.string();
        const initialState = reader.string();
        const states = Object.create(null);
        for (let k = 0, stateCount = reader.count(); k < stateCount; k++) {
          const stateName = reader.string();
          const pairs = (): JsonObject[] => Array.from({ length: reader.count() }, () => ({ [reader.string()]: reader.string() }));
          const state: JsonObject = { animations: pairs(), transitions: pairs(), on_entry: reader.strings(), on_exit: reader.strings() };
          if (reader.varint() !== 0) state.blend_transition = reader.float();
          else {
            state.blend_transition = Object.create(null);
            for (let l = 0, blends = reader.count(); l < blends; l++) state.blend_transition[String(reader.float())] = reader.float();
          }
          state.blend_via_shortest_path = reader.varint() !== 0;
          if (format > 26) state.sound_effects = reader.strings();
          states[stateName] = state;
        }
        result[controllerName] = { initial_state: initialState, states };
      }
      writeJson(`${prefix}/${name}.json`, { format_version: '1.10.0', animation_controllers: result });
    }
  }

  function image(path: string, special: boolean): void {
    if (special) reader.string();
    const data = reader.blob();
    const width = reader.varint();
    const height = reader.varint();
    const imageFormat = reader.varint();
    reader.varint();
    if (width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024) throw new Error('YSM: Invalid texture dimensions.');
    textures.push({ path, data, width, height, format: imageFormat });
  }

  function subTextures(prefix: string): void {
    for (let i = 0, count = reader.count(); i < count; i++) {
      const type = reader.varint();
      image(`${prefix}/pbr/${type}_${i}`, true);
    }
  }

  function legacyInfo(): void {
    reader.string(); reader.string(); reader.strings(); reader.strings(); reader.string(); reader.varint();
  }

  function geometry(): JsonObject {
    const bones: JsonObject[] = [];
    for (let i = 0, boneCount = reader.count(); i < boneCount; i++) {
      const parent = reader.string();
      const cubes: JsonObject[] = [];
      for (let j = 0, cubeCount = reader.count(); j < cubeCount; j++) {
        const faces: YsmBakedFace[] = [];
        const min: Vec3 = [Infinity, Infinity, Infinity];
        const max: Vec3 = [-Infinity, -Infinity, -Infinity];
        const faceCount = reader.count();
        if (faceCount > 6) throw new Error('YSM: Invalid cube face count.');
        for (let k = 0; k < faceCount; k++) {
          const rawNormal = reader.vector();
          const positions: Vec3[] = [];
          const uvs: [number, number][] = [];
          for (let vertex = 0; vertex < 4; vertex++) {
            const raw = reader.vector();
            // Compiled positions already contain cube-local rotations, in blocks and with X reflected.
            const point: Vec3 = [-raw[0] * 16, raw[1] * 16, raw[2] * 16];
            positions.push(point);
            for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
            uvs.push([reader.float(), reader.float()]);
          }
          faces.push({ normal: [-rawNormal[0], rawNormal[1], rawNormal[2]], positions, uvs });
        }
        reader.skipInts(3);
        const origin = faces.length ? min : [0, 0, 0];
        const size = faces.length ? max.map((value, axis) => value - min[axis]) : [0, 0, 0];
        cubes.push({ origin, size, ysm_faces: faces });
      }
      const name = reader.string();
      reader.skipInts(5);
      const pivot = reader.vector();
      const rotation = reader.vector();
      bones.push({ name, ...(parent ? { parent } : {}), pivot: [-pivot[0], pivot[1], pivot[2]], rotation: [-rotation[0] * 180 / Math.PI, -rotation[1] * 180 / Math.PI, rotation[2] * 180 / Math.PI], cubes });
    }
    const identifier = reader.string();
    const textureHeight = reader.float();
    const textureWidth = reader.float();
    const boundsHeight = reader.float();
    const boundsWidth = reader.float();
    const boundsOffset = Array.from({ length: reader.count() }, () => reader.float());
    reader.float(); reader.float();
    if (reader.varint() > 0) legacyInfo();
    reader.skipInts(3);
    return { format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier, texture_width: textureWidth, texture_height: textureHeight, visible_bounds_width: boundsWidth, visible_bounds_height: boundsHeight, visible_bounds_offset: boundsOffset }, bones }] };
  }

  function subEntities(prefix: string): void {
    for (let i = 0, count = reader.count(); i < count; i++) {
      if (format <= 26) reader.string();
      const folder = `${prefix}/${i}`;
      for (let j = 0, animCount = reader.count(); j < animCount; j++) {
        reader.string();
        writeJson(`${folder}/animations/${j}.animation.json`, animations());
      }
      controllers(`${folder}/controllers`, false);
      image(`${folder}/textures/main`, true);
      subTextures(`${folder}/textures`);
      reader.string();
      writeJson(`${folder}/model.json`, geometry());
      if (format > 26) reader.strings();
    }
  }

  subEntities('vehicles');
  if (format < 26) reader.varint();
  else subEntities('projectiles');
  if (reader.varint() !== 1) throw new Error('YSM: Missing player entity.');
  for (let i = 0, count = reader.count(); i < count; i++) {
    const type = reader.varint();
    reader.string();
    const path = `animations/${ANIMATION_TYPES[type] ?? type}.animation.json`;
    const animationFile = animations();
    writeJson(path, animationFile);
    if (type === 1) autoAnimations.push(...Object.keys(animationFile.animations).filter((name) => /^(?:pre_)?parallel[0-7]$/.test(name)).sort());
    animationPaths.push(path);
  }
  controllers('controllers', true);
  for (let i = 0, count = reader.count(); i < count; i++) {
    const name = reader.string();
    reader.string();
    const path = `textures/${name}`;
    image(path, false);
    textureDescriptors.push({ id: name, path });
    subTextures(path);
  }
  let mainModelPath: string | undefined;
  for (let i = 0, count = reader.count(); i < count; i++) {
    const type = reader.varint();
    reader.string();
    const path = `models/${type === 1 ? 'main' : type === 2 ? 'arm' : type}.json`;
    writeJson(path, geometry());
    if (type === 1) mainModelPath = path;
  }
  if (!mainModelPath) throw new Error('YSM: Archive contains no main player model.');

  reader.string(); // Model properties hash.
  const metadata: JsonObject = {};
  if (reader.varint() !== 0) {
    metadata.name = reader.string();
    metadata.description = reader.string();
    metadata.license = { type: reader.string(), description: reader.string() };
    metadata.authors = Array.from({ length: reader.count() }, () => {
      const author: JsonObject = { name: reader.string(), role: reader.string() };
      author.contacts = Object.create(null);
      for (let i = 0, count = reader.count(); i < count; i++) author.contacts[reader.string()] = reader.string();
      author.comment = reader.string();
      return author;
    });
    metadata.links = Object.create(null);
    for (let i = 0, count = reader.count(); i < count; i++) metadata.links[reader.string()] = reader.string();
  }
  const properties: JsonObject = { width_scale: reader.float(), height_scale: reader.float() };
  properties.auto_animations = autoAnimations.sort((a, b) => Number(!a.startsWith('pre_')) - Number(!b.startsWith('pre_')) || a.localeCompare(b));
  properties.extra_animations = Object.create(null);
  for (let i = 0, count = reader.count(); i < count; i++) properties.extra_animations[reader.string()] = reader.string();
  properties.extra_animation_buttons = [];
  for (let i = 0, count = reader.count(); i < count; i++) {
    const button: JsonObject = { id: reader.string(), name: reader.string(), forms: [] };
    reader.varint();
    for (let j = 0, forms = reader.count(); j < forms; j++) {
      const form: JsonObject = { type: reader.string(), title: reader.string(), description: reader.string(), default: reader.string(), step: reader.float(), min: reader.float(), max: reader.float(), labels: Object.create(null) };
      for (let k = 0, labels = reader.count(); k < labels; k++) form.labels[reader.string()] = reader.string();
      button.forms.push(form);
    }
    properties.extra_animation_buttons.push(button);
  }
  for (let i = 0, count = reader.count(); i < count; i++) {
    reader.string();
    for (let j = 0, extras = reader.count(); j < extras; j++) { reader.string(); reader.string(); }
  }
  const defaultTexture = reader.string();
  properties.preview_animation = reader.string();
  properties.free = reader.varint() !== 0;
  reader.skipInts(4);
  if (format >= 32) properties.merge_multiline_expr = reader.varint() !== 0;
  reader.string(); reader.string(); // GUI foreground/background.
  for (const folder of ['avatars', 'backgrounds']) {
    for (let i = 0, count = reader.count(); i < count; i++) image(`${folder}/${reader.string()}`, false);
  }
  const defaultIndex = textureDescriptors.findIndex((texture) => texture.id === defaultTexture);
  if (defaultIndex > 0) textureDescriptors.unshift(...textureDescriptors.splice(defaultIndex, 1));
  // First-person arm files can also define parallel1, etc. The player's main
  // animation set must win these duplicate names when the engine merges clips.
  animationPaths.sort((a, b) => Number(a === 'animations/main.animation.json') - Number(b === 'animations/main.animation.json'));
  writeJson('ysm.json', { spec: 2, metadata, properties, files: { player: { model: { main: mainModelPath }, animation: Object.fromEntries(animationPaths.map((path, index) => [index, path])), texture: textureDescriptors } } });
  return { files, textures };
}
