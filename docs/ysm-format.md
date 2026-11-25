# YSM archive support

`YsmModelLoader.load(file)` reads YSGP `.ysm` files directly in browsers and Node.
No parser registration, native library, server, or file upload is required.
ZIP archives named `.ysm` continue to work, and `registerArchiveParser()` parsers
retain priority over the built-in reader.

The built-in decoder supports crypto version 3 and binary formats 16–32. It
checks the file's CityHash64 signature, processes the modified XChaCha and
MT19937-64 streams, restores the YSM Zstandard block headers, and decodes the
resource records. Unsupported versions and malformed files fail with an explicit
error before rendering.

Geometry keeps the compiled quad positions, normals, and per-vertex UVs. Cube
rotations already baked into the vertices are preserved. Bone pivots and bind
rotations are converted back into the engine's Bedrock coordinates. Animation
times are converted from ticks to seconds; pre/post keys, Catmull-Rom keys,
loop modes, texture ordering, and model proportions are retained. PNG and other
browser-supported encoded images are passed through; raw RGBA is encoded as PNG.

`pre_parallel0`–`pre_parallel7` and `parallel0`–`parallel7` are started as background
layers, keeping model visibility and secondary animation active when the main
clip changes. `stopAll()` and `resetPose()` also stop these layers.
When first-person and main player animation files define the same clip name,
the main player definition takes priority.

Animation expressions can read `ysm.bone_rot('BoneName').x` (also `.y`/`.z`).
These values use Bedrock degrees and include the bone's bind rotation. Reads
observe the last pose applied to the rig, keeping self-references consistent
throughout a frame. Bone names are case-sensitive. Standalone evaluator callers
can supply the optional `readBoneRotation` callback in their evaluation context.

Invalid expressions in imported animation values are replaced per scalar:
rotation and position use `0`, scale and blend weight use `1`. Other axes and
clips keep their original behavior. Import notices include the affected clip and
bone; `model.controller.getExpressionWarnings()` returns the expression, channel,
axis, keyframe time, fallback, and compiler error. Identical pre/post errors at
the same keyframe are reported once. Direct `MolangEvaluator.compile()` and
interactive evaluation still report invalid syntax as errors.

The archive reader preserves controller, function, sound, language, sub-entity,
and auxiliary image resources in its virtual filesystem. This viewer does not
execute Minecraft event functions, controller state machines, or sound events,
and does not instantiate vehicle or projectile entities. PBR auxiliary maps are
preserved as resources; the player uses its selected diffuse texture.

The repository's synthetic fixtures cover crypto and formats 26/32 independently
of local assets. The original `枫璃_1.6.ysm` is used for local integration checks
and is not distributed in the repository. See [third-party notices](../THIRD_PARTY_NOTICES.md)
for the pinned OpenYSM source and license.
