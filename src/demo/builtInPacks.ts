import { zipSync } from 'fflate';
import type { YsmPackFilesInput } from '../lib/loader/types';
import {
  canvasToPngBytes,
  createAutomatonTexture,
  createSakuraFoxTexture,
  createValkyrieTextures,
} from './pixelTextures';

export interface BuiltInPackMeta {
  id: string;
  name: string;
  author: string;
  styleTag: string;
  uvFeature: string;
  description: string;
  defaultAnimation: string;
  additiveSample: string;
  buildFiles: () => YsmPackFilesInput;
}

/* ============================================================================
 * PACK 1: Sakura Kitsune (Classic WineFox Single-Atlas Box UV + Mirror + CatmullRom)
 * ============================================================================ */

const SAKURA_YSM_JSON = {
  spec: 2,
  metadata: {
    name: 'Sakura Kitsune',
    authors: ['Studio Kitsune'],
    description: 'Single-atlas 128x128 Box UV character with mirrored limbs, inflate bangs, and Catmull-Rom + MoLang multi-segment tail.',
  },
  files: {
    player: {
      model: { main: 'models/main.json' },
      animation: { main: 'animations/main.animation.json' },
      texture: [{ id: 'skin', uv: 'textures/skin.png' }],
    },
  },
};

const SAKURA_MAIN_JSON = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: {
        identifier: 'geometry.sakura_kitsune',
        texture_width: 128,
        texture_height: 128,
        visible_bounds_width: 2,
        visible_bounds_height: 2.5,
        visible_bounds_offset: [0, 1, 0],
      },
      bones: [
        {
          name: 'root',
          pivot: [0, 0, 0],
        },
        {
          name: 'waist',
          parent: 'root',
          pivot: [0, 12, 0],
        },
        {
          name: 'torso',
          parent: 'waist',
          pivot: [0, 12, 0],
          cubes: [
            { origin: [-4, 12, -2], size: [8, 12, 4], uv: [0, 20] },
            { origin: [-5, 7, -3], size: [10, 7, 6], uv: [0, 40], inflate: 0.15 },
          ],
        },
        {
          name: 'head',
          parent: 'torso',
          pivot: [0, 24, 0],
          cubes: [
            { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
            { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.45 },
          ],
        },
        {
          name: 'ear_r',
          parent: 'head',
          pivot: [-3, 31.5, 0],
          rotation: [0, 0, -14],
          cubes: [{ origin: [-4.5, 31, -1], size: [3, 4, 2], uv: [0, 60] }],
        },
        {
          name: 'ear_l',
          parent: 'head',
          pivot: [3, 31.5, 0],
          rotation: [0, 0, 14],
          mirror: true,
          cubes: [{ origin: [1.5, 31, -1], size: [3, 4, 2], uv: [0, 60], mirror: true }],
        },
        {
          name: 'rightArm',
          parent: 'torso',
          pivot: [-5.5, 22.5, 0],
          cubes: [{ origin: [-7, 13.5, -1.5], size: [3, 10, 3], uv: [36, 20] }],
        },
        {
          name: 'weapon',
          parent: 'rightArm',
          pivot: [-5.5, 14.5, -1],
          rotation: [-12, 0, 0],
          cubes: [
            { origin: [-6, 13.7, -11.5], size: [1, 1.6, 12], uv: [80, 20] },
            { origin: [-6.5, 13.1, -2.5], size: [2, 2.8, 1], uv: [80, 20] },
          ],
        },
        {
          name: 'leftArm',
          parent: 'torso',
          pivot: [5.5, 22.5, 0],
          mirror: true,
          cubes: [{ origin: [4, 13.5, -1.5], size: [3, 10, 3], uv: [36, 20], mirror: true }],
        },
        {
          name: 'rightLeg',
          parent: 'root',
          pivot: [-2, 12, 0],
          cubes: [{ origin: [-4, 0, -2], size: [4, 12, 4], uv: [56, 20] }],
        },
        {
          name: 'leftLeg',
          parent: 'root',
          pivot: [2, 12, 0],
          mirror: true,
          cubes: [{ origin: [0, 0, -2], size: [4, 12, 4], uv: [56, 20], mirror: true }],
        },
        {
          name: 'tail_1',
          parent: 'waist',
          pivot: [0, 12, 2.5],
          rotation: [-22, 0, 0],
          cubes: [{ origin: [-2, 10, 2.5], size: [4, 4, 6], uv: [20, 60] }],
        },
        {
          name: 'tail_2',
          parent: 'tail_1',
          pivot: [0, 12, 8],
          rotation: [12, 0, 0],
          cubes: [{ origin: [-2, 10, 8], size: [4, 4, 6], uv: [20, 60], inflate: 0.25 }],
        },
        {
          name: 'tail_3',
          parent: 'tail_2',
          pivot: [0, 12, 13.5],
          rotation: [16, 0, 0],
          cubes: [{ origin: [-1.5, 10.5, 13.5], size: [3, 3, 5], uv: [48, 60] }],
        },
      ],
    },
  ],
};

