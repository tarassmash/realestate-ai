import Foundation

/// Ошибка сервера: код совпадает с кодами веб-версии (no_credits, bad_login, …)
struct APIError: LocalizedError, Equatable {
    let code: String
    let status: Int

    var errorDescription: String? { APIError.message(for: code) }

    static func message(for code: String) -> String {
        let key = "error.\(code)"
        let text = NSLocalizedString(key, comment: "")
        return text == key ? NSLocalizedString("error.default", comment: "") : text
    }
}

/// Клиент API. Сессия — cookie `sid` в общем хранилище (её же использует AsyncImage для картинок).
final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    let session: URLSession
    private let decoder: JSONDecoder

    private init() {
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage = .shared
        cfg.httpCookieAcceptPolicy = .always
        cfg.httpShouldSetCookies = true
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = 300
        session = URLSession(configuration: cfg)

        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { dec in
            let container = try dec.singleValueContainer()
            let raw = try container.decode(String.self)
            if let date = APIClient.isoFrac.date(from: raw) ?? APIClient.iso.date(from: raw) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Bad date \(raw)")
        }
    }

    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let iso = ISO8601DateFormatter()

    func url(_ path: String) -> URL {
        URL(string: path, relativeTo: AppConfig.baseURL)!.absoluteURL
    }

    func request<T: Decodable>(_ path: String, method: String = "GET", body: (any Encodable)? = nil) async throws -> T {
        var req = URLRequest(url: url(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(AppConfig.language, forHTTPHeaderField: "Accept-Language")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError(code: "network", status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let code = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "default"
            throw APIError(code: code, status: status)
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError(code: "default", status: status)
        }
    }

    /// Скачать файл (результат обработки) через прокси сервера
    func download(_ url: URL) async throws -> Data {
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw APIError(code: "download_failed", status: (response as? HTTPURLResponse)?.statusCode ?? 0)
            }
            return data
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError(code: "network", status: 0)
        }
    }

    func clearCookies() {
        let storage = HTTPCookieStorage.shared
        storage.cookies(for: AppConfig.baseURL)?.forEach { storage.deleteCookie($0) }
    }

    // MARK: - Ссылки на изображения

    /// Результат fal.ai через прокси сервера (`/api/download`)
    func resultURL(_ remote: String) -> URL {
        var comps = URLComponents(url: url("/api/download"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "inline", value: "1"), URLQueryItem(name: "url", value: remote)]
        return comps.url!
    }

    func thumbURL(jobId: String) -> URL {
        url("/api/jobs/\(jobId)/thumb")
    }
}

private struct ErrorBody: Decodable { let error: String }

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
