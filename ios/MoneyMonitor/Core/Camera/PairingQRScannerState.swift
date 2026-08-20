import AVFoundation
import Foundation

enum PairingQRScannerAccessState: Equatable, Sendable {
    case checking
    case requestPermission
    case ready
    case denied
    case restricted
    case unavailable
}

enum PairingQRScannerAccessPolicy {
    static func evaluate(
        authorizationStatus: AVAuthorizationStatus,
        isScannerSupported: Bool,
        isScannerAvailable: Bool
    ) -> PairingQRScannerAccessState {
        guard isScannerSupported else { return .unavailable }

        switch authorizationStatus {
        case .notDetermined:
            return .requestPermission
        case .authorized:
            return isScannerAvailable ? .ready : .unavailable
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        @unknown default:
            return .unavailable
        }
    }
}

struct PairingQRScannerTerminalGate: Sendable {
    private(set) var isClosed = false

    mutating func claimTerminalEvent() -> Bool {
        guard !isClosed else { return false }
        isClosed = true
        return true
    }
}