const SAKURA_ANIM_JSON = {
  format_version: '1.8.0',
  animations: {
    idle: {
      loop: true,
      animation_length: 2.4,
      bones: {
        waist: {
          position: [0, 'v.breath = math.sin(q.anim_time * 150) * 0.35; return v.breath;', 0],
        },
        head: {
          rotation: {
            '0.0': { post: [0, -4, 0], lerp_mode: 'catmullrom' },
            '0.8': { post: [3, 5, 2], lerp_mode: 'catmullrom' },
            '1.6': { post: [-2, 3, -2], lerp_mode: 'catmullrom' },
            '2.4': { post: [0, -4, 0], lerp_mode: 'catmullrom' },
          },
        },
        ear_r: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '1.0': { post: [0, 0, -4], lerp_mode: 'catmullrom' },
            '1.2': { post: [8, 0, -18], lerp_mode: 'catmullrom' },
            '1.5': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '2.4': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        ear_l: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '1.8': { post: [0, 0, 5], lerp_mode: 'catmullrom' },
            '2.0': { post: [6, 0, 16], lerp_mode: 'catmullrom' },
            '2.4': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        rightArm: {
          rotation: ['math.sin(q.anim_time * 150) * 3', 0, '5 + math.cos(q.anim_time * 150) * 2'],
        },
        leftArm: {
          rotation: ['-math.sin(q.anim_time * 150) * 3', 0, '-5 - math.cos(q.anim_time * 150) * 2'],
        },
        tail_1: {
          rotation: ['math.sin(q.anim_time * 150) * 4', 'math.sin(q.anim_time * 150) * 16', 0],
        },
        tail_2: {
          rotation: [0, 'math.sin(q.anim_time * 150 - 45) * 18', 0],
        },
        tail_3: {
          rotation: [0, 'math.sin(q.anim_time * 150 - 90) * 22', 0],
        },
      },
    },
    walk: {
      loop: true,
      animation_length: 1.0,
      bones: {
        waist: {
          position: [0, 'math.abs(math.cos(q.anim_time * 360)) * 0.9', 0],
          rotation: ['4 + q.ground_speed * 5', 'math.sin(q.anim_time * 360) * 6', 0],
        },
        head: {
          rotation: ['-4 - q.ground_speed * 3', '-math.sin(q.anim_time * 360) * 4', 0],
        },
        rightLeg: {
          rotation: ['math.sin(q.anim_time * 360) * math.clamp(22 + q.ground_speed * 28, 16, 54)', 0, 0],
        },
        leftLeg: {
          rotation: ['-math.sin(q.anim_time * 360) * math.clamp(22 + q.ground_speed * 28, 16, 54)', 0, 0],
        },
        rightArm: {
          rotation: ['-math.sin(q.anim_time * 360) * math.clamp(18 + q.ground_speed * 24, 14, 46)', 0, 8],
        },
        leftArm: {
          rotation: ['math.sin(q.anim_time * 360) * math.clamp(18 + q.ground_speed * 24, 14, 46)', 0, -8],
        },
        tail_1: {
          rotation: [10, 'math.sin(q.anim_time * 360) * 20', 0],
        },
        tail_2: {
          rotation: [6, 'math.sin(q.anim_time * 360 - 60) * 22', 0],
        },
        tail_3: {
          rotation: [4, 'math.sin(q.anim_time * 360 - 120) * 26', 0],
        },
      },
    },
    attack: {
      loop: false,
      animation_length: 0.72,
      bones: {
        torso: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '0.18': { post: [-10, -24, 0], lerp_mode: 'catmullrom' },
            '0.32': { post: [16, 32, 0], lerp_mode: 'step' },
            '0.44': { post: [14, 28, 0], lerp_mode: 'catmullrom' },
            '0.72': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        rightArm: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '0.18': { post: [-135, -18, 22], lerp_mode: 'catmullrom' },
            '0.32': { post: [-22, 26, -18], lerp_mode: 'step' },
            '0.46': { post: [-18, 22, -12], lerp_mode: 'catmullrom' },
            '0.72': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        leftArm: {
          rotation: {
            '0.0': [0, 0, 0],
            '0.20': [-24, 0, -28],
            '0.36': [26, 0, -18],
            '0.72': [0, 0, 0],
          },
        },
      },
    },
    wave: {
      loop: true,
      animation_length: 1.2,
      bones: {
        leftArm: {
          rotation: {
            '0.0': { post: [-145, 0, -24], lerp_mode: 'catmullrom' },
            '0.3': { post: [-145, 0, -48], lerp_mode: 'catmullrom' },
            '0.6': { post: [-145, 0, -20], lerp_mode: 'catmullrom' },
            '0.9': { post: [-145, 0, -48], lerp_mode: 'catmullrom' },
            '1.2': { post: [-145, 0, -24], lerp_mode: 'catmullrom' },
          },
        },
      },
    },
  },
};

