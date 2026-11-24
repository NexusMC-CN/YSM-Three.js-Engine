/**
 * Procedural pixel-art skin generators (128x128 & 64x64) matching the exact
 * Bedrock Box UV and Per-Face UV regions of our 3 built-in YSM model packs.
 *
 * Rendered onto offscreen HTMLCanvasElements (zero external 404 image URLs),
 * and exportable to real PNG Uint8Arrays for `.zip` pack testing.
 */

function createPixelCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  return { canvas, ctx };
}

/** Paints a standard Minecraft Box UV net with subtle pixel shading and crisp borders */
function paintBoxUV(
  ctx: CanvasRenderingContext2D,
  u: number,
  v: number,
  w: number,
  h: number,
  d: number,
  colors: {
    base: string;
    shade: string;
    highlight: string;
    front?: string;
    accent?: string;
  },
): void {
  const fillFace = (x: number, y: number, fw: number, fh: number, fill: string) => {
    if (fw <= 0 || fh <= 0) return;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, fw, fh);
    // Subtle 1px shading along bottom & right edges for crisp voxel depth
    ctx.fillStyle = colors.shade;
    ctx.fillRect(x, y + fh - 1, fw, 1);
    ctx.fillRect(x + fw - 1, y, 1, fh);
    // Top highlight
    ctx.fillStyle = colors.highlight;
    ctx.fillRect(x, y, fw, 1);
  };

  // Up & Down
  fillFace(u + d, v, w, d, colors.highlight);
  fillFace(u + d + w, v, w, d, colors.shade);
  // East, North (Front), West, South (Back)
  fillFace(u, v + d, d, h, colors.base);
  fillFace(u + d, v + d, w, h, colors.front ?? colors.base);
  fillFace(u + d + w, v + d, d, h, colors.base);
  fillFace(u + 2 * d + w, v + d, w, h, colors.shade);

  if (colors.accent && w >= 4 && h >= 4) {
    ctx.fillStyle = colors.accent;
    ctx.fillRect(u + d + 1, v + d + Math.floor(h * 0.55), Math.max(1, w - 2), 1);
  }
}

/**
 * Pack 1 Texture: Sakura Kitsune (128x128 single-atlas Box UV skin)
 */
