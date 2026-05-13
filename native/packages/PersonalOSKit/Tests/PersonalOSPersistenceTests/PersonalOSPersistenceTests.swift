import Testing
@testable import PersonalOSPersistence

@Suite("PersonalOSPersistence")
struct PersonalOSPersistenceConfigTests {
    @Test("CloudKit container identifier is correct")
    func containerIdentifier() {
        #expect(PersonalOSPersistence.cloudKitContainerIdentifier == "iCloud.com.zelig.PersonalOS")
    }
}
