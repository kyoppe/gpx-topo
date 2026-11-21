type PagesContext = {
  params: { path?: string | string[] };
};

export async function onRequest(context: PagesContext & { request: Request }) {
  const rawPath = context.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join('/') : rawPath ?? '';
  if (!/^(std|pale|hillshademap|dem|dem_png|dem1a_png|dem5a_png|dem5b_png|dem5c_png)\/\d+\/\d+\/\d+\.(png|txt)$/.test(path)) {
    return new Response('Invalid GSI tile path.', { status: 400 });
  }

  const upstream = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${path}`, {
    headers: { accept: context.request.headers.get('accept') ?? '*/*' },
    cf: {
      cacheEverything: true,
      cacheTtl: 86_400,
    },
  });
  if (!upstream.ok) {
    return new Response('GSI tile unavailable.', { status: upstream.status });
  }

  const headers = new Headers(upstream.headers);
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('access-control-allow-origin', '*');
  return new Response(upstream.body, { status: upstream.status, headers });
}