/* ============================================================================
 * PACK 2: Aegis Valkyrie (Multi-Texture ysm.json + Per-Face UV + Inflate Visor)
 * ============================================================================ */

const VALKYRIE_YSM_JSON = {
  spec: 2,
  metadata: {
    name: 'Aegis Valkyrie',
    authors: ['Orbital Craftworks'],
    description: 'Multi-texture YSM v2 pack pairing an armored 128x128 Box UV body with 64x64 Per-Face UV holographic wings and energy blade.',
  },
  files: {
    player: {
      model: { main: 'models/main.json' },
      animation: { main: 'animations/main.animation.json' },
      texture: [
        { id: 'armor', uv: 'textures/armor.png' },
        { id: 'wings', uv: 'textures/wings.png' },
      ],
    },
  },
  bone_textures: {
    wing_r: 'wings',
    wing_r_tip: 'wings',
    wing_l: 'wings',
    wing_l_tip: 'wings',
    energy_blade: 'wings',
  },
};

const VALKYRIE_MAIN_JSON = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: {
        identifier: 'geometry.aegis_valkyrie',
        texture_width: 128,
        texture_height: 128,
        visible_bounds_width: 3,
        visible_bounds_height: 2.5,
        visible_bounds_offset: [0, 1.1, 0],
      },
      bones: [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'torso', parent: 'root', pivot: [0, 12, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [0, 20] }] },
        {
          name: 'head',
          parent: 'torso',
          pivot: [0, 24, 0],
          cubes: [
            { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
            // Per-Face UV holographic visor with bidirectional inflate
            {
              origin: [-4, 26, -4],
              size: [8, 3, 2],
              inflate: 0.45,
              uv: {
                north: { uv: [80, 0], uv_size: [16, 8] },
                east: { uv: [80, 0], uv_size: [4, 8] },
                west: { uv: [92, 0], uv_size: [4, 8] },
                up: { uv: [80, 0], uv_size: [16, 2] },
              },
            },
          ],
        },
        {
          name: 'rightArm',
          parent: 'torso',
          pivot: [-6, 22, 0],
          cubes: [
            { origin: [-8, 12, -2], size: [4, 11, 4], uv: [36, 20] },
            { origin: [-8.5, 20.5, -2.5], size: [5, 4, 5], uv: [32, 0], inflate: 0.2 },
          ],
        },
        {
          name: 'energy_blade',
          parent: 'rightArm',
          pivot: [-6, 13, -1],
          material: 'wings',
          cubes: [
            {
              origin: [-6.5, 11, -13],
              size: [1, 3, 13],
              uv: {
                east: { uv: [72, 0], uv_size: [48, 96] },
                west: { uv: [72, 0], uv_size: [48, 96] },
                up: { uv: [76, 0], uv_size: [40, 96] },
                down: { uv: [76, 0], uv_size: [40, 96] },
                north: { uv: [84, 8], uv_size: [20, 20] },
                south: { uv: [84, 8], uv_size: [20, 20] },
              },
            },
          ],
        },
        {
          name: 'leftArm',
          parent: 'torso',
          pivot: [6, 22, 0],
          mirror: true,
          cubes: [
            { origin: [4, 12, -2], size: [4, 11, 4], uv: [36, 20], mirror: true },
            { origin: [3.5, 20.5, -2.5], size: [5, 4, 5], uv: [32, 0], inflate: 0.2, mirror: true },
          ],
        },
        {
          name: 'rightLeg',
          parent: 'root',
          pivot: [-2, 12, 0],
          cubes: [{ origin: [-4, 0, -2], size: [4, 12, 4], uv: [56, 20] }],
        },
        {
          name: 'leftLeg',
          parent: 'root',
          pivot: [2, 12, 0],
          mirror: true,
          cubes: [{ origin: [0, 0, -2], size: [4, 12, 4], uv: [56, 20], mirror: true }],
        },
        // Multi-texture Per-Face UV Wings (bound to texture "wings")
        {
          name: 'wing_r',
          parent: 'torso',
          pivot: [-2, 20, 2.4],
          rotation: [6, 16, -6],
          material: 'wings',
          cubes: [
            {
              origin: [-14, 15, 2.2],
              size: [12, 8, 0.8],
              uv: {
                north: { uv: [0, 0], uv_size: [64, 40] },
                south: { uv: [0, 0], uv_size: [64, 40] },
                up: { uv: [0, 0], uv_size: [64, 4] },
                down: { uv: [0, 36], uv_size: [64, 4] },
                east: { uv: [0, 0], uv_size: [4, 40] },
                west: { uv: [60, 0], uv_size: [4, 40] },
              },
            },
          ],
        },
        {
          name: 'wing_r_tip',
          parent: 'wing_r',
          pivot: [-13.5, 19.5, 2.6],
          rotation: [0, 10, 6],
          material: 'wings',
          cubes: [
            {
              origin: [-22.5, 16.5, 2.25],
              size: [9.5, 6, 0.6],
              uv: {
                north: { uv: [0, 48], uv_size: [56, 28] },
                south: { uv: [0, 48], uv_size: [56, 28] },
                up: { uv: [0, 48], uv_size: [56, 4] },
                down: { uv: [0, 72], uv_size: [56, 4] },
                east: { uv: [0, 48], uv_size: [4, 28] },
                west: { uv: [52, 48], uv_size: [4, 28] },
              },
            },
          ],
        },
        {
          name: 'wing_l',
          parent: 'torso',
          pivot: [2, 20, 2.4],
          rotation: [6, -16, 6],
          material: 'wings',
          mirror: true,
          cubes: [
            {
              origin: [2, 15, 2.2],
              size: [12, 8, 0.8],
              mirror: true,
              uv: {
                north: { uv: [0, 0], uv_size: [64, 40] },
                south: { uv: [0, 0], uv_size: [64, 40] },
                up: { uv: [0, 0], uv_size: [64, 4] },
                down: { uv: [0, 36], uv_size: [64, 4] },
                east: { uv: [0, 0], uv_size: [4, 40] },
                west: { uv: [60, 0], uv_size: [4, 40] },
              },
            },
          ],
        },
        {
          name: 'wing_l_tip',
          parent: 'wing_l',
          pivot: [13.5, 19.5, 2.6],
          rotation: [0, -10, -6],
          material: 'wings',
          mirror: true,
          cubes: [
            {
              origin: [13, 16.5, 2.25],
              size: [9.5, 6, 0.6],
              mirror: true,
              uv: {
                north: { uv: [0, 48], uv_size: [56, 28] },
                south: { uv: [0, 48], uv_size: [56, 28] },
                up: { uv: [0, 48], uv_size: [56, 4] },
                down: { uv: [0, 72], uv_size: [56, 4] },
                east: { uv: [0, 48], uv_size: [4, 28] },
                west: { uv: [52, 48], uv_size: [4, 28] },
              },
            },
          ],
        },
      ],
    },
  ],
};

