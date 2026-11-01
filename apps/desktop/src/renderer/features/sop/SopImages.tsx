import { Typography } from 'antd';
import { useState } from 'react';
import type { SopImage } from '@shared/sop-window';

function SopImageView({ image }: { image: SopImage }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === image.dataUrl;
  return <figure className="sop-image" role="none">
    {failed ? <Typography.Text type="secondary" role="status">图片无法显示</Typography.Text> : <img src={image.dataUrl} alt={image.alt} onError={() => setFailedSource(image.dataUrl)} />}
    <figcaption aria-hidden={failed ? undefined : true}>{image.alt}</figcaption>
  </figure>;
}

export function SopImages({ images }: { images: readonly SopImage[] }) {
  if (!images.length) return null;
  // The projection preserves placement order; a resource may appear more than once.
  return <div className="sop-images">{images.map((image, index) => <SopImageView key={index} image={image} />)}</div>;
}
