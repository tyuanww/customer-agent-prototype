import { app, clipboard, nativeImage } from 'electron';
import { readFileSync } from 'node:fs';
import {
  writeSopClipboard,
  type SopClipboardPayload,
} from '../../src/shared/sop-pipeline.js';

const PNG = readFileSync('fox-head.png');

async function run(): Promise<void> {
  await app.whenReady();
  const imagePayload: SopClipboardPayload = {
    text: '合成图文话术',
    html: '<div>合成图文话术</div><img src="data:image/png;base64,AAAA">',
    images: [{ mediaId: 'med-native', mime: 'image/png', bytes: PNG }],
  };
  clipboard.clear();
  writeSopClipboard(
    { write: (data) => clipboard.write(data as Parameters<typeof clipboard.write>[0]) },
    (bytes) => {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes), { scaleFactor: 1 });
      return image.isEmpty() ? null : image;
    },
    imagePayload,
  );
  const withImage = {
    text: clipboard.readText(),
    htmlHasImage: /<img\b/iu.test(clipboard.readHTML()),
    imageEmpty: clipboard.readImage().isEmpty(),
    imageSize: clipboard.readImage().getSize(),
  };

  const textPayload: SopClipboardPayload = {
    text: '合成纯文字话术',
    html: '<div>合成纯文字话术</div>',
    images: [],
  };
  writeSopClipboard(
    { write: (data) => clipboard.write(data as Parameters<typeof clipboard.write>[0]) },
    () => {
      throw new Error('text-only copy must not create an image');
    },
    textPayload,
  );
  const textOnly = {
    text: clipboard.readText(),
    imageEmpty: clipboard.readImage().isEmpty(),
  };
  process.stdout.write(`SOP_CLIPBOARD_RESULT=${JSON.stringify({ withImage, textOnly })}\n`);
  app.quit();
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  app.exit(1);
});