const VALKYRIE_ANIM_JSON = {
  format_version: '1.8.0',
  animations: {
    idle: {
      loop: true,
      animation_length: 2.0,
      bones: {
        root: {
          position: [0, 'q.is_on_ground ? 0 : 2.2 + math.sin(q.anim_time * 180) * 0.9', 0],
        },
        torso: {
          rotation: ['q.is_on_ground ? math.sin(q.anim_time * 180) * 2 : 10', 0, 0],
        },
        wing_r: {
          rotation: [
            0,
            'q.is_on_ground ? math.sin(q.anim_time * 180) * 8 : -16 + math.sin(q.anim_time * 540) * 18',
            'q.is_on_ground ? math.cos(q.anim_time * 180) * 4 : -14',
          ],
        },
        wing_r_tip: {
          rotation: [0, 'math.sin(q.anim_time * 180 - 40) * 10', 0],
        },
        wing_l: {
          rotation: [
            0,
            'q.is_on_ground ? -math.sin(q.anim_time * 180) * 8 : 16 - math.sin(q.anim_time * 540) * 18',
            'q.is_on_ground ? -math.cos(q.anim_time * 180) * 4 : 14',
          ],
        },
        wing_l_tip: {
          rotation: [0, '-math.sin(q.anim_time * 180 - 40) * 10', 0],
        },
        rightArm: {
          rotation: [-10, 0, '6 + math.sin(q.anim_time * 180) * 2'],
        },
        leftArm: {
          rotation: [-6, 0, '-6 - math.sin(q.anim_time * 180) * 2'],
        },
      },
    },
    walk: {
      loop: true,
      animation_length: 0.9,
      bones: {
        root: {
          position: [0, 'math.abs(math.sin(q.anim_time * 400)) * 0.7', 0],
        },
        torso: {
          rotation: ['6 + q.ground_speed * 8', 'math.sin(q.anim_time * 400) * 5', 0],
        },
        rightLeg: {
          rotation: ['math.sin(q.anim_time * 400) * math.clamp(24 + q.ground_speed * 26, 18, 52)', 0, 0],
        },
        leftLeg: {
          rotation: ['-math.sin(q.anim_time * 400) * math.clamp(24 + q.ground_speed * 26, 18, 52)', 0, 0],
        },
        rightArm: {
          rotation: ['-math.sin(q.anim_time * 400) * 22 - 14', 0, 10],
        },
        leftArm: {
          rotation: ['math.sin(q.anim_time * 400) * 26', 0, -10],
        },
        wing_r: {
          rotation: [6, '14 + q.ground_speed * 10 + math.sin(q.anim_time * 400) * 6', -6],
        },
        wing_l: {
          rotation: [6, '-14 - q.ground_speed * 10 - math.sin(q.anim_time * 400) * 6', 6],
        },
      },
    },
    attack: {
      loop: false,
      animation_length: 0.65,
      bones: {
        torso: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '0.15': { post: [-8, -32, 0], lerp_mode: 'catmullrom' },
            '0.30': { post: [10, 40, 0], lerp_mode: 'catmullrom' },
            '0.65': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        rightArm: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '0.15': { post: [-88, -42, 48], lerp_mode: 'catmullrom' },
            '0.30': { post: [-76, 48, -32], lerp_mode: 'catmullrom' },
            '0.65': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        wing_r: {
          rotation: {
            '0.0': [0, 0, 0],
            '0.22': [0, -26, -18],
            '0.65': [0, 0, 0],
          },
        },
        wing_l: {
          rotation: {
            '0.0': [0, 0, 0],
            '0.22': [0, 26, 18],
            '0.65': [0, 0, 0],
          },
        },
      },
    },
    guard_hold: {
      loop: 'hold_on_last_frame',
      animation_length: 0.4,
      bones: {
        rightArm: {
          rotation: {
            '0.0': [0, 0, 0],
            '0.4': [-65, 34, -18],
          },
        },
        wing_r: {
          rotation: {
            '0.0': [0, 0, 0],
            '0.4': [0, -34, 8],
          },
        },
        wing_l: {
          rotation: {
            '0.0': [0, 0, 0],
            '0.4': [0, 34, -8],
          },
        },
      },
    },
  },
};

