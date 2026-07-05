# 透過タイマーアプリ システム設計・動作原理ドキュメント

本アプリは、Linux (KDE Plasma 6 / Wayland) 環境上で「透明なフローティングウィンドウ」と「現在稼働中のアプリケーションの自動時間計測」を両立させるために、特別なアーキテクチャで設計されています。その内部実装と動作の仕組みを詳しく解説します。

---

## 1. 全体アーキテクチャ

本アプリケーションは **Electron** をベースに構築されており、大きく分けて2つのプロセスで構成されています。

```mermaid
graph TD
    subgraph バックエンド (メインプロセス: Node.js)
        M[main.js]
        DB[D-Bus Manager]
        J[Journal Monitor]
        FS[File System]
    end
    subgraph KDE デスクトップ環境 (Wayland)
        KWin[KWin Window Manager]
        SysLog[Systemd Journald]
    end
    subgraph フロントエンド (レンダラープロセス: Blink/V8)
        R[renderer.js]
        UI[index.html / style.css]
    end

    M -->|D-Bus API| DB
    DB -->|スクリプト登録| KWin
    KWin -->|アクティブ窓検知 & print| SysLog
    J -->|spawn journalctl -f| SysLog
    J -->|ログパース| M
    M -->|IPC: active-app-changed| R
    M -->|読み書き| FS[(time_records.json)]
    R -->|UI制御| UI
    R -->|IPC: toggle-click-through| M
```

---

## 2. KDE Wayland におけるアクティブウィンドウの自動検知

### 従来の課題 (Waylandのセキュリティ制限)
X11環境では `xprop` や `xdotool` などのコマンドを使うことで、現在開いているウィンドウ名やフォーカス先を容易に取得できました。しかし、Wayland環境ではセキュリティ上の理由から、**「現在アクティブなウィンドウの情報」を外部プロセスが直接取得することが原則禁止**されています。

### 本アプリでの解決策 (KWinスクリプト + `journalctl` 連携)
KDE Plasmaのウィンドウマネージャーである **KWin** は、独自の内部JavaScriptスクリプトエンジンを備えています。本アプリは、このKWin内部で動作する特権スクリプトを動的にロードし、システムログ経由で検知イベントを回収します。

