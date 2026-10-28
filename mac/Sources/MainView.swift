import AppKit
import WebKit
import AVFoundation

/// The window's content: the native video picture at the bottom, the web page (the whole
/// interface) on top. The page is see-through over the stage, so the picture shows through
/// exactly where the page's video element is.
final class MainView: NSView {
    static let panelColor = NSColor(srgbRed: 0x11 / 255.0, green: 0x12 / 255.0, blue: 0x15 / 255.0, alpha: 1)   // --panel
    static let stageColor = NSColor(srgbRed: 0x07 / 255.0, green: 0x07 / 255.0, blue: 0x08 / 255.0, alpha: 1)   // stage grey

    let playerHost = NSView()
    let video = VideoController()
    var webView: DropWebView!
    var bridge: Bridge!

    override var isFlipped: Bool { true }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = MainView.panelColor.cgColor

        playerHost.wantsLayer = true
        playerHost.layer?.backgroundColor = MainView.stageColor.cgColor
        playerHost.layer?.addSublayer(video.layer)
        playerHost.isHidden = true
        addSubview(playerHost)

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.mediaTypesRequiringUserActionForPlayback = []
        bridge = Bridge(view: self)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "native")
        let store = Settings.allJSON()
        config.userContentController.addUserScript(WKUserScript(source: "window.__nativeStore = \(store);", injectionTime: .atDocumentStart, forMainFrameOnly: true))

        webView = DropWebView(frame: bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        webView.onDrop = { [weak self] items in self?.bridge.emit("drop", ["items": items]) }
        addSubview(webView)
        video.bridge = bridge
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func load() {
        guard let url = Bundle.main.url(forResource: "index", withExtension: "html") else {
            Log.write("error", "index.html missing from the app bundle"); return
        }
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
    func reload() { video.unload(); playerHost.isHidden = true; load() }

    /// Called by the page whenever the stage or video element moves or resizes.
    func layoutPlayer(visible: Bool, stage: [Double]?, videoRect: [Double]?) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard visible, let s = stage, s.count == 4, let v = videoRect, v.count == 4 else { playerHost.isHidden = true; return }
        playerHost.frame = NSRect(x: s[0], y: s[1], width: s[2], height: s[3])
        // playerHost is not flipped: convert the video's top-left based rect.
        let x = v[0] - s[0], yTop = v[1] - s[1]
        video.layer.frame = CGRect(x: x, y: s[3] - yTop - v[3], width: v[2], height: v[3])
        playerHost.isHidden = false
    }
}

/// Lets folders and files be dropped onto the window from Finder (the page can't see file paths).
final class DropWebView: WKWebView {
    var onDrop: (([[String: Any]]) -> Void)?

    private func fileURLs(_ info: NSDraggingInfo) -> [URL] {
        (info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    }
    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        fileURLs(sender).isEmpty ? super.draggingEntered(sender) : .copy
    }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        fileURLs(sender).isEmpty ? super.draggingUpdated(sender) : .copy
    }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = fileURLs(sender)
        if urls.isEmpty { return super.performDragOperation(sender) }
        let items: [[String: Any]] = urls.map { url in
            var isDir: ObjCBool = false
            FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir)
            var d = FileInfo.describe(url) ?? ["name": url.lastPathComponent, "path": url.path, "size": 0, "mtime": 0]
            d["isDir"] = isDir.boolValue
            return d
        }
        onDrop?(items)
        return true
    }
}
