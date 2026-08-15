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
      return parsed.pathname.endsWith('/renderer/index.html') || parsed.pathname.endsWith('index.html');
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const hostOk = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
      if (!hostOk) {
        return false;
      }
      if (devServerUrl) {
        const dev = new URL(devServerUrl);
        return parsed.host === dev.host;
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