#### ① KWinスクリプトの動的登録と実行 (`main.js` & `kwin_script.js`)
アプリ起動時に `main.js` から KDE の D-Bus インターフェースである `org.kde.KWin.Scripting` を叩き、[kwin_script.js](file:///home/administrator/Documents/TranspalentTimer/kwin_script.js) を読み込ませて実行します。
```javascript
// main.js 内での登録処理
execSync(`qdbus org.kde.KWin /Scripting org.kde.kwin.Scripting.loadScript "${scriptPath}" "${scriptName}"`);
// 読み込まれたスクリプトのDBusオブジェクトパスを検索し、run()を実行
execSync(`qdbus org.kde.KWin /Scripting/Script0 org.kde.kwin.Script.run`);
```
アプリが終了するときは、`will-quit` イベントを検知して自動的にKWinスクリプトをアンロードします。

#### ② ウィンドウ切り替えイベントの検知と出力 (`kwin_script.js`)
KWin内部で実行されるスクリプトは、ウィンドウマネージャーの強力なAPIにアクセスできます。`workspace.windowActivated` シグナルをフックし、アクティブウィンドウが切り替わった瞬間にそのアプリ名（`resourceClass`）とタイトル（`caption`）を出力します。
```javascript
// kwin_script.js 内
workspace.windowActivated.connect(function(window) {
    if (window) {
        print("KWIN_ACTIVE_APP:" + window.resourceClass + ":" + window.caption);
    }
});
```
※ ここで `print()` された文字列は、システムのシステムログ（`systemd-journald`）に書き出されます。

#### ③ ログの監視とパース (`main.js`)
`main.js` は、バックグラウンドプロセスとして `journalctl --user -f -o cat --since now` を起動（`spawn`）し、リアルタイムで出力されるログを監視します。
正規表現 `/^js: KWIN_ACTIVE_APP:(.*?):(.*)/` にマッチする行を読み出すことで、KWin内で切り替わったアプリ情報を即座にキャッチします。

---

## 3. データ設計と将来の可視化に向けた拡張性

自動計測された時間は、ユーザーデータディレクトリ（`~/.config/transparent-timer/time_records.json`）に保存されます。

### データ構造 (`time_records.json`)
単純なアプリごとの「累計秒数」を記録するだけでは、曜日ごとの比較や時間帯ごとの分析ができません。そのため、本アプリでは**「セッション（滞在履歴）の時系列ログ形式」**でデータを保存します。

```json
{
  "sessions": [
    {
      "timestamp": "2026-07-06T03:00:00.000Z",
      "app": "google-chrome",
      "title": "Google - Mozilla Firefox",
      "duration": 182
    },
    {
      "timestamp": "2026-07-06T03:03:02.000Z",
      "app": "kate",
      "title": "main.js — Kate",
      "duration": 45
    }
  ]
}
```

### 将来の拡張計画 (可視化機能の拡張)
このデータ構造により、将来的に以下のような機能をフロントエンド（HTML/JS）の追加だけで簡単に実装できます。
* **日次・週次トレンド**: `timestamp` から曜日や日付を抽出し、「水曜日はゲームの時間が長い」「先週に比べて開発時間が10%増えた」といったグラフ化。
* **時間帯分析**: 何時から何時までにどのアプリをよく使っていたかをヒートマップやタイムライン形式で表示。
* **タイトル別詳細**: アプリ名（`app`）だけでなく、ウィンドウタイトル（`title`）も保存されているため、「Chromeの中でどのドキュメントを最も長く開いていたか」の分析も可能です。

---

## 4. UI/UX の技術的仕組み

### ガラスモーフィズム (透明UI)
デスクトップと調和する半透明な質感は、CSSの `backdrop-filter: blur(20px)` を使用して実装されています。ウィンドウ自体を完全に透明に設定し、CSSのコンテナだけに半透明な背景色を塗ることで、文字やグラフだけが浮き出るデザインを実現しています。

### レスポンシブな文字＆UIスケーリング
ドラッグによってウィンドウサイズが変更された場合、CSSのビューポート単位（`vw` など）だけではアスペクト比が狂った際に文字がはみ出します。
そこで、[renderer.js](file:///home/administrator/Documents/TranspalentTimer/renderer.js) がウィンドウのリサイズイベントを捕捉し、**基準幅（320px）に対する拡大比率**を計算して、CSSカスタム変数（`--scale-factor`）を書き換えます。

```javascript
// renderer.js
function handleResize() {
  const scaleFactor = window.innerWidth / 320;
  document.documentElement.style.setProperty('--scale-factor', scaleFactor);
}
window.addEventListener('resize', handleResize);
```
CSS側では、すべてのフォントサイズやマージンをこの倍率で掛け算（`calc()`）することで、アスペクト比に関係なくUI全体が比例して伸縮します。
```css
/* style.css */
.timer-time {
  font-size: calc(2.3rem * var(--scale-factor));
  margin-bottom: calc(6px * var(--scale-factor));
}
```

### クリック透過 (Click-Through) のトグルの仕組み
タイマーの最前面表示中に、その下のエディタやゲームの操作を邪魔しないため、Electronの `setIgnoreMouseEvents` APIを使用しています。
1. **通常モード**: タイマーのボタンがクリックできます。
2. **透過モード**: マウスクリックはタイマーを「すり抜けて」背後のアプリに届きます。このとき、メインプロセスで `win.setIgnoreMouseEvents(true, { forward: true })` を呼び出します。`forward: true` オプションにより、マウスの移動イベント（ホバー等）自体はレンダラーに通知されるため、ホバー演出は維持されます。

#### グローバルホットキー (`Alt+T`)
透過状態になるとタイマー画面のボタンを物理的にクリックして解除できなくなるため、メインプロセスにグローバルショートカットとして **`Alt+T`** を登録しています。これにより、タイマーにフォーカスがなくてもキーボード入力だけでいつでも透過モードを解除できます。
