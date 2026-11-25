# YSGP crypto-3 fixtures

`ysgp-crypto3.json` contains synthetic archives and expected clear payloads for
binary formats 26 and 32. They contain one quad, a 2×2 RGBA image, metadata,
language/function/sound records, and animation keys with pre/post discontinuity,
Catmull-Rom interpolation, an infinite clip duration, and duplicate main/first-person
parallel clip names. The large fixture has 20,000 deterministic pseudorandom bytes
to exercise chunk-dependent ChaCha state changes and multiple MT19937 twists.

Payloads were compressed with Node's standard Zstandard compressor. The Zstandard
block headers were transformed to YSM's layout, then the containers were encrypted
with the unmodified `CityHash.java`, `MT19937.java`, `ChaCha20Base.java` and
`XChaCha20.java` from OpenYSM commit `a515d44686af77155a311b2a592327ca5d45a658`.
The fixed key/nonce contains the bytes 0 through 55; payload padding is 16 bytes.

Expected CityHash test vectors use `byte[i] = (i * 37 + 11) & 255` and seed
`0x9e5599db80c67c29`, calculated with the upstream Java implementation.

No downloaded character model assets are included. See the repository's
[third-party notices](../../../../THIRD_PARTY_NOTICES.md) for OpenYSM's MIT license.
