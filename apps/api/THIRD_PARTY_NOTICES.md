# JPEG decoder notices

These notices cover the identified components of the SOP JPEG decoder. They are not a complete inventory of API dependencies.

## Cornerstone codecs

The API uses `@cornerstonejs/codec-libjpeg-turbo-8bit` version `1.2.8`. Its npm metadata declares ISC and does not include a license file. The [corresponding source commit](https://github.com/cornerstonejs/codecs/tree/841110c6b1ac9ac64aaf3be4f1d344ee2433160b) provides the [MIT license](third-party-licenses/cornerstone-codecs-root-MIT.txt). This package-level discrepancy remains unresolved. Including the source license does not resolve it.

## libjpeg-turbo

The corresponding build links TurboJPEG from [libjpeg-turbo commit c85e6b905bf237038faa936dab160ebfc5da0344](https://github.com/cornerstonejs/libjpeg-turbo/tree/c85e6b905bf237038faa936dab160ebfc5da0344). Its [license](third-party-licenses/libjpeg-turbo/LICENSE.md) and [IJG README](third-party-licenses/libjpeg-turbo/README.ijg) are included unchanged.

This software is based in part on the work of the Independent JPEG Group.

## Build runtime

The corresponding build uses Emscripten 3.1.74. Its [license](third-party-licenses/emscripten-3.1.74-LICENSE.txt) and [musl copyright notice](third-party-licenses/emscripten-3.1.74-musl-COPYRIGHT.txt) are included unchanged. The full set of toolchain components linked into the published WASM has not been established.