/* ============================================================================
 * PACK 3: Chrono Automaton (Deep Hierarchy + Persistent variable.* Clockwork)
 * ============================================================================ */

const AUTOMATON_YSM_JSON = {
  spec: 2,
  metadata: {
    name: 'Chrono Automaton',
    authors: ['Brassworks Guild'],
    description: 'Steampunk articulated automaton with persistent MoLang variable.gear_spin, step/catmullrom piston kinematics, and 4-level bone chains.',
  },
  files: {
    player: {
      model: { main: 'models/main.json' },
      animation: { main: 'animations/main.animation.json' },
      texture: [{ id: 'brass', uv: 'textures/brass.png' }],
    },
  },
};

const AUTOMATON_MAIN_JSON = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: {
        identifier: 'geometry.chrono_automaton',
        texture_width: 128,
        texture_height: 128,
        visible_bounds_width: 2.2,
        visible_bounds_height: 2.6,
        visible_bounds_offset: [0, 1.1, 0],
      },
      bones: [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'pelvis', parent: 'root', pivot: [0, 11, 0] },
        {
          name: 'chassis',
          parent: 'pelvis',
          pivot: [0, 11, 0],
          cubes: [{ origin: [-5, 11, -3], size: [10, 11, 6], uv: [0, 20] }],
        },
        {
          name: 'head',
          parent: 'chassis',
          pivot: [0, 22, 0],
          cubes: [
            { origin: [-4, 22, -4], size: [8, 8, 8], uv: [0, 0] },
            { origin: [-4, 30, -4], size: [8, 5, 8], uv: [32, 0], inflate: 0.3 },
          ],
        },
        {
          name: 'gear_hub',
          parent: 'chassis',
          pivot: [0, 17, 3.8],
        },
        {
          name: 'gear_main',
          parent: 'gear_hub',
          pivot: [-1.5, 17.5, 4],
          cubes: [
            { origin: [-5.5, 13.5, 3], size: [8, 8, 2], uv: [0, 50] },
            {
              origin: [-5.5, 13.5, 3.1],
              size: [8, 8, 1.8],
              uv: [0, 50],
              pivot: [-1.5, 17.5, 4],
              rotation: [0, 0, 45],
            },
          ],
        },
        {
          name: 'gear_sub',
          parent: 'gear_hub',
          pivot: [4, 14, 4.4],
          cubes: [
            { origin: [1.5, 11.5, 3.6], size: [5, 5, 1.6], uv: [0, 50] },
            {
              origin: [1.5, 11.5, 3.7],
              size: [5, 5, 1.4],
              uv: [0, 50],
              pivot: [4, 14, 4.4],
              rotation: [0, 0, 45],
            },
          ],
        },
        {
          name: 'rightArm',
          parent: 'chassis',
          pivot: [-7, 20, 0],
          cubes: [{ origin: [-9, 10, -2], size: [4, 11, 4], uv: [36, 20] }],
        },
        {
          name: 'hammer',
          parent: 'rightArm',
          pivot: [-7, 11, -1],
          rotation: [-75, 0, 0],
          cubes: [
            { origin: [-8.5, 8, -2.5], size: [3, 12, 3], uv: [28, 50] },
            { origin: [-10, 18, -4], size: [6, 4, 6], uv: [0, 50] },
          ],
        },
        {
          name: 'leftArm',
          parent: 'chassis',
          pivot: [7, 20, 0],
          mirror: true,
          cubes: [{ origin: [5, 10, -2], size: [4, 11, 4], uv: [36, 20], mirror: true }],
        },
        {
          name: 'rightLeg',
          parent: 'root',
          pivot: [-2.5, 11, 0],
          cubes: [{ origin: [-4.5, 0, -2], size: [4, 11, 4], uv: [56, 20] }],
        },
        {
          name: 'leftLeg',
          parent: 'root',
          pivot: [2.5, 11, 0],
          mirror: true,
          cubes: [{ origin: [0.5, 0, -2], size: [4, 11, 4], uv: [56, 20], mirror: true }],
        },
      ],
    },
  ],
};

