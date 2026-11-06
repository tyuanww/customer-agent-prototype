import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  extractWpsDisplayImages,
  wpsDisplayImageId,
  type WpsImageCoordinate,
} from '@customer-agent/content-intake';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN5EAAAAASUVORK5CYII=',
  'base64',
);

const coordinate: WpsImageCoordinate = {
  sheet: 'SOP资源',
  row: 2,
  column: 'D',
  formula: '=DISPIMG("ID_IMAGE_1",1)',
};

async function wpsZip(options: {
  bytes?: Buffer;
  external?: boolean;
  missingRelationship?: boolean;
} = {}): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('xl/cellimages.xml', `<?xml version="1.0" encoding="UTF-8"?>
<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData"
 xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <etc:cellImage>
    <xdr:pic>
      <xdr:nvPicPr><xdr:cNvPr id="1" name="ID_IMAGE_1" descr="合成图片"/></xdr:nvPicPr>
      <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
    </xdr:pic>
  </etc:cellImage>
</etc:cellImages>`);
  zip.file('xl/_rels/cellimages.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="${options.external ? 'https://synthetic.example/image.png' : 'media/synthetic.png'}"
    ${options.external ? 'TargetMode="External"' : ''}/>
</Relationships>`);
  if (!options.missingRelationship) zip.file('xl/media/synthetic.png', options.bytes ?? PNG);
  return zip;
}

describe('WPS DISPIMG adapter', () => {
  it('extracts a safe internal PNG with stable media identity', async () => {
    expect(wpsDisplayImageId('=DISPIMG("ID_IMAGE_1",1)')).toBe('ID_IMAGE_1');
    const result = await extractWpsDisplayImages(await wpsZip(), [coordinate]);
    expect(result.issues).toEqual([]);
    expect(result.items).toEqual([
      expect.objectContaining({
        sheet: 'SOP资源',
        row: 2,
        column: 'D',
        mime: 'image/png',
        bytes: PNG.length,
      }),
    ]);
  });

  it('fails closed at the originating coordinate for a missing image', async () => {
    const result = await extractWpsDisplayImages(await wpsZip({ missingRelationship: true }), [coordinate]);
    expect(result.items).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'WPS_IMAGE_MISSING',
      sheet: 'SOP资源',
      row: 2,
      column: 'D',
    }));
  });

  it('rejects corrupt media and external relationships without returning partial data', async () => {
    const corrupt = await extractWpsDisplayImages(await wpsZip({ bytes: Buffer.from('not-an-image') }), [coordinate]);
    expect(corrupt.items).toEqual([]);
    expect(corrupt.issues).toContainEqual(expect.objectContaining({ code: 'WPS_IMAGE_FORMAT' }));

    const external = await extractWpsDisplayImages(await wpsZip({ external: true }), [coordinate]);
    expect(external.items).toEqual([]);
    expect(external.issues).toContainEqual(expect.objectContaining({ code: 'WPS_IMAGE_RESPONSE_INVALID' }));
  });

  it('enforces the per-image and aggregate image budgets', async () => {
    const oversized = await extractWpsDisplayImages(
      await wpsZip({ bytes: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]) }),
      [coordinate],
    );
    expect(oversized.items).toEqual([]);
    expect(oversized.issues).toContainEqual(expect.objectContaining({ code: 'WPS_MEDIA_LIMIT' }));
  });
});
