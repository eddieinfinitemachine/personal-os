// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PersonalOSKit",
    platforms: [
        .macOS(.v15),
        .iOS(.v18)
    ],
    products: [
        .library(name: "PersonalOSModels", targets: ["PersonalOSModels"]),
        .library(name: "PersonalOSPersistence", targets: ["PersonalOSPersistence"]),
        .library(name: "PersonalOSServices", targets: ["PersonalOSServices"]),
        .library(name: "PersonalOSUI", targets: ["PersonalOSUI"]),
    ],
    targets: [
        .target(
            name: "PersonalOSModels"
        ),
        .target(
            name: "PersonalOSPersistence",
            dependencies: ["PersonalOSModels"]
        ),
        .target(
            name: "PersonalOSServices",
            dependencies: ["PersonalOSModels", "PersonalOSPersistence"]
        ),
        .target(
            name: "PersonalOSUI",
            dependencies: ["PersonalOSModels", "PersonalOSPersistence", "PersonalOSServices"]
        ),
        .testTarget(
            name: "PersonalOSModelsTests",
            dependencies: ["PersonalOSModels"]
        ),
        .testTarget(
            name: "PersonalOSPersistenceTests",
            dependencies: ["PersonalOSPersistence", "PersonalOSModels"]
        ),
        .testTarget(
            name: "PersonalOSServicesTests",
            dependencies: ["PersonalOSServices", "PersonalOSPersistence", "PersonalOSModels"]
        ),
    ]
)
