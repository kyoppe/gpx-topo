import { getCopy, type Language } from './i18n';

export type SiteStep = {
    title: string;
    description: string;
    pointer: string;
    touch: string;
    target: string;
    appMode: 'map' | 'gpx';
    /** how the same step reads on the fallback screen, where it differs */
    fallback?: { pointer: string; touch: string };
    /** a step that only the native screen has anything to say about */
    nativeOnly?: boolean;
};

export type SiteCopy = {
  navAbout: string;
  navTutorial: string;
  navMap: string;
  heroTitle: string;
  heroLead: string;
  heroCredits: readonly string[];
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
  faqLinkLabel: string;
  faqViewQuestion: string;
  faqViewAnswer: string;
  faqViewLinkLabel: string;
  creatorTitle: string;
  creatorName: string;
  mapCredit: string;
  mapCreditPale: string;
  tutorialTitle: string;
  tutorialLead: string;
  tutorialMap: string;
  tutorialGpx: string;
  tutorialSheetFirst: (tab: string) => string;
  /** the settings-panel tab each panel step works in, as the tab is labelled on a narrow screen */
  /** added to the pin step: where the pin gets its name, beside the map or in the bottom sheet */
  tutorialPinName: (sheet: boolean) => string;
  tutorialTabs: Readonly<Record<string, string>>;
  previous: string;
  next: string;
  restart: string;
  step: (current: number, total: number) => string;
  openMap: string;
  mapMode: string;
  gpxMode: string;
  mapSteps: readonly SiteStep[];
  gpxSteps: readonly SiteStep[];
  footer: string;
};