export function createSakuraFoxTexture(): HTMLCanvasElement {
  const { canvas, ctx } = createPixelCanvas(128, 128);

  // Head [0, 0], size [8, 8, 8]
  paintBoxUV(ctx, 0, 0, 8, 8, 8, {
    base: '#fde8dc',
    shade: '#f1c7b2',
    highlight: '#fff3ec',
    front: '#feece2',
  });
  // Hair cap on head back/sides/top
  ctx.fillStyle = '#f48fb1';
  ctx.fillRect(8, 0, 8, 8); // top hair
  ctx.fillRect(24, 8, 8, 8); // back hair
  ctx.fillRect(0, 8, 8, 5); // east hair
  ctx.fillRect(16, 8, 8, 5); // west hair
  ctx.fillRect(8, 8, 8, 2); // forehead bangs
  // Cute anime eyes on North face (u=8..16, v=8..16)
  ctx.fillStyle = '#3b1c32';
  ctx.fillRect(9, 11, 2, 2);
  ctx.fillRect(13, 11, 2, 2);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(9, 12, 2, 1);
  ctx.fillRect(13, 12, 2, 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(9, 11, 1, 1);
  ctx.fillRect(13, 11, 1, 1);
  // Blush pixels
  ctx.fillStyle = '#f472b6';
  ctx.fillRect(8, 13, 1, 1);
  ctx.fillRect(15, 13, 1, 1);

  // Hair outer overlay [32, 0], size [8, 8, 8] (transparent face opening!)
  ctx.fillStyle = '#ec4899';
  ctx.fillRect(40, 0, 8, 8); // top
  ctx.fillRect(56, 8, 8, 8); // back
  ctx.fillRect(32, 8, 8, 6); // east
  ctx.fillRect(48, 8, 8, 6); // west
  ctx.fillStyle = '#fbcfe8';
  ctx.fillRect(40, 8, 8, 2); // bangs fringe
  ctx.fillRect(40, 10, 1, 3); // side lock L
  ctx.fillRect(47, 10, 1, 3); // side lock R

  // Torso / Kimono [0, 20], size [8, 12, 4]
  paintBoxUV(ctx, 0, 20, 8, 12, 4, {
    base: '#fff1f2',
    shade: '#e2d4d8',
    highlight: '#ffffff',
    front: '#fff5f7',
  });
  // Crimson obi sash & gold knot on North face (u=4..12, v=24..36)
  ctx.fillStyle = '#be123c';
  ctx.fillRect(0, 30, 24, 3);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(6, 30, 4, 2);
  // Kimono collar V-fold
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(5, 24, 1, 3);
  ctx.fillRect(10, 24, 1, 3);
  ctx.fillRect(6, 26, 4, 1);

  // Skirt [0, 40], size [10, 7, 6]
  paintBoxUV(ctx, 0, 40, 10, 7, 6, {
    base: '#be123c',
    shade: '#881337',
    highlight: '#e11d48',
    accent: '#fde68a',
  });

  // Arms [36, 20], size [3, 10, 3] (shared by right arm & mirrored left arm!)
  paintBoxUV(ctx, 36, 20, 3, 10, 3, {
    base: '#fff1f2',
    shade: '#f9a8d4',
    highlight: '#ffffff',
    accent: '#be123c',
  });
  // Hand tips
  ctx.fillStyle = '#fde8dc';
  ctx.fillRect(36, 30, 12, 3);

  // Legs [56, 20], size [4, 12, 4] (shared by right leg & mirrored left leg!)
  paintBoxUV(ctx, 56, 20, 4, 12, 4, {
    base: '#fef2f2',
    shade: '#e5e7eb',
    highlight: '#ffffff',
  });
  // Thigh-high socks & red shoes
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(56, 27, 16, 6);
  ctx.fillStyle = '#be123c';
  ctx.fillRect(56, 33, 16, 3);

  // Fox Ears [0, 60], size [3, 4, 2]
  paintBoxUV(ctx, 0, 60, 3, 4, 2, {
    base: '#f472b6',
    shade: '#db2777',
    highlight: '#fbcfe8',
    front: '#fff1f2',
  });

  // Fox Tail segments [20, 60], size [4, 4, 6]
  paintBoxUV(ctx, 20, 60, 4, 4, 6, {
    base: '#f472b6',
    shade: '#be185d',
    highlight: '#fbcfe8',
  });
  // White fluffy tail tip [48, 60], size [3, 3, 5]
  paintBoxUV(ctx, 48, 60, 3, 3, 5, {
    base: '#fff7ed',
    shade: '#fed7aa',
    highlight: '#ffffff',
  });

  // Katana / Fan Weapon [80, 20], size [1, 14, 2]
  paintBoxUV(ctx, 80, 20, 1, 14, 2, {
    base: '#e2e8f0',
    shade: '#94a3b8',
    highlight: '#ffffff',
    accent: '#f59e0b',
  });

  return canvas;
}

/**
 * Pack 2 Textures: Aegis Valkyrie (2 separate textures for multi-texture rendering!)
 * Texture 0 ("armor"): Armored bodysuit & helmet (128x128)
 * Texture 1 ("wings"): Holographic cyan wings & energy blade (64x64, Per-Face UV)
 */
export function createValkyrieTextures(): {
  armor: HTMLCanvasElement;
  wings: HTMLCanvasElement;
} {
  // --- Texture 0: Armor ---
  const { canvas: armor, ctx } = createPixelCanvas(128, 128);

  // Helmet / Head [0, 0], size [8, 8, 8]
  paintBoxUV(ctx, 0, 0, 8, 8, 8, {
    base: '#e2e8f0',
    shade: '#94a3b8',
    highlight: '#f8fafc',
    front: '#f1f5f9',
  });
  // Face opening & eyes
  ctx.fillStyle = '#fde6d8';
  ctx.fillRect(9, 10, 6, 5);
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(9, 11, 2, 2);
  ctx.fillRect(13, 11, 2, 2);
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(9, 11, 1, 1);
  ctx.fillRect(13, 11, 1, 1);

  // Armored Torso [0, 20], size [8, 12, 4]
  paintBoxUV(ctx, 0, 20, 8, 12, 4, {
    base: '#1e293b',
    shade: '#0f172a',
    highlight: '#475569',
    front: '#334155',
  });
  // White chest armor plating + cyan core on North face (u=4..12, v=24..36)
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(4, 24, 8, 5);
  ctx.fillStyle = '#0ea5e9';
  ctx.fillRect(7, 25, 2, 3);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(4, 30, 8, 1);

  // Shoulder Pauldrons [32, 0], size [5, 4, 5]
  paintBoxUV(ctx, 32, 0, 5, 4, 5, {
    base: '#f1f5f9',
    shade: '#94a3b8',
    highlight: '#ffffff',
    accent: '#0ea5e9',
  });

  // Armored Arms [36, 20], size [4, 11, 4]
  paintBoxUV(ctx, 36, 20, 4, 11, 4, {
    base: '#334155',
    shade: '#1e293b',
    highlight: '#cbd5e1',
    accent: '#38bdf8',
  });

  // Armored Legs [56, 20], size [4, 12, 4]
  paintBoxUV(ctx, 56, 20, 4, 12, 4, {
    base: '#1e293b',
    shade: '#0f172a',
    highlight: '#64748b',
  });
  // White greaves & gold trim
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(56, 29, 16, 6);
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(56, 29, 16, 1);

  // Visor Per-Face UV region [80, 0], 16x8
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(80, 0, 16, 8);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(80, 1, 16, 2);
  ctx.fillStyle = '#bae6fd';
  ctx.fillRect(82, 2, 4, 1);
  ctx.fillRect(90, 2, 4, 1);

  // --- Texture 1: Holographic Wings & Energy Blade (64x64) ---
  const { canvas: wings, ctx: wctx } = createPixelCanvas(64, 64);

  // Upper Wing panel Per-Face UV [0, 0, 32, 20]
  const grad1 = wctx.createLinearGradient(0, 0, 32, 20);
  grad1.addColorStop(0, '#0284c7');
  grad1.addColorStop(0.5, '#38bdf8');
  grad1.addColorStop(1, '#e0f2fe');
  wctx.fillStyle = grad1;
  wctx.fillRect(0, 0, 32, 20);
  // Crisp feather tech ribs
  wctx.fillStyle = '#0f172a';
  wctx.fillRect(0, 0, 32, 2);
  wctx.fillStyle = '#f8fafc';
  for (let i = 4; i < 30; i += 6) {
    wctx.fillRect(i, 2, 2, 16);
  }
  wctx.fillStyle = '#f59e0b';
  wctx.fillRect(0, 2, 32, 1);

  // Wing Tip Per-Face UV [0, 24, 28, 14]
  wctx.fillStyle = '#0ea5e9';
  wctx.fillRect(0, 24, 28, 14);
  wctx.fillStyle = '#7dd3fc';
  wctx.fillRect(2, 26, 24, 10);
  wctx.fillStyle = '#f0f9ff';
  wctx.fillRect(6, 28, 18, 4);

  // Energy Blade Per-Face UV [36, 0, 24, 48]
  wctx.fillStyle = '#0369a1';
  wctx.fillRect(36, 0, 24, 48);
  wctx.fillStyle = '#38bdf8';
  wctx.fillRect(39, 2, 18, 44);
  wctx.fillStyle = '#e0f2fe';
  wctx.fillRect(44, 4, 8, 40);

  return { armor, wings };
}

/**
 * Pack 3 Texture: Chrono Automaton (128x128 Steampunk Brass & Obsidian)
 */
export function createAutomatonTexture(): HTMLCanvasElement {
  const { canvas, ctx } = createPixelCanvas(128, 128);

  // Automaton Head [0, 0], size [8, 8, 8]
  paintBoxUV(ctx, 0, 0, 8, 8, 8, {
    base: '#b45309',
    shade: '#78350f',
    highlight: '#f59e0b',
    front: '#d97706',
  });
  // Glowing amber optical lenses on North face (u=8..16, v=8..16)
  ctx.fillStyle = '#1c1917';
  ctx.fillRect(9, 10, 6, 3);
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(10, 11, 1, 1);
  ctx.fillRect(13, 11, 2, 2);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(13, 11, 1, 1);

  // Top Hat [32, 0], size [8, 5, 8]
  paintBoxUV(ctx, 32, 0, 8, 5, 8, {
    base: '#292524',
    shade: '#0c0a09',
    highlight: '#57534e',
    accent: '#d97706',
  });

  // Boiler Chassis Torso [0, 20], size [10, 11, 6]
  paintBoxUV(ctx, 0, 20, 10, 11, 6, {
    base: '#44403c',
    shade: '#292524',
    highlight: '#78716c',
    front: '#57534e',
  });
  // Brass pressure gauge on front (u=6..16, v=26..37)
  ctx.fillStyle = '#d97706';
  ctx.fillRect(8, 28, 6, 6);
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(9, 29, 4, 4);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(11, 30, 1, 2);

  // Brass Piston Arms [36, 20], size [4, 11, 4]
  paintBoxUV(ctx, 36, 20, 4, 11, 4, {
    base: '#b45309',
    shade: '#78350f',
    highlight: '#fbbf24',
    accent: '#292524',
  });

  // Heavy Mechanical Legs [56, 20], size [4, 11, 4]
  paintBoxUV(ctx, 56, 20, 4, 11, 4, {
    base: '#292524',
    shade: '#1c1917',
    highlight: '#57534e',
    accent: '#d97706',
  });

  // Clockwork Gears [0, 50], size [8, 8, 2]
  paintBoxUV(ctx, 0, 50, 8, 8, 2, {
    base: '#f59e0b',
    shade: '#b45309',
    highlight: '#fde68a',
  });
  // Center gear cutout illusion
  ctx.fillStyle = '#451a03';
  ctx.fillRect(5, 55, 2, 2);

  // Hammer / Wrench [28, 50], size [3, 12, 3]
  paintBoxUV(ctx, 28, 50, 3, 12, 3, {
    base: '#78716c',
    shade: '#44403c',
    highlight: '#d6d3d1',
    accent: '#f59e0b',
  });

  return canvas;
}

/**
 * Encodes an HTMLCanvasElement into raw PNG bytes (`Uint8Array`) for Zip export.
 */
export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode canvas to PNG'));
    }, 'image/png');
  });
  return new Uint8Array(await blob.arrayBuffer());
}
