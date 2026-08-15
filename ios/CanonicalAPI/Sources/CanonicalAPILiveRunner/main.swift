import CanonicalAPI
import Foundation

@main
enum CanonicalAPILiveRunner {
    static func main() async {
        guard CommandLine.arguments.count == 3,
              let baseURL = URL(string: CommandLine.arguments[1])
        else {
            FileHandle.standardError.write(Data("usage: CanonicalAPILiveRunner <base-url> <token>\n".utf8))
            Foundation.exit(64)
        }

        do {
            let client = CanonicalAPIClient(baseURL: baseURL, token: CommandLine.arguments[2])
            let reference = try await client.getReference()
            print("\(reference.data.id)|\(reference.data.amount.value)|\(reference.data.amount.currencyCode)")
        } catch {
            FileHandle.standardError.write(Data("\(error)\n".utf8))
            Foundation.exit(1)
        }
    }
}
