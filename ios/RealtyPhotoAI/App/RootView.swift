import SwiftUI

struct RootView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var store: PurchaseManager

    var body: some View {
        Group {
            if app.isBootstrapping {
                SplashView()
            } else if app.user == nil {
                AuthView()
            } else {
                MainTabView()
            }
        }
        .animation(.default, value: app.user == nil)
        .task {
            await app.bootstrap()
            store.start(app: app)
        }
        .onChange(of: app.user?.email) { _, email in
            // покупка, сделанная до входа или прерванная, — дозачислим после входа
            if email != nil { Task { await store.processUnfinished() } }
        }
        .toast(message: $app.toast)
        .sheet(isPresented: $app.showPaywall) { SubscriptionView() }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            EditorView()
                .tabItem { Label("tab.edit", systemImage: "wand.and.stars") }
            HistoryView()
                .tabItem { Label("tab.history", systemImage: "photo.stack") }
            AccountView()
                .tabItem { Label("tab.account", systemImage: "person.crop.circle") }
        }
    }
}

struct SplashView: View {
    var body: some View {
        VStack(spacing: 16) {
            BrandMark(size: 72)
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.appBackground)
    }
}