const AUTOMATON_ANIM_JSON = {
  format_version: '1.8.0',
  animations: {
    idle: {
      loop: true,
      animation_length: 2.0,
      bones: {
        gear_main: {
          rotation: [
            0,
            0,
            'v.gear_spin = v.gear_spin + q.delta_time * (55 + q.ground_speed * 160); return v.gear_spin;',
          ],
        },
        gear_sub: {
          rotation: [0, 0, '-v.gear_spin * 1.6'],
        },
        chassis: {
          position: [0, 'math.sin(q.anim_time * 360) * 0.25', 0],
        },
        head: {
          rotation: {
            '0.0': { post: [0, -10, 0], lerp_mode: 'step' },
            '0.5': { post: [0, 0, 0], lerp_mode: 'linear' },
            '1.0': { post: [0, 10, 0], lerp_mode: 'step' },
            '1.5': { post: [0, 0, 0], lerp_mode: 'linear' },
            '2.0': { post: [0, -10, 0], lerp_mode: 'step' },
          },
        },
      },
    },
    walk: {
      loop: true,
      animation_length: 1.1,
      bones: {
        gear_main: {
          rotation: [
            0,
            0,
            'v.gear_spin = v.gear_spin + q.delta_time * (110 + q.ground_speed * 220); return v.gear_spin;',
          ],
        },
        gear_sub: {
          rotation: [0, 0, '-v.gear_spin * 1.6'],
        },
        pelvis: {
          position: [0, 'math.abs(math.sin(q.anim_time * 327.27)) * 0.8', 0],
          rotation: [4, 0, 'math.sin(q.anim_time * 327.27) * 4'],
        },
        rightLeg: {
          rotation: ['math.sin(q.anim_time * 327.27) * math.clamp(20 + q.ground_speed * 22, 16, 44)', 0, 0],
        },
        leftLeg: {
          rotation: ['-math.sin(q.anim_time * 327.27) * math.clamp(20 + q.ground_speed * 22, 16, 44)', 0, 0],
        },
        rightArm: {
          rotation: ['-math.sin(q.anim_time * 327.27) * 26', 0, 8],
        },
        leftArm: {
          rotation: ['math.sin(q.anim_time * 327.27) * 26', 0, -8],
        },
      },
    },
    attack: {
      loop: false,
      animation_length: 0.85,
      bones: {
        chassis: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '0.25': { post: [-16, -14, 0], lerp_mode: 'catmullrom' },
            '0.42': { post: [22, 16, 0], lerp_mode: 'step' },
            '0.56': { post: [18, 12, 0], lerp_mode: 'catmullrom' },
            '0.85': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
        rightArm: {
          rotation: {
            '0.0': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
            '0.25': { post: [-150, 0, 14], lerp_mode: 'catmullrom' },
            '0.42': { post: [-18, 8, -8], lerp_mode: 'step' },
            '0.56': { post: [-22, 4, -4], lerp_mode: 'catmullrom' },
            '0.85': { post: [0, 0, 0], lerp_mode: 'catmullrom' },
          },
        },
      },
    },
  },
};

