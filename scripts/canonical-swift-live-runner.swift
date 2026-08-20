import Foundation

@main
struct CanonicalSwiftLiveRunner {
    struct RunnerError: Error {}

    static func main() async throws {
        guard CommandLine.arguments.count == 3,
              let baseURL = URL(string: CommandLine.arguments[1]) else {
            throw RunnerError()
        }

        let client = CanonicalAPIClient(baseURL: baseURL, token: CommandLine.arguments[2])
        let response = try await client.getReference()
        print("\(response.data.id)|\(response.data.amount.value)|\(response.data.amount.currencyCode)")
    }
}
