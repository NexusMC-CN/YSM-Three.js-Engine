# Third-party notices

## OpenYSM

The YSGP crypto-3 decoder and modern binary layout reader in `src/lib/loader/ysm/`
are adapted from [OpenYSM](https://github.com/OpenYSM/OpenYSM), commit
`a515d44686af77155a311b2a592327ca5d45a658`:

- `rip/ysm/algorithms/CityHash.java`
- `rip/ysm/algorithms/MT19937.java`
- `rip/ysm/algorithms/ChaCha20Base.java` and `XChaCha20.java`
- `rip/ysm/algorithms/YsmZstd.java`
- `rip/ysm/security/YsmCrypt.java` and `YSMByteBuf.java`
- `com/elfmcys/yesstevemodel/resource/YSMBinaryDeserializer.java`,
  `YSMFolderDeserializer.java`, and `YSMClientMapper.java`

Synthetic crypto fixtures were encrypted with the upstream Java algorithms.
They contain no downloaded model assets. No Minecraft runtime or native library
is required by this implementation.

The MIT License (MIT)

Copyright (c) 2026 OpenYSM

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## fzstd

Zstandard decompression uses [fzstd](https://github.com/101arrowz/fzstd),
distributed under its MIT license in `node_modules/fzstd/LICENSE`.

MIT License

Copyright (c) 2020 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
