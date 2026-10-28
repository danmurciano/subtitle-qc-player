import Foundation

/// Appends to ~/Library/Logs/Subtitle QC/app.log (Help ▸ Show Log File). Errors from the page are
/// written here too, so a problem on someone's Mac can be looked at afterwards.
enum Log {
    static let fileURL: URL = {
        let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Subtitle QC", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("app.log")
    }()
    private static let queue = DispatchQueue(label: "log")
    private static let formatter: ISO8601DateFormatter = ISO8601DateFormatter()

    static func write(_ level: String, _ message: String) {
        let line = "\(formatter.string(from: Date())) [\(level)] \(message)\n"
        queue.async {
            if let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.intValue, size > 2_000_000 {
                try? FileManager.default.removeItem(at: fileURL)
            }
            if let h = try? FileHandle(forWritingTo: fileURL) {
                h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
            } else {
                try? line.data(using: .utf8)!.write(to: fileURL)
            }
        }
    }
}
