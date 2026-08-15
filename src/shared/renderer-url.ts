export function isAllowedRendererUrl(
  url: string,
  devServerUrl: string | undefined = process.env.ELECTRON_RENDERER_URL,
): boolean {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      return isPackagedRendererIndex(parsed.pathname);
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (!devServerUrl) {
        return false;
      }
      const hostOk = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      if (!hostOk) {
        return false;
      }
      const dev = new URL(devServerUrl);
      return parsed.host === dev.host;
    }

    return false;
  } catch {
    return false;
  }
}

function isPackagedRendererIndex(pathname: string): boolean {
  const normalized = decodeURIComponent(pathname).replace(/\\/g, '/');
  return (
    normalized.endsWith('/out/renderer/index.html') ||
    /(?:^|\/)[^/]+\.asar\/(?:out\/)?renderer\/index\.html$/.test(normalized)
  );
}
