const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

const KNOWN_OPENAI_ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/images/generations',
  '/models',
];

function stripKnownEndpoint(pathname: string): string {
  let normalizedPath = pathname.replace(/\/+$/, '');
  const lowerPath = normalizedPath.toLowerCase();

  for (const suffix of KNOWN_OPENAI_ENDPOINT_SUFFIXES) {
    if (lowerPath.endsWith(suffix)) {
      normalizedPath = normalizedPath.slice(0, -suffix.length).replace(/\/+$/, '');
      break;
    }
  }

  return normalizedPath;
}

function normalizePathname(pathname: string): string {
  let normalizedPath = stripKnownEndpoint(pathname);
  const segments = normalizedPath.split('/').filter(Boolean);
  let versionIndex = -1;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (/^v\d+(?:beta)?$/i.test(segments[index])) {
      versionIndex = index;
      break;
    }
  }

  if (versionIndex >= 0) {
    return `/${segments.slice(0, versionIndex + 1).join('/')}`;
  }

  return `${normalizedPath || ''}/v1`;
}

export function normalizeOpenAIBaseUrl(
  baseUrl?: string | null,
  defaultUrl: string = DEFAULT_OPENAI_BASE_URL
): string {
  const fallback = (defaultUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  const rawUrl = (baseUrl || fallback).trim().replace(/\/+$/, '') || fallback;

  try {
    const parsed = new URL(rawUrl);
    parsed.pathname = normalizePathname(parsed.pathname);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    const withoutEndpoint = stripKnownEndpoint(rawUrl);
    const versionMatch = withoutEndpoint.match(/^(.*?\/v\d+(?:beta)?)(?:\/.*)?$/i);
    if (versionMatch) return versionMatch[1].replace(/\/+$/, '');
    return `${withoutEndpoint.replace(/\/+$/, '')}/v1`;
  }
}

export function buildOpenAIEndpoint(
  baseUrl: string | null | undefined,
  endpoint: string,
  defaultUrl: string = DEFAULT_OPENAI_BASE_URL
): string {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${normalizeOpenAIBaseUrl(baseUrl, defaultUrl)}${normalizedEndpoint}`;
}
