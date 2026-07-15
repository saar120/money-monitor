import Foundation

struct MobileResponseMetadata: Decodable, Equatable, Sendable {
    let apiVersion: String
    let generatedAt: Date
    let source: String
}

struct HealthStatus: Decodable, Equatable, Sendable {
    let status: String
}

struct HealthResponse: Decodable, Equatable, Sendable {
    let data: HealthStatus
    let meta: MobileResponseMetadata
}