const JAPANESE: SiteCopy = {
  navAbout: 'このアプリについて',
  navTutorial: '使い方',
  navMap: '地図を開く',
  mapCredit: '背景：地理院タイル（白地図）',
  mapCreditPale: '背景：地理院タイル（淡色地図）',
  heroTitle: '地図が、むくっと立ち上がる。',
  heroLead: '好きな場所で地形を起こし、起伏やルート、光の変化を様々な角度から眺めるための地図です。',
  heroCredits: ['地図が、むくっと立ち上がる。', '好きな場所を、\nズームや回転で探検する。', '時刻を動かして、\n太陽と影の変化を見る。', 'GPXを重ねれば、\nルートも地形の上に表示できる。'],
  heroButton: '地図を開く',
  heroTutorial: '使い方を見る',
  aboutCan: 'このアプリでできること',
  canItems: [
    '地図を立体的な地形模型にして探検する',
    '場所を探して、現在地やピンで位置を確かめ、ズーム・回転・移動で眺める',
    '標準・淡色・白地図・写真など、地図の種類を切り替える',
    '時刻と日付を変えて、太陽と影の変化を見る',
    'GPXルートを重ねて、ウェイポイント、標高、経過時間を確認する',
    '空撮の動きやFPV、Flyoverで、地形の上を飛ぶように眺める',
    '画像や動画に残し、パーマリンクで共有する',
  ],
  examples: 'こんな使い方ができます',
  exampleItems: [
    '山の地形を、いろいろな角度から探検する',
    '登山の前に、ルートの起伏を確かめる',
    'レースのルートを、時間の経過と日の出・日没に合わせて確認する',
    'オリエンテーリングのレース後の振り返りに使う',
    '朝日や夕日が当たる時間を確かめる',
    '歩いたルートを、地形の上で見返して思い出にする',
    '今いる場所のまわりの地形を確かめる',
  ],
  operation: '操作方法',
  pointerTitle: 'マウス・トラックパッド',
  pointerItems: ['ドラッグで地形を回転', '右ドラッグ、またはShift+ドラッグで地形を移動', 'ホイールで地図を起こし、ズーム'],
  touchTitle: 'タッチデバイス',
  touchItems: ['Mapモードでは1本指で地図を移動', '立体表示では1本指で地形を回転', '2本指を広げたり縮めたりして、起こす・寝かす・ズーム', '2本指をそろえて動かして地形を移動'],
  faq: 'よくある質問',
  faqQuestion: 'ウェイポイント入りのGPXを作りたい',
  faqAnswer: 'このアプリは、GPXデータを3D地形で見たり、ルートを確認したりするためのものです。ウェイポイント入りのGPXを作りたいときは、次のアプリをご利用ください。',
  faqLinkLabel: 'GPX壁紙なんちゃら',
  faqViewQuestion: 'PCとスマホで見た目が違うのはなぜですか？',
  faqViewAnswer:
    'このアプリは、HTML-in-Canvas という新しいブラウザ機能を使った実験的な作りです。対応しているブラウザでは、操作パネルやボタンまで、3Dの地形模型と同じ画面の中に描かれます。対応していない環境では、地形は同じように3Dで表示しつつ、操作パネルやボタンは地形の横に並ぶ通常の画面として表示します。見た目が違うのは対応状況が違うためで、地図を見る、GPXを開くといった機能は同じです。',
  faqViewLinkLabel: 'HTML-in-Canvas（WICG）',
  creatorTitle: '作った人',
  creatorName: 'キョウヘイ',
  tutorialTitle: '使い方',
  tutorialLead: '実際の画面を動かしながら、MapモードとGPXモードの操作を順番に確認できます。',
  tutorialMap: 'Mapモード',
  tutorialGpx: 'GPXモード',
  tutorialSheetFirst: (tab) => `下の「つまみ」をタップするか上へ引いてパネルを開き、「${tab}」タブで、`,
  tutorialPinName: (sheet) => (sheet ? '立てたピンには、下の「つまみ」をタップするか上へ引いてパネルを開き、「ピン」タブで名前を付けられます。' : '立てたピンには、横のパネルで名前を付けられます。'),
  tutorialTabs: { search: '検索', sun: '日照', progress: 'ルート', waypoints: 'ウェイポイント' },
  previous: '前へ',
  next: '次へ',
  restart: '最初から',
  step: (current, total) => `${current} / ${total}`,
  openMap: '実際の地図を開く',
  mapMode: 'Map',
  gpxMode: 'GPX',
  mapSteps: [
    { title: '場所を探す', description: '検索欄に住所、地名、座標、GoogleマップのURLのどれかを入力して、見たい場所を表示します。', pointer: '例：「富士山」「35.36, 138.73」', touch: '例：「富士山」「35.36, 138.73」', target: 'search', appMode: 'map' },
    { title: '地図を起こす', description: '地図を立体に起こすと、選んだ範囲の地形模型になります。', pointer: '「起こす」を押す、またはホイールを上へ', touch: '「起こす」をタップ、または2本指を広げる', target: 'raise', appMode: 'map' },
    { title: '地形を探検する', description: '立体になった地形を回転、ズーム、移動して眺めます。', pointer: 'ドラッグで回転、右ドラッグで移動', touch: '1本指で回転、2本指をそろえて移動', target: 'terrain', appMode: 'map' },
    { title: '太陽と影を見る', description: '時刻を動かすと、地形に落ちる太陽の光と影が変わります。', pointer: '日照スライダーをドラッグ', touch: '日照スライダーをドラッグ', target: 'sun', appMode: 'map' },
    { title: 'ピンを立てる', description: 'ピンのボタンを押してから地図を選ぶと、その場所に目印のピンを立てられます。', pointer: 'ピンを押して、地図をクリック', touch: 'ピンをタップして、地図をタップ', target: 'pin', appMode: 'map' },
    { title: '現在地を見る', description: '現在地ボタンを押すと、いまいる場所を地図に表示します。位置情報の許可が必要です。', pointer: '現在地ボタンを押す', touch: '現在地ボタンをタップ', target: 'location', appMode: 'map' },
    { title: '空撮で眺める', description: '空撮ボタンから動きを選び、地形上の地点を選ぶと、カメラがその地点を中心に決まった動きで撮影します。', pointer: '空撮ボタンを押して動きを選ぶ', touch: '空撮ボタンをタップして動きを選ぶ', target: 'maneuver', appMode: 'map' },
    { title: '画面を共有する', description: 'パーマリンクをコピーすると、同じ場所と画角を共有できます。', pointer: 'パーマリンクボタンを押す', touch: 'パーマリンクボタンをタップ', target: 'permalink', appMode: 'map' },
    { title: '画像にする', description: 'いま見ている画面を、画像にして残します。', pointer: 'カメラボタンを押して、「保存」か「画像をコピー」', touch: 'カメラボタンをタップして、「保存」か「画像をコピー」', target: 'camera', appMode: 'map', fallback: { pointer: 'カメラボタンを押して、「共有」か「保存」', touch: 'カメラボタンをタップして、「共有 / 保存」' } },
    { title: '画面を録画する', description: '地形を回したり、空撮の動きを撮ったりした画面を、動画にして残します。', pointer: 'ビデオボタンを押して録画し、もう一度押して止める', touch: 'ビデオボタンをタップして録画し、もう一度タップして止める', target: 'video', appMode: 'map', fallback: { pointer: 'ビデオボタンを押して録画し、もう一度押して止めて、「共有」か「保存」', touch: 'ビデオボタンをタップして録画し、もう一度タップして止めて、「共有 / 保存」' } },
    { title: '撮ったものを共有する', description: '撮った画像は「画像をコピー」でコピーして、投稿先に貼り付けられます。撮ったあとに出るXボタンからは、そのまま投稿もできます。', pointer: '「画像をコピー」して貼り付ける、またはXボタンで投稿', touch: '「画像をコピー」して貼り付ける、またはXボタンで投稿', target: 'share', appMode: 'map', nativeOnly: true },
  ],
  gpxSteps: [
    { title: 'GPXを開く', description: '手元のGPXファイルを開くと、GPXモードに切り替わります。', pointer: '「GPX」を押してファイルを選ぶ', touch: '「GPX」をタップしてファイルを選ぶ', target: 'open-map', appMode: 'map' },
    { title: 'ルートを見る', description: '読み込んだルートが地形の上に表示されます。', pointer: 'ドラッグで回転、右ドラッグで移動', touch: '1本指で回転、2本指で移動', target: 'route', appMode: 'gpx' },
    { title: 'ウェイポイントを見る', description: 'ルートに含まれるウェイポイントを、一覧と地図の上で確認できます。', pointer: 'ウェイポイントの番号を押す', touch: 'ウェイポイントの番号をタップ', target: 'waypoints', appMode: 'gpx' },
    { title: '進み具合を見る', description: '標高プロファイルや経過時間から、ルートの進み具合を確認します。', pointer: 'プロファイルや時刻を操作', touch: 'プロファイルや時刻を操作', target: 'progress', appMode: 'gpx' },
    { title: 'Flyoverでルートを飛ぶ', description: 'Flyoverを再生すると、カメラがルートに沿って地形の上を進みます。', pointer: '▶ボタンを押す', touch: '▶ボタンをタップ', target: 'flyover', appMode: 'gpx' },
    { title: 'Mapに戻る', description: 'Mapモードへ戻って別の場所を探したり、別のGPXを開いたりできます。', pointer: 'モード切替ボタンを押す', touch: 'モード切替ボタンをタップ', target: 'return', appMode: 'map' },
    { title: '別のGPXを開く', description: 'Mapモードに戻ったら、GPXボタンから別のファイルを開けます。', pointer: '「GPX」を押して別のファイルを選ぶ', touch: '「GPX」をタップして別のファイルを選ぶ', target: 'open-map', appMode: 'map' },
  ],
  footer: '',
};

