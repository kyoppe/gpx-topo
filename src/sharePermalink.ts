const APP_URL = 'https://gpx-topo.pages.dev/';

export function shareTextWithPermalink(text: string, permalink: string) {
  const replaced = text.replace(APP_URL, permalink);
  return replaced === text ? `${text}\n${permalink}` : replaced;
}
