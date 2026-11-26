import { getCopy, type Language } from './i18n';

export type SiteCopy = {
  navAbout: string;
  navTutorial: string;
  navMap: string;
  heroTitle: string;
  heroLead: string;
  heroButton: string;
  heroTutorial: string;
  aboutCan: string;
  canItems: readonly string[];
  examples: string;
  exampleItems: readonly string[];
  operation: string;
  pointerTitle: string;
  pointerItems: readonly string[];
  touchTitle: string;
  touchItems: readonly string[];
  faq: string;
  faqQuestion: string;
  faqAnswer: string;
  tutorialTitle: string;
  tutorialLead: string;
  tutorialMap: string;
  tutorialGpx: string;
  previous: string;
  next: string;
  restart: string;
  step: (current: number, total: number) => string;
  openMap: string;
  mapMode: string;
  gpxMode: string;
  mapSteps: readonly { title: string; description: string; pointer: string; touch: string; target: string; appMode: 'map' | 'gpx' }[];
  gpxSteps: readonly { title: string; description: string; pointer: string; touch: string; target: string; appMode: 'map' | 'gpx' }[];
  footer: string;
};

const JAPANESE: SiteCopy = {
  navAbout: 'このアプリについて',
  navTutorial: '使い方',
  navMap: '地図を開く',
  heroTitle: '平面地図を、地形模型に起こす。',
  heroLead: '好きな場所を探し、地形を起こし、光の変化やルートを眺めるための地図です。',
  heroButton: '地図を開く',
  heroTutorial: '使い方を見る',
  aboutCan: 'このアプリでできること',
  canItems: [
    '地図を立体的な地形模型として探検する',
    '選んだ場所をズーム、回転、移動して眺める',
    '時刻を変えて、太陽と影の変化を見る',
    'GPXルートを地形の上に重ねる',
    '場所と画角をパーマリンクで共有する',
  ],
  examples: 'こんな使い方ができます',
  exampleItems: [
    '山や街の地形を、いろいろな角度から探検する',
    '山道や街並みを、地形模型として眺める',
    'レースやオリエンテーリングのルートを確認する',
    '同じ場所と画角をパーマリンクで誰かに見せる',
  ],
  operation: '操作方法',
  pointerTitle: 'マウス・トラックパッド',
  pointerItems: ['ドラッグで地形を回転', '右ドラッグ、またはShift+ドラッグで地形を移動', 'ホイールで地図を起こし、ズーム'],
  touchTitle: 'タッチデバイス',
  touchItems: ['Mapモードでは1本指で地図を移動', '立体表示では1本指で地形を回転', '2本指を広げたり縮めたりして、起こす・寝かす・ズーム', '2本指をそろえて動かして地形を移動'],
  faq: 'よくある質問',
  faqQuestion: 'ウェイポイント入りのGPXを作りたい',
  faqAnswer: 'このアプリはGPXデータを3D地形で見たり、ルートを確認したりするためのものです。ウェイポイント入りのGPXを作るときは、GPX Wallpaper Whateverをご利用ください。',
  tutorialTitle: '使い方',
  tutorialLead: '実際の画面を動かしながら、MapモードとGPXモードの操作を順番に確認できます。',
  tutorialMap: 'Mapモード',
  tutorialGpx: 'GPXモード',
  previous: '前へ',
  next: '次へ',
  restart: '最初から',
  step: (current, total) => `${current} / ${total}`,
  openMap: '実際の地図を開く',
  mapMode: 'Map',
  gpxMode: 'GPX',
  mapSteps: [
    { title: '場所を探す', description: '検索欄に住所や地名、座標を入力して、見たい場所を表示します。', pointer: '検索欄に入力して検索', touch: '検索欄に入力して検索', target: 'search', appMode: 'map' },
    { title: '地図を起こす', description: '地図を立体に起こすと、選んだ範囲の地形模型になります。', pointer: '「起こす」を押す、またはホイールを上へ', touch: '「起こす」をタップ、または2本指を広げる', target: 'raise', appMode: 'map' },
    { title: '地形を探検する', description: '立体になった地形を回転、ズーム、移動して眺めます。', pointer: 'ドラッグで回転、右ドラッグで移動', touch: '1本指で回転、2本指をそろえて移動', target: 'terrain', appMode: 'map' },
    { title: '太陽と影を見る', description: '時刻を動かすと、地形に落ちる太陽の光と影が変わります。', pointer: '日照スライダーをドラッグ', touch: '日照スライダーをドラッグ', target: 'sun', appMode: 'map' },
    { title: '画面を共有する', description: 'パーマリンクをコピーすると、同じ場所と画角を共有できます。', pointer: 'パーマリンクボタンを押す', touch: 'パーマリンクボタンをタップ', target: 'permalink', appMode: 'map' },
  ],
  gpxSteps: [
    { title: 'GPXを開く', description: '手元のGPXファイルを開くと、GPXモードに切り替わります。', pointer: '「GPX」を押してファイルを選ぶ', touch: '「GPX」をタップしてファイルを選ぶ', target: 'open', appMode: 'gpx' },
    { title: 'ルートを見る', description: '読み込んだルートが地形の上に表示されます。', pointer: 'ドラッグで回転、右ドラッグで移動', touch: '1本指で回転、2本指で移動', target: 'route', appMode: 'gpx' },
    { title: 'ウェイポイントを見る', description: 'ルートに含まれるウェイポイントを地図上で確認できます。', pointer: 'ウェイポイントの番号を押す', touch: 'ウェイポイントの番号をタップ', target: 'waypoints', appMode: 'gpx' },
    { title: '進み具合を見る', description: '標高プロファイルや経過時間から、ルートの進み具合を確認します。', pointer: 'プロファイルや時刻を操作', touch: 'プロファイルや時刻を操作', target: 'progress', appMode: 'gpx' },
    { title: 'Mapに戻る', description: 'Mapモードへ戻って別の場所を探したり、別のGPXを開いたりできます。', pointer: 'モード切替ボタンを押す', touch: 'モード切替ボタンをタップ', target: 'return', appMode: 'map' },
    { title: '別のGPXを開く', description: 'Mapモードに戻ったら、GPXボタンから別のファイルを開けます。', pointer: '「GPX」を押して別のファイルを選ぶ', touch: '「GPX」をタップして別のファイルを選ぶ', target: 'open', appMode: 'map' },
  ],
  footer: '',
};