const ENGLISH: SiteCopy = {
  ...JAPANESE,
  navAbout: 'About',
  navTutorial: 'Tutorial',
  navMap: 'Open map',
  mapCredit: 'Background: GSI Japan blank map',
  mapCreditPale: 'Background: GSI Japan pale map',
  heroTitle: 'The map suddenly stands up.',
  heroLead: 'Raise the terrain of any place, and look over its relief, routes, and changing light from every angle.',
  heroCredits: ['The map suddenly stands up.', 'Explore a place with\nzoom and rotation.', 'Change the time to inspect\nsunlight and shadows.', 'Overlay a GPX route\non the terrain.'],
  heroButton: 'Open map',
  heroTutorial: 'View the tutorial',
  aboutCan: 'What you can do',
  canItems: [
    'Explore maps as 3D terrain models',
    'Find a place, check it with your location or a pin, then zoom, rotate, and move around it',
    'Switch the map type: standard, pale, blank, or aerial photo',
    'Change the time and date to inspect sunlight and shadows',
    'Overlay a GPX route and check its waypoints, elevation, and elapsed time',
    'Look over the terrain with aerial moves, a first-person view, or Flyover',
    'Keep it as an image or a video, and share it with a permalink',
  ],
  examples: 'Ways to use it',
  exampleItems: [
    'Explore the terrain of a mountain from different angles',
    'Check the ups and downs of a route before a hike',
    'Review a race route against the time of day, sunrise, and sunset',
    'Use it to look back on an orienteering race afterwards',
    'Check when the morning or evening sun reaches a place',
    'Look back on a route you walked, on top of the terrain, as a keepsake',
    'Check the terrain around where you are',
  ],
  operation: 'Controls',
  pointerTitle: 'Mouse and trackpad',
  pointerItems: ['Drag to rotate the terrain', 'Right-drag, or Shift-drag, to move the terrain', 'Use the wheel to raise the map and zoom'],
  touchTitle: 'Touch device',
  touchItems: ['In Map mode, use one finger to move the map', 'In raised 3D mode, use one finger to rotate the terrain', 'Spread or pinch two fingers to raise, lower, or zoom the terrain', 'Move two fingers together to move the terrain'],
  faq: 'FAQ',
  faqQuestion: 'How can I make a GPX with waypoints?',
  faqAnswer: 'This app is for viewing GPX data on 3D terrain and reviewing routes. To create a GPX file with waypoints, use the app below.',
  faqLinkLabel: 'GPX Wallpaper Whatever',
  faqViewQuestion: 'Why does the page look different on a PC and on a phone?',
  faqViewAnswer:
    'This app is an experiment with HTML-in-Canvas, a new browser feature. In a browser that supports it, even the controls and buttons are drawn on the same screen as the 3D terrain model. Elsewhere, the terrain is still shown in 3D, and the controls and buttons are ordinary screens set beside it. The look differs only because support differs; viewing the map and opening a GPX file work the same.',
  faqViewLinkLabel: 'HTML-in-Canvas (WICG)',
  creatorTitle: 'Made by',
  creatorName: 'Kyouhei',
  tutorialTitle: 'Tutorial',
  tutorialLead: 'Follow the real application screen through Map mode and GPX mode.',
  tutorialMap: 'Map mode',
  tutorialGpx: 'GPX mode',
  tutorialSheetFirst: (tab) => `Tap the handle at the bottom or pull it up to open the panel, then in the “${tab}” tab, `,
  tutorialPinName: (sheet) => (sheet ? 'Tap the handle at the bottom or pull it up to open the panel, then name the pin in the “Pin” tab.' : 'Name the pin in the panel beside the map.'),
  tutorialTabs: { search: 'Search', sun: 'Sunlight', progress: 'Route', waypoints: 'Waypoints' },
  previous: 'Previous',
  next: 'Next',
  restart: 'Restart',
  step: (current, total) => `${current} / ${total}`,
  openMap: 'Open the actual map',
  mapMode: 'Map',
  gpxMode: 'GPX',
  mapSteps: [
    { title: 'Find a place', description: 'Enter an address, place name, coordinates, or a Google Maps URL in the search field to show the area you want to see.', pointer: 'Example: “Mt. Fuji” or “35.36, 138.73”', touch: 'Example: “Mt. Fuji” or “35.36, 138.73”', target: 'search', appMode: 'map' },
    { title: 'Raise the map', description: 'Raise the flat map to turn the selected area into a terrain model.', pointer: 'Press “Raise”, or scroll up', touch: 'Tap “Raise”, or spread two fingers', target: 'raise', appMode: 'map' },
    { title: 'Explore the terrain', description: 'Rotate, zoom, and move around the raised terrain.', pointer: 'Drag to rotate; right-drag to move', touch: 'Use one finger to rotate; move two fingers together to move', target: 'terrain', appMode: 'map' },
    { title: 'Inspect sunlight and shadows', description: 'Move the time to see the sunlight and shadows change across the terrain.', pointer: 'Drag the sunlight slider', touch: 'Drag the sunlight slider', target: 'sun', appMode: 'map' },
    { title: 'Drop a pin', description: 'Press the pin button, then choose a spot on the map to drop a pin there.', pointer: 'Press the pin, then click the map', touch: 'Tap the pin, then tap the map', target: 'pin', appMode: 'map' },
    { title: 'Show your location', description: 'Press the location button to show where you are on the map. Location access must be allowed.', pointer: 'Press the location button', touch: 'Tap the location button', target: 'location', appMode: 'map' },
    { title: 'Look around from the air', description: 'Choose a move from the aerial button, then pick a point on the terrain, and the camera films around that point with a set motion.', pointer: 'Press the aerial button and choose a move', touch: 'Tap the aerial button and choose a move', target: 'maneuver', appMode: 'map' },
    { title: 'Share the view', description: 'Copy a permalink to share the same place and view.', pointer: 'Press the permalink button', touch: 'Tap the permalink button', target: 'permalink', appMode: 'map' },
    { title: 'Capture an image', description: 'Keep what you see on screen as an image.', pointer: 'Press the camera button, then “Save” or “Copy image”', touch: 'Tap the camera button, then “Save” or “Copy image”', target: 'camera', appMode: 'map', fallback: { pointer: 'Press the camera button, then “Share” or “Save”', touch: 'Tap the camera button, then “Share / Save”' } },
    { title: 'Record the screen', description: 'Keep what you do on screen, such as turning the terrain or an aerial move, as a video.', pointer: 'Press the video button to record, and press it again to stop', touch: 'Tap the video button to record, and tap it again to stop', target: 'video', appMode: 'map', fallback: { pointer: 'Press the video button to record, press it again to stop, then “Share” or “Save”', touch: 'Tap the video button to record, tap it again to stop, then “Share / Save”' } },
    { title: 'Share what you made', description: 'Copy the image with “Copy image” and paste it where you want to post it. The X button that appears after you capture one posts it straight away.', pointer: 'Copy the image and paste it, or post with the X button', touch: 'Copy the image and paste it, or post with the X button', target: 'share', appMode: 'map', nativeOnly: true },
  ],
  gpxSteps: [
    { title: 'Open a GPX', description: 'Open a GPX file to switch to GPX mode.', pointer: 'Press “GPX” and choose a file', touch: 'Tap “GPX” and choose a file', target: 'open-map', appMode: 'map' },
    { title: 'View the route', description: 'The loaded route appears on top of the terrain.', pointer: 'Drag to rotate; right-drag to move', touch: 'Use one finger to rotate; use two fingers to move', target: 'route', appMode: 'gpx' },
    { title: 'View waypoints', description: 'Inspect the waypoints included in the route, in the list and on the map.', pointer: 'Press a waypoint number', touch: 'Tap a waypoint number', target: 'waypoints', appMode: 'gpx' },
    { title: 'Review progress', description: 'Use the elevation profile and elapsed time to review progress along the route.', pointer: 'Use the profile or time controls', touch: 'Use the profile or time controls', target: 'progress', appMode: 'gpx' },
    { title: 'Fly along the route', description: 'Play the Flyover and the camera travels along the route over the terrain.', pointer: 'Press the ▶ button', touch: 'Tap the ▶ button', target: 'flyover', appMode: 'gpx' },
    { title: 'Return to Map', description: 'Return to Map mode to explore another place.', pointer: 'Press the mode switch', touch: 'Tap the mode switch', target: 'return', appMode: 'map' },
    { title: 'Open another GPX', description: 'Back in Map mode, use the GPX button to open another file.', pointer: 'Press “GPX” and choose another file', touch: 'Tap “GPX” and choose another file', target: 'open-map', appMode: 'map' },
  ],
  footer: '',
};

export function siteCopy(language: Language): SiteCopy {
  const base = language === 'ja' ? JAPANESE : ENGLISH;
  const appName = getCopy(language).appName;
  return {
    ...base,
    footer: appName,
  };
}