export const BUILT_IN_YSM_PACKS: BuiltInPackMeta[] = [
  {
    id: 'sakura_fox',
    name: 'Sakura Kitsune',
    author: 'Studio Kitsune',
    styleTag: 'Box UV · Mirror · Catmull-Rom',
    uvFeature: '128×128 单贴图 · 镜像四肢 · 外扩刘海',
    description: '经典 YSM 单图集模型，展示 Box UV、左右镜像翻转、Catmull-Rom 样条耳动与多段狐尾 MoLang 波动。',
    defaultAnimation: 'idle',
    additiveSample: 'attack',
    buildFiles: () => ({
      name: 'sakura_fox',
      files: {
        'ysm.json': JSON.stringify(SAKURA_YSM_JSON, null, 2),
        'models/main.json': JSON.stringify(SAKURA_MAIN_JSON, null, 2),
        'animations/main.animation.json': JSON.stringify(SAKURA_ANIM_JSON, null, 2),
        'textures/skin.png': createSakuraFoxTexture(),
      },
    }),
  },
  {
    id: 'aegis_valkyrie',
    name: 'Aegis Valkyrie',
    author: 'Orbital Craftworks',
    styleTag: '多贴图 · Per-Face UV · Inflate',
    uvFeature: '双贴图材质表 · 按面 UV 羽翼与面罩',
    description: 'YSM v2 多贴图规范模型，机身使用 Box UV，全息羽翼与能量刃使用独立贴图与 Per-Face UV，支持 query.is_on_ground 悬停切换。',
    defaultAnimation: 'idle',
    additiveSample: 'attack',
    buildFiles: () => {
      const { armor, wings } = createValkyrieTextures();
      return {
        name: 'aegis_valkyrie',
        files: {
          'ysm.json': JSON.stringify(VALKYRIE_YSM_JSON, null, 2),
          'models/main.json': JSON.stringify(VALKYRIE_MAIN_JSON, null, 2),
          'animations/main.animation.json': JSON.stringify(VALKYRIE_ANIM_JSON, null, 2),
          'textures/armor.png': armor,
          'textures/wings.png': wings,
        },
      };
    },
  },
  {
    id: 'chrono_automaton',
    name: 'Chrono Automaton',
    author: 'Brassworks Guild',
    styleTag: '4层骨骼 · Variable 持久化 · Step',
    uvFeature: '多级联动齿轮 · variable.gear_spin',
    description: '蒸汽机械结构模型，使用实例级持久化 MoLang 变量驱动背部双齿轮啮合旋转，结合 step 与 catmullrom 重锤打击动作。',
    defaultAnimation: 'idle',
    additiveSample: 'attack',
    buildFiles: () => ({
      name: 'chrono_automaton',
      files: {
        'ysm.json': JSON.stringify(AUTOMATON_YSM_JSON, null, 2),
        'models/main.json': JSON.stringify(AUTOMATON_MAIN_JSON, null, 2),
        'animations/main.animation.json': JSON.stringify(AUTOMATON_ANIM_JSON, null, 2),
        'textures/brass.png': createAutomatonTexture(),
      },
    }),
  },
];

/**
 * Packages any built-in pack into a real binary `.zip` Blob via `fflate.zipSync`,
 * allowing both live Zip-loader self-tests and user download/re-import.
 */
export async function exportBuiltInPackAsZip(pack: BuiltInPackMeta): Promise<Blob> {
  const input = pack.buildFiles();
  const encoder = new TextEncoder();
  const zipEntries: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(input.files)) {
    const fullPath = `${pack.id}/${path}`;
    if (typeof content === 'string') {
      zipEntries[fullPath] = encoder.encode(content);
    } else if (content instanceof Uint8Array) {
      zipEntries[fullPath] = content;
    } else if (content instanceof HTMLCanvasElement) {
      zipEntries[fullPath] = await canvasToPngBytes(content);
    } else if (content instanceof Blob) {
      zipEntries[fullPath] = new Uint8Array(await content.arrayBuffer());
    }
  }

  const zipped = zipSync(zipEntries, { level: 6 });
  return new Blob([zipped.slice().buffer], { type: 'application/zip' });
}