const ENGLISH: SiteCopy = {
  ...JAPANESE,
  navAbout: 'About',
  navTutorial: 'Tutorial',
  navMap: 'Open map',
  heroTitle: 'Turn a flat map into a terrain model.',
  heroLead: 'Find a place, raise its terrain, and explore light, shadow, and routes.',
  heroButton: 'Open map',
  heroTutorial: 'View the tutorial',
  aboutCan: 'What you can do',
  canItems: ['Explore maps as 3D terrain models', 'Zoom, rotate, and move around a selected area', 'Change the time to inspect sunlight and shadows', 'Overlay GPX routes on the terrain', 'Share a place and view with a permalink'],
  examples: 'Ways to use it',
  exampleItems: ['Explore the terrain of a mountain or town', 'View terrain from different angles', 'Review a race or orienteering route on the terrain', 'Show someone the same place and view with a permalink'],
  operation: 'Controls',
  pointerTitle: 'Mouse and trackpad',
  pointerItems: ['Drag to rotate the terrain', 'Right-drag, or Shift-drag, to move the terrain', 'Use the wheel to raise the map and zoom'],
  touchTitle: 'Touch device',
  touchItems: ['In Map mode, use one finger to move the map', 'In raised 3D mode, use one finger to rotate the terrain', 'Spread or pinch two fingers to raise, lower, or zoom the terrain', 'Move two fingers together to move the terrain'],
  faq: 'FAQ',
  faqQuestion: 'How can I make a GPX with waypoints?',
  faqAnswer: 'This app is for viewing GPX data on 3D terrain and reviewing routes. To create a GPX file with waypoints, use GPX Wallpaper Whatever.',
  tutorialTitle: 'Tutorial',
  tutorialLead: 'Follow the real application screen through Map mode and GPX mode.',
  tutorialMap: 'Map mode',
  tutorialGpx: 'GPX mode',
  previous: 'Previous',
  next: 'Next',
  restart: 'Restart',
  step: (current, total) => `${current} / ${total}`,
  openMap: 'Open the actual map',
  mapMode: 'Map',
  gpxMode: 'GPX',
  mapSteps: [
    { title: 'Find a place', description: 'Enter an address, place name, or coordinates to show the area you want to see.', pointer: 'Type in the search field and submit', touch: 'Type in the search field and submit', target: 'search', appMode: 'map' },
    { title: 'Raise the map', description: 'Raise the flat map to turn the selected area into a terrain model.', pointer: 'Press “Raise”, or scroll up', touch: 'Tap “Raise”, or spread two fingers', target: 'raise', appMode: 'map' },
    { title: 'Explore the terrain', description: 'Rotate, zoom, and move around the raised terrain.', pointer: 'Drag to rotate; right-drag to move', touch: 'Use one finger to rotate; move two fingers together to move', target: 'terrain', appMode: 'map' },
    { title: 'Inspect sunlight and shadows', description: 'Move the time to see the sunlight and shadows change across the terrain.', pointer: 'Drag the sunlight slider', touch: 'Drag the sunlight slider', target: 'sun', appMode: 'map' },
    { title: 'Share the view', description: 'Copy a permalink to share the same place and view.', pointer: 'Press the permalink button', touch: 'Tap the permalink button', target: 'permalink', appMode: 'map' },
  ],
  gpxSteps: [
    { title: 'Open a GPX', description: 'Open a GPX file to switch to GPX mode.', pointer: 'Press “GPX” and choose a file', touch: 'Tap “GPX” and choose a file', target: 'open', appMode: 'gpx' },
    { title: 'View the route', description: 'The loaded route appears on top of the terrain.', pointer: 'Drag to rotate; right-drag to move', touch: 'Use one finger to rotate; use two fingers to move', target: 'route', appMode: 'gpx' },
    { title: 'View waypoints', description: 'Inspect the waypoints included in the route.', pointer: 'Press a waypoint number', touch: 'Tap a waypoint number', target: 'waypoints', appMode: 'gpx' },
    { title: 'Review progress', description: 'Use the elevation profile and elapsed time to review progress along the route.', pointer: 'Use the profile or time controls', touch: 'Use the profile or time controls', target: 'progress', appMode: 'gpx' },
    { title: 'Return to Map', description: 'Return to Map mode to explore another place.', pointer: 'Press the mode switch', touch: 'Tap the mode switch', target: 'return', appMode: 'map' },
    { title: 'Open another GPX', description: 'Back in Map mode, use the GPX button to open another file.', pointer: 'Press “GPX” and choose another file', touch: 'Tap “GPX” and choose another file', target: 'open', appMode: 'map' },
  ],
  footer: '',
};

export function siteCopy(language: Language): SiteCopy {
  const base = language === 'ja' ? JAPANESE : ENGLISH;
  const appName = getCopy(language).appName;
  return {
    ...base,
    faqAnswer:
      language === 'ja'
        ? `このアプリはGPXデータを3D地形で見たり、ルートを確認したりするためのものです。ウェイポイント入りのGPXを作るときは、GPX Wallpaper Whateverをご利用ください。`
        : 'This app is for viewing GPX data on 3D terrain and reviewing routes. To create a GPX file with waypoints, use GPX Wallpaper Whatever.',
    footer: appName,
  };
}
