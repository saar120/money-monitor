import Foundation

enum MobileReviewCommandOutcome: String, Codable, Equatable, Sendable {
    case confirmed
    case validationFailed
    case conflict
}

struct MobileReviewResolveCommand: Encodable, Equatable, Sendable {
    let idempotencyKey: String
    let transactionID: String
    let categoryID: String
    let expectedNeedsReview = true

    private enum CodingKeys: String, CodingKey {
        case idempotencyKey
        case transactionID = "transactionId"
        case categoryID = "categoryId"
        case expectedNeedsReview
    }
}

struct MobileReviewSkipCommand: Encodable, Equatable, Sendable {
    let idempotencyKey: String
    let transactionID: String
    let expectedNeedsReview = true

    private enum CodingKeys: String, CodingKey {
        case idempotencyKey
        case transactionID = "transactionId"
        case expectedNeedsReview
    }
}

struct MobileReviewCommandResult: Codable, Equatable, Sendable {
    let outcome: MobileReviewCommandOutcome
    let transactionID: String
    let needsReview: Bool

    private enum CodingKeys: String, CodingKey {
        case outcome
        case transactionID = "transactionId"
        case needsReview
    }
}

struct MobileReviewCommandMetadata: Codable, Equatable, Sendable {
    struct Server: Codable, Equatable, Sendable {
        let id: UUID
        let protocolVersion: Int
    }

    let apiVersion: String
    let generatedAt: Date
    let source: BootstrapResponseSource
    let server: Server
}

struct MobileReviewCommandEnvelope: Codable, Equatable, Sendable {
    let data: MobileReviewCommandResult
    let meta: MobileReviewCommandMetadata
}

enum MobileReviewCommandPayloadDecoder {
    static func decode(_ data: Data) throws -> MobileReviewCommandEnvelope {
        try MobilePayloadSecurityValidator().validate(data)
        guard
            let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(root.keys) == ["data", "meta"],
            let result = root["data"] as? [String: Any],
            Set(result.keys) == ["outcome", "transactionId", "needsReview"],
            let metadata = root["meta"] as? [String: Any],
            Set(metadata.keys) == ["apiVersion", "generatedAt", "source", "server"],
            let server = metadata["server"] as? [String: Any],
            Set(server.keys) == ["id", "protocolVersion"]
        else {
            throw MobileClientError.invalidPayload
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(MobileReviewCommandEnvelope.self, from: data)
    }
}
