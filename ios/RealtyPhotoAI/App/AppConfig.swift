import Foundation

/// Адрес сервера и ссылки. Если перенесёте сайт на свой домен — поменяйте `baseURL`.
enum AppConfig {
    static let baseURL = URL(string: "https://web-production-88f12.up.railway.app")!

    static var termsURL: URL { baseURL.appending(path: "condiciones") }
    static var privacyURL: URL { baseURL.appending(path: "privacidad") }
    static var legalNoticeURL: URL { baseURL.appending(path: "aviso-legal") }

    /// Язык интерфейса, который выбрала iOS для приложения (ru / es / en)
    static var language: String {
        let code = Bundle.main.preferredLocalizations.first ?? "en"
        let short = String(code.prefix(2))
        return ["ru", "es", "en"].contains(short) ? short : "en"
    }

    static var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
    }
}
