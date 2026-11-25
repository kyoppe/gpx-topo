export type Language = 'ja' | 'en';

const WEEK: Record<Language, readonly string[]> = {
  ja: ['日', '月', '火', '水', '木', '金', '土'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

const MONTHS: Record<Language, readonly string[]> = {
  ja: [],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};

export type Copy = {
  language: Language;
  locale: string;
  appName: string;
  photoAppName: string;
  raceAppName: string;
  shareText: string;
  about: string;
  week: readonly string[];
  fallbackTitle: string;
  fallbackBody: string;
  dateLabel(iso: string): string;
  monthLabel(year: number, month: number): string;
  dayLength(rise: number | null, set: number | null): string;
  toast: {
    defaultGpxFailed: string;
    mapTilesFailed: string;
    demFallback: string;
    waypointAdded(name: string, km: number): string;
    addKmRequired: string;
    clickRoute: string;
    highestUnavailable: string;
    threeDStartFailed: string;
    gpxLoaded(name: string, points: number): string;
    gpxLoadFailed: string;
    pngExportFailed: string;
    imageSavedFailed: string;
    imageCopiedFailed: string;
    imageCopied: string;
    permalinkCopied: string;
    permalinkCopyFailed: string;
    videoRecordingUnsupported: string;
    videoRecordingFailed: string;
    videoSavedFailed: string;
    xPostFailed: string;
    pickPoint: string;
  };
  ui: {
    mapType: string;
    map: string;
    standardMap: string;
    paleMap: string;
    blankMap: string;
    aerial: string;
    photoNames: string;
    hillshadeOn: string;
    hillshadeOff: string;
    mapLoading: string;
    highestPoint(elevation: number): string;
    highestPointLabel: string;
    positionAtTime: string;
    routeName: string;
    distance: string;
    elevationGain: string;
    elevationProfile: string;
    sunlight: string;
    sunlightOn: string;
    sunlightOff: string;
    sunAuto: string;
    sunAutoStop: string;
    sunAutoSpeed: string;
    sunAutoSpeedLabels: readonly [string, string, string];
    time: string;
    start: string;
    startTime: string;
    date: string;
    sunrise: string;
    sunset: string;
    daylight: string;
    waypoints: string;
    addWaypoint: string;
    sunlightHint: string;
    addPositionAria: string;
    kmAt: string;
    add: string;
    waypointLightAria(name: string): string;
    waypointNameAria(index: number): string;
    waypointKmAria(name: string): string;
    waypointElapsedAria(name: string): string;
    deleteWaypointAria(name: string): string;
    estimated: string;
    gsiCredit: string;
    previousMonth: string;
    nextMonth: string;
    elapsedTime: string;
    startClockHint: string;
    elapsedClockHint: string;
    cancel: string;
    confirm: string;
    imageOfView: string;
    videoOfView: string;
    shareMedia: string;
    share: string;
    save: string;
    copyImage: string;
    postToX: string;
    close: string;
    controls: string;
    loadingTerrain: string;
    loadingGpx: string;
    dragHint: string;
    scrollHint: string;
    mapMode: string;
    gpxMode: string;
    copyPermalink: string;
    mapPin: string;
    mapPinCancel: string;
    mapPinNameAria: string;
    mapSearchPlaceholder: string;
    mapSearchSubmit: string;
    mapSearchNoResults: string;
    mapSearchFailed: string;
    mapSearchBusy: string;
    openGpx: string;
    clickRouteMode: string;
    raise: string;
    layFlat: string;
    flyoverPlay: string;
    flyoverPause: string;
    flyoverResume: string;
    flyoverStop: string;
    fpv: string;
    fpvMenu: string;
    fpvCancel: string;
    mapManeuver: string;
    mapManeuverMenu: string;
    dronie: string;
    circle: string;
    rocket: string;
    helix: string;
    boomerang: string;
    asteroid: string;
    dollyZoom: string;
    cancelManeuver: string;
    viewMoves: string;
    captureImage: string;
    recordVideo: string;
    stopVideoRecording: string;
    xHintPhoto: string;
    xHintVideo: string;
    xHintMapPin: string;
    helpLinks: string;
    showPanel: string;
    panelRoute: string;
    panelSearch: string;
    panelPin: string;
    hidePanel: string;
    hoursAria: string;
    minutesAria: string;
    closeDialog: string;
  };
  flag: {
    lead: string;
    modes: string;
    gpxModeDescription: string;
    mapModeDescription: string;
    loadRoute: string;
    loadRouteItems: readonly [string, string];
    viewMap: string;
    viewMapItems: readonly [string, string, string, string];
    waypointsAndTimes: string;
    waypointsAndTimesItems: readonly [string, string, string, string, string];
    madeBy: string;
    otherApps: string;
    wishlist: string;
    gpxWallpaper: string;
    raceTime: string;
  };
};

function makeCopy(language: Language): Copy {
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  if (language === 'ja') {
    return {
      language,
      locale,
      appName: 'GPX箱庭なんちゃら',
      photoAppName: 'GPX箱庭なんちゃら',
      raceAppName: 'レース中に開くなんちゃら',
      shareText: 'GPX箱庭なんちゃらで作りました。\nhttps://gpx-topo.pages.dev/\n#GPX箱庭なんちゃら',
      about: 'について',
      week: WEEK.ja,
      fallbackTitle: '対応ブラウザで開いてください',
      fallbackBody: 'このアプリは HTML-in-Canvas を使っています。PC 版の Chrome または Edge (157 以降) で開いてください。',
      dateLabel: (iso) => {
        const [y, m, d] = iso.split('-').map(Number);
        return `${y}/${m}/${d} (${WEEK.ja[new Date(y, m - 1, d).getDay()]})`;
      },
      monthLabel: (year, month) => `${year}年 ${month}月`,
      dayLength: (rise, set) => {
        if (rise === null || set === null) return '-';
        const minutes = Math.round(set - rise);
        return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
      },
      toast: {
        defaultGpxFailed: 'テスト用 GPX を読み込めませんでした。GPX を開いてください。',
        mapTilesFailed: '地理院タイルを読み込めませんでした。',
        demFallback: 'GSI DEM を読み込めなかったため、GPX の標高から地形を作っています。',
        waypointAdded: (name, km) => `${name} を ${km.toFixed(1)} km に追加しました。`,
        addKmRequired: '追加する位置を km で入力してください。',
        clickRoute: 'ルートの上をクリックしてください。',
        highestUnavailable: '標高が分からないため、最高点を出せません。',
        threeDStartFailed: '3D を開始できませんでした。',
        gpxLoaded: (name, points) => `${name} を読み込みました (${points.toLocaleString(locale)} 点)。`,
        gpxLoadFailed: 'GPX を読み込めませんでした。',
        pngExportFailed: 'PNG を書き出せませんでした。',
        imageSavedFailed: '画像を保存できませんでした。',
        imageCopiedFailed: '画像をコピーできませんでした。',
        imageCopied: '画像をコピーしました。',
        permalinkCopied: 'パーマリンクをコピーしました。',
        permalinkCopyFailed: 'パーマリンクをコピーできませんでした。',
        videoRecordingUnsupported: 'このブラウザでは動画を録画できません。',
        videoRecordingFailed: '動画を録画できませんでした。',
        videoSavedFailed: '動画を保存できませんでした。',
        xPostFailed: 'Xの投稿画面を開けませんでした。',
        pickPoint: '地図をタップして、場所を選んでください。',
      },
      ui: {
        mapType: '地図の種類',
        map: '地図',
        standardMap: '標準',
        paleMap: '淡色',
        blankMap: '白地図',
        aerial: '写真',
        photoNames: '写真+地名',
        hillshadeOn: '陰影あり',
        hillshadeOff: '陰影なし',
        mapLoading: '地図を読み込み中',
        highestPoint: (elevation) => `最高点 ${Math.round(elevation)} m`,
        highestPointLabel: '最高点',
        positionAtTime: 'この時刻の位置',
        routeName: 'ルート名',
        distance: '距離',
        elevationGain: '累積標高',
        elevationProfile: '標高プロファイル',
        sunlight: '日照',
        sunlightOn: '日照あり',
        sunlightOff: '日照なし',
        sunAuto: '自動',
        sunAutoStop: '停止',
        sunAutoSpeed: '自動日照の速度',
        sunAutoSpeedLabels: ['ゆっくり', '標準', '速い'],
        time: '時刻',
        start: 'スタート',
        startTime: 'スタート時刻',
        date: '日付',
        sunrise: '日の出',
        sunset: '日の入',
        daylight: '昼',
        waypoints: 'ウェイポイント',
        addWaypoint: 'ウェイポイント追加',
        sunlightHint: '番号を押すとそのウェイポイントの光になります',
        addPositionAria: '追加する位置 (km)',
        kmAt: 'km に',
        add: '追加',
        waypointLightAria: (name) => `${name} の地点の光にする`,
        waypointNameAria: (index) => `${index} 番の名前`,
        waypointKmAria: (name) => `${name} の km`,
        waypointElapsedAria: (name) => `${name} の経過時間`,
        deleteWaypointAria: (name) => `${name} を削除`,
        estimated: '推定',
        gsiCredit: '地理院タイル (淡色地図・白地図・陰影起伏図・標高タイル) 国土地理院',
        previousMonth: '前の月',
        nextMonth: '次の月',
        elapsedTime: 'スタートからの経過時間',
        startClockHint: 'ドラッグ・ホイール・数字キー (HHMM)',
        elapsedClockHint: 'ドラッグ・ホイール・数字キー (HHHMM)',
        cancel: '取消',
        confirm: '決定',
        imageOfView: 'この画面の画像',
        videoOfView: 'この画面の動画',
        shareMedia: '共有 / 保存',
        share: '共有',
        save: '保存',
        copyImage: '画像をコピー',
        postToX: 'X に投稿',
        close: '閉じる',
        controls: '操作',
        loadingTerrain: '地形を読み込み中',
        loadingGpx: 'GPX を読み込み中',
        dragHint: 'ドラッグで回転 · 右ドラッグで移動',
        scrollHint: 'ホイールで立体・ズーム · Esc で平面',
        mapMode: 'Map',
        gpxMode: 'GPX',
        copyPermalink: 'パーマリンクをコピー',
        mapPin: '地点を示すピン',
        mapPinCancel: 'ピン配置を取消',
        mapPinNameAria: 'ピンの名前',
        mapSearchPlaceholder: '住所・地名・座標・GoogleマップURL',
        mapSearchSubmit: '検索',
        mapSearchNoResults: '検索結果がありません。',
        mapSearchFailed: '検索できませんでした。',
        mapSearchBusy: '検索中…',
        openGpx: 'GPX を開く',
        clickRouteMode: 'ルートをクリック',
        raise: '起こす',
        layFlat: '寝かす',
        flyoverPlay: 'Flyoverを再生',
        flyoverPause: 'Flyoverを一時停止',
        flyoverResume: 'Flyoverを再開',
        flyoverStop: 'Flyoverを停止',
        fpv: 'FPV視点を開始',
        fpvMenu: 'FPV',
        fpvCancel: 'FPV視点を終了',
        mapManeuver: '空撮',
        mapManeuverMenu: '空撮マニューバ',
        dronie: 'ドローニー',
        circle: 'サークル',
        rocket: 'ロケット',
        helix: 'ヘリックス',
        boomerang: 'ブーメラン',
        asteroid: 'アステロイド',
        dollyZoom: 'ドリーズーム',
        cancelManeuver: '空撮をキャンセル',
        viewMoves: '視点を変える',
        captureImage: '画像にする',
        recordVideo: '画面を録画',
        stopVideoRecording: '録画を停止',
        xHintPhoto: '画像をコピーしました。\nXに貼り付けてください。',
        xHintVideo: '動画を添付してXに投稿できます。',
        xHintMapPin: 'ピンをドロップしました。\nピンのラベルは編集できます。',
        helpLinks: '使い方とリンク',
        showPanel: '設定パネルを開く',
        panelRoute: 'ルート',
        panelSearch: '検索',
        panelPin: 'ピン',
        hidePanel: '設定パネルを閉じる',
        hoursAria: '時',
        minutesAria: '分',
        closeDialog: '閉じる',
      },
      flag: {
        lead: 'GPX のルートを、国土地理院の地図と標高から作った立体模型の上で見るアプリです。',
        modes: 'モード',
        gpxModeDescription: 'GPXを開き、ルート・ウェイポイント・経過時間を扱います。',
        mapModeDescription: '地図を検索・ドラッグし、選んだ範囲を立体化します。',
        loadRoute: 'ルートを読み込む',
        loadRouteItems: ['「GPX を開く」で手元の GPX ファイルを読み込む（最初はサンプルのコース）', 'カメラのボタンで、今の画面を PNG で保存'],
        viewMap: '地図を見る',
        viewMapItems: ['「起こす」で立体に、「寝かす」で平面に。Esc でも平面に戻る', 'ドラッグで回転、右ドラッグか Shift + ドラッグで移動', 'ホイールで立ち上げてズーム。地図の右下で航空写真に切り替え', '▶ でコースを後ろから追いかける Flyover'],
        waypointsAndTimes: 'ウェイポイントと時刻',
        waypointsAndTimesItems: [
          '「ウェイポイント追加」を押してルートをクリック、またはパネルに km を入れて「追加」',
          'パネルで名前と km を書き換え、× で削除',
          'スタート時刻、日付、各地点の目標時刻を押して変更',
          '「日照」のスライダーで時刻を動かし、日の当たり方を見る',
          '番号を押すと、その地点の時刻の日照になる',
        ],
        madeBy: '作った人：キョウヘイ',
        otherApps: 'その他のアプリ',
        wishlist: 'Amazonほしい物リスト',
        gpxWallpaper: 'GPX壁紙なんちゃら',
        raceTime: 'レース中に開くなんちゃら',
      },
    };
  }

  return {
    language,
    locale,
    appName: 'GPX Diorama Whratever',
    photoAppName: 'GPX Diorama Whratever',
    raceAppName: 'Race-Time Whatever',
    shareText: 'Made with GPX Diorama Whratever.\nhttps://gpx-topo.pages.dev/\n#GPX箱庭なんちゃら',
    about: 'about',
    week: WEEK.en,
    fallbackTitle: 'Open this app in a supported browser',
    fallbackBody: 'This app uses HTML-in-Canvas. Please use desktop Chrome or Edge 157 or later.',
    dateLabel: (iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      return `${MONTHS.en[m - 1]} ${d}, ${y} (${WEEK.en[new Date(y, m - 1, d).getDay()]})`;
    },
    monthLabel: (year, month) => `${MONTHS.en[month - 1]} ${year}`,
    dayLength: (rise, set) => {
      if (rise === null || set === null) return '-';
      const minutes = Math.round(set - rise);
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    },
    toast: {
      defaultGpxFailed: 'Could not load the sample GPX. Please open a GPX file.',
      mapTilesFailed: 'Could not load the GSI map tiles.',
      demFallback: 'Could not load the GSI DEM, so the terrain is built from GPX elevations.',
      waypointAdded: (name, km) => `${name} added at ${km.toFixed(1)} km.`,
      addKmRequired: 'Enter a position in km.',
      clickRoute: 'Click the route.',
      highestUnavailable: 'Elevation data is unavailable, so the highest point cannot be shown.',
      threeDStartFailed: 'Could not start 3D mode.',
      gpxLoaded: (name, points) => `${name} loaded (${points.toLocaleString(locale)} points).`,
      gpxLoadFailed: 'Could not load the GPX file.',
      pngExportFailed: 'Could not export the PNG.',
      imageSavedFailed: 'Could not save the image.',
      imageCopiedFailed: 'Could not copy the image.',
      imageCopied: 'Image copied.',
      permalinkCopied: 'Permalink copied.',
      permalinkCopyFailed: 'Could not copy the permalink.',
      videoRecordingUnsupported: 'Video recording is not supported by this browser.',
      videoRecordingFailed: 'Could not record the video.',
      videoSavedFailed: 'Could not save the video.',
      xPostFailed: 'Could not open the X post composer.',
      pickPoint: 'Tap the map to choose a spot.',
    },
    ui: {
      mapType: 'Map type',
      map: 'Map',
      standardMap: 'Standard',
      paleMap: 'Pale',
      blankMap: 'Blank',
      aerial: 'Aerial',
      photoNames: 'Aerial + names',
      hillshadeOn: 'Hillshade on',
      hillshadeOff: 'Hillshade off',
      mapLoading: 'Loading map',
      highestPoint: (elevation) => `Highest point ${Math.round(elevation)} m`,
      highestPointLabel: 'Highest point',
      positionAtTime: 'Position at this time',
      routeName: 'Route name',
      distance: 'Distance',
      elevationGain: 'Elevation gain',
      elevationProfile: 'Elevation profile',
      sunlight: 'Sunlight',
      sunlightOn: 'Sunlight on',
      sunlightOff: 'Sunlight off',
      sunAuto: 'Auto',
      sunAutoStop: 'Stop',
      sunAutoSpeed: 'Auto sunlight speed',
      sunAutoSpeedLabels: ['Slow', 'Normal', 'Fast'],
      time: 'Time',
      start: 'Start',
      startTime: 'Start time',
      date: 'Date',
      sunrise: 'Sunrise',
      sunset: 'Sunset',
      daylight: 'Daylight',
      waypoints: 'Waypoints',
      addWaypoint: 'Add waypoint',
      sunlightHint: "Select a number to see the sunlight at that waypoint's time",
      addPositionAria: 'Position to add (km)',
      kmAt: 'at km',
      add: 'Add',
      waypointLightAria: (name) => `Set sunlight to ${name}'s time`,
      waypointNameAria: (index) => `Name for waypoint ${index}`,
      waypointKmAria: (name) => `${name} distance in km`,
      waypointElapsedAria: (name) => `${name} elapsed time`,
      deleteWaypointAria: (name) => `Delete ${name}`,
      estimated: 'estimated',
      gsiCredit: 'GSI tiles (Pale map, blank map, hillshade, elevation) Geospatial Information Authority of Japan',
      previousMonth: 'Previous month',
      nextMonth: 'Next month',
      elapsedTime: 'Elapsed time from start',
      startClockHint: 'Drag, wheel, or number keys (HHMM)',
      elapsedClockHint: 'Drag, wheel, or number keys (HHHMM)',
      cancel: 'Cancel',
      confirm: 'Done',
      imageOfView: 'Screenshot of this view',
      videoOfView: 'Recording of this view',
      shareMedia: 'Share / Save',
      share: 'Share',
      save: 'Save',
      copyImage: 'Copy image',
      postToX: 'Post to X',
      close: 'Close',
      controls: 'Controls',
      loadingTerrain: 'Loading terrain',
      loadingGpx: 'Loading GPX',
      dragHint: 'Drag to rotate · Right-drag to move',
      scrollHint: 'Scroll to raise and zoom · Esc to lay flat',
      mapMode: 'Map',
      gpxMode: 'GPX',
      copyPermalink: 'Copy permalink',
      mapPin: 'Drop a location pin',
      mapPinCancel: 'Cancel pin placement',
      mapPinNameAria: 'Pin name',
      mapSearchPlaceholder: 'Address, place, coordinates, or Google Maps URL',
      mapSearchSubmit: 'Search',
      mapSearchNoResults: 'No search results.',
      mapSearchFailed: 'Search failed.',
      mapSearchBusy: 'Searching…',
      openGpx: 'Open GPX',
      clickRouteMode: 'Click the route',
      raise: 'Raise',
      layFlat: 'Lay flat',
      flyoverPlay: 'Play Flyover',
      flyoverPause: 'Pause Flyover',
      flyoverResume: 'Resume Flyover',
      flyoverStop: 'Stop Flyover',
      fpv: 'Start FPV view',
      fpvMenu: 'FPV',
      fpvCancel: 'Exit FPV view',
      mapManeuver: 'Aerial shot',
      mapManeuverMenu: 'Aerial shot maneuvers',
      dronie: 'Dronie',
      circle: 'Circle',
      rocket: 'Rocket',
      helix: 'Helix',
      boomerang: 'Boomerang',
      asteroid: 'Asteroid',
      dollyZoom: 'Dolly Zoom',
      cancelManeuver: 'Cancel aerial shot',
      viewMoves: 'Change the view',
      captureImage: 'Capture image',
      recordVideo: 'Record screen',
      stopVideoRecording: 'Stop recording',
      xHintPhoto: 'Photo copied.\nPaste it into your post on X.',
      xHintVideo: 'Attach the video to your post on X.',
      xHintMapPin: 'Pin dropped.\nYou can edit its label.',
      helpLinks: 'Help and links',
      showPanel: 'Show the panel',
      panelRoute: 'Route',
      panelSearch: 'Search',
      panelPin: 'Pin',
      hidePanel: 'Hide the panel',
      hoursAria: 'Hours',
      minutesAria: 'Minutes',
      closeDialog: 'Close',
    },
    flag: {
      lead: 'View GPX routes on a 3D model built from Geospatial Information Authority of Japan maps and elevation data.',
      modes: 'Modes',
      gpxModeDescription: 'Open a GPX and work with routes, waypoints, and elapsed time.',
      mapModeDescription: 'Search and drag the map, then raise the chosen area into 3D.',
      loadRoute: 'Load a route',
      loadRouteItems: ['Open a GPX file with “Open GPX” (a sample route is loaded first)', 'Use the camera button to save the current view as a PNG'],
      viewMap: 'View the map',
      viewMapItems: ['Use “Raise” for 3D and “Lay flat” for 2D. Esc also lays it flat.', 'Drag to rotate; right-drag or Shift + drag to move', 'Scroll to raise and zoom. Switch to aerial imagery at the bottom right of the map', 'Press ▶ to follow the route from behind with Flyover'],
      waypointsAndTimes: 'Waypoints and times',
      waypointsAndTimesItems: [
        'Press “Add waypoint” and click the route, or enter km in the panel and press “Add”',
        'Edit the name and km in the panel, or delete a waypoint with ×',
        'Select the start time, date, or a waypoint time to edit it',
        'Move the sunlight slider to see how the light changes',
        "Select a number to see the sunlight at that waypoint's time",
      ],
      madeBy: 'Made by Kyouhei',
      otherApps: 'Other apps',
      wishlist: 'Amazon Wishlist',
      gpxWallpaper: 'GPX Wallpaper Whratever',
      raceTime: 'Race-Time Whatever',
    },
  };
}

export function detectLanguage(): Language {
  if (typeof window !== 'undefined') {
    const forced = new URLSearchParams(window.location.search).get('lang')?.toLowerCase();
    if (forced === 'ja' || forced === 'en') return forced;
  }
  if (typeof navigator === 'undefined') return 'en';
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith('ja')) ? 'ja' : 'en';
}

export function getCopy(language: Language): Copy {
  return makeCopy(language);
}
