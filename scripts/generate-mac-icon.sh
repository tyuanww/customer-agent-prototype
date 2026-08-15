#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOURCE_ICON="$PROJECT_DIR/fox-head.png"
OUTPUT_ICON="$PROJECT_DIR/build/icon.icns"
ICONSET_DIR=$(mktemp -d "${TMPDIR:-/tmp}/customer-agent-icon.XXXXXX")

cleanup() {
  rm -rf "$ICONSET_DIR"
}
trap cleanup EXIT INT TERM

if [ "$(uname -s)" != "Darwin" ]; then
  echo "macOS 图标只能在 macOS 上生成。" >&2
  exit 1
fi

if [ ! -f "$SOURCE_ICON" ]; then
  echo "缺少狐狸图标源文件：$SOURCE_ICON" >&2
  exit 1
fi

ICONSET_PATH="$ICONSET_DIR/CustomerAgent.iconset"
mkdir -p "$ICONSET_PATH" "$(dirname "$OUTPUT_ICON")"

make_icon() {
  size="$1"
  filename="$2"
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICONSET_PATH/$filename" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
make_icon 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET_PATH" -o "$OUTPUT_ICON"
echo "已生成 macOS 应用图标：$OUTPUT_ICON"
