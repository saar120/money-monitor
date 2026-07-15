import Foundation

struct MobileHTTPResponse: Equatable, Sendable {
    let data: Data
    let statusCode: Int
}

enum MobileHTTPTransportError: Error, Equatable, Sendable {
    case invalidResponse
}

protocol MobileHTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> MobileHTTPResponse
}

enum MobileURLSessionFactory {
    static func makeConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        return configuration
    }

    static func makeSession() -> URLSession {
        URLSession(configuration: makeConfiguration())
    }
}

struct URLSessionMobileHTTPTransport: MobileHTTPTransport, Sendable {
    private let session: URLSession

    init(session: URLSession = MobileURLSessionFactory.makeSession()) {
        self.session = session
    }

    func send(_ request: URLRequest) async throws -> MobileHTTPResponse {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw MobileHTTPTransportError.invalidResponse
        }
        return MobileHTTPResponse(data: data, statusCode: httpResponse.statusCode)
    }
}
