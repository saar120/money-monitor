import AVFoundation
import Testing
@testable import MoneyMonitor

struct PairingQRScannerStateTests {
    @Test
    func accessPolicyRequestsFirstRunPermissionWithoutRequiringCurrentAvailability() {
        let state = PairingQRScannerAccessPolicy.evaluate(
            authorizationStatus: .notDetermined,
            isScannerSupported: true,
            isScannerAvailable: false
        )

        #expect(state == .requestPermission)
    }

    @Test
    func accessPolicyStartsOnlyWhenAuthorizedSupportedAndAvailable() {
        #expect(
            PairingQRScannerAccessPolicy.evaluate(
                authorizationStatus: .authorized,
                isScannerSupported: true,
                isScannerAvailable: true
            ) == .ready
        )
        #expect(
            PairingQRScannerAccessPolicy.evaluate(
                authorizationStatus: .authorized,
                isScannerSupported: true,
                isScannerAvailable: false
            ) == .unavailable
        )
        #expect(
            PairingQRScannerAccessPolicy.evaluate(
                authorizationStatus: .authorized,
                isScannerSupported: false,
                isScannerAvailable: true
            ) == .unavailable
        )
    }

    @Test
    func accessPolicyDistinguishesDeniedAndRestrictedAccess() {
        #expect(
            PairingQRScannerAccessPolicy.evaluate(
                authorizationStatus: .denied,
                isScannerSupported: true,
                isScannerAvailable: true
            ) == .denied
        )
        #expect(
            PairingQRScannerAccessPolicy.evaluate(
                authorizationStatus: .restricted,
                isScannerSupported: true,
                isScannerAvailable: true
            ) == .restricted
        )
    }

    @Test
    func terminalGateAllowsOnlyOneScanOrCancellationEvent() {
        var deliveredScan = PairingQRScannerTerminalGate()
        let firstScan = deliveredScan.claimTerminalEvent()
        let repeatedScan = deliveredScan.claimTerminalEvent()
        #expect(firstScan)
        #expect(!repeatedScan)

        var cancelled = PairingQRScannerTerminalGate()
        let firstCancellation = cancelled.claimTerminalEvent()
        let repeatedCancellation = cancelled.claimTerminalEvent()
        #expect(firstCancellation)
        #expect(!repeatedCancellation)
    }
}
