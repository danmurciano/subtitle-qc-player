import WebKit

/// Keeps the window on the bundled interface: no navigation to web pages, no pop-up windows.
final class NavigationGuard: NSObject, WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
        if scheme == "file" || scheme == "about" || scheme == "blob" || scheme == "data" { decisionHandler(.allow) }
        else { Log.write("warn", "Blocked navigation to \(navigationAction.request.url?.absoluteString ?? "?")"); decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        Log.write("error", "The interface process stopped; reloading.")
        webView.reload()
    }
}
