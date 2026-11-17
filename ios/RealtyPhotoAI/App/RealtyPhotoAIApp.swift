import SwiftUI

@main
struct RealtyPhotoAIApp: App {
    @StateObject private var app = AppModel()
    @StateObject private var store = PurchaseManager()
    @StateObject private var editor = EditorModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(store)
                .environmentObject(editor)
                .tint(.brand)
        }
    }
}
