import Foundation

/// Which files the interface may open. Only folders the user chose (Choose… or dropped on the
/// window) and files dropped on the window; everything else on the Mac is off limits to the page.
/// The list is kept by the app itself, so the page can't add to it. Later write features (fixing
/// subtitles, moving files) will use the same boundary.
enum Access {
    private static let key = "allowedFolders"
    private static var roots: [String] = UserDefaults.standard.stringArray(forKey: key) ?? []
    private static var files = Set<String>()

    static func canonical(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
    }
    static func allowFolder(_ path: String) {
        let c = canonical(path)
        roots.removeAll { $0 == c }
        roots.insert(c, at: 0)
        roots = Array(roots.prefix(40))
        UserDefaults.standard.set(roots, forKey: key)
    }
    static func allowFile(_ path: String) { files.insert(canonical(path)) }

    static func isAllowed(_ path: String) -> Bool {
        guard !path.isEmpty else { return false }
        let c = canonical(path)
        if files.contains(c) { return true }
        return roots.contains { r in c == r || c.hasPrefix(r == "/" ? "/" : r + "/") }
    }
}
