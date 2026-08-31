export function isAllowedRendererUrl(
  url: string,
  devServerUrl?: string,
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

export function resolveRendererDevServerUrl(
  isPackaged: boolean,
  candidate: string | undefined,
): string | undefined {
  if (isPackaged || !candidate) {
    return undefined;
  }

  try {
    const parsed = new URL(candidate);
    const protocolOk = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const hostOk = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (!protocolOk || !hostOk || parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function isPackagedRendererIndex(pathname: string): boolean {
  const normalized = decodeURIComponent(pathname).replace(/\\/g, '/');
  return (
    normalized.endsWith('/out/renderer/index.html') ||
    /(?:^|\/)[^/]+\.asar\/(?:out\/)?renderer\/index\.html$/.test(normalized)
  );
}
