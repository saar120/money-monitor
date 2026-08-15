// swift-tools-version: 6.1

import PackageDescription

let package = Package(
    name: "CanonicalAPI",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "CanonicalAPI", targets: ["CanonicalAPI"]),
        .executable(name: "CanonicalAPILiveRunner", targets: ["CanonicalAPILiveRunner"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.12.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.9.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.3.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.6.0"),
    ],
    targets: [
        .target(
            name: "CanonicalAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            exclude: [
                "openapi.json",
                "openapi-generator-config.yaml",
            ]
        ),
        .executableTarget(
            name: "CanonicalAPILiveRunner",
            dependencies: ["CanonicalAPI"]
        ),
    ]
)
