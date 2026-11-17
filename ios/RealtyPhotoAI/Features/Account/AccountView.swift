import SwiftUI
import StoreKit

struct AccountView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var store: PurchaseManager
    @AppStorage("markStaging") private var markStaging = true
    @State private var showPassword = false
    @State private var showDelete = false
    @State private var confirmLogout = false
    @State private var manageSubscriptions = false

    private var sub: Subscription? { app.entitlement?.subscription }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(app.user?.email ?? "").font(.headline)
                }

                // Подписка
                Section {
                    if let sub, sub.active {
                        LabeledContent("account.plan") {
                            Text(String(format: String(localized: "usage.week %lld %lld"), app.entitlement?.usage.remaining ?? 0, app.weeklyLimit))
                        }
                        if let date = sub.expiresAt {
                            LabeledContent(LocalizedStringKey(sub.cancelAtPeriodEnd ? "account.accessUntil" : "account.renews")) {
                                Text(date.formatted(date: .abbreviated, time: .omitted))
                            }
                        }
                        if sub.provider == "apple" {
                            Button("account.manageSubscription") { manageSubscriptions = true }
                        } else {
                            Text("account.managedOnWeb").font(.footnote).foregroundStyle(.secondary)
                        }
                    } else {
                        if app.credits > 0 {
                            LabeledContent("account.freePhotos", value: "\(app.credits)")
                        }
                        Button("usage.subscribe") { app.showPaywall = true }
                    }
                    Button("sub.restore") { Task { await store.restore() } }
                    NavigationLink { PurchasesView() } label: { Text("account.purchases") }
                } header: {
                    Text("account.subscription")
                }

                Section {
                    Toggle("account.mark", isOn: $markStaging)
                } footer: {
                    Text("account.markHint")
                }

                if let url = app.inviteURL {
                    Section {
                        ShareLink(item: url, message: Text(String(format: String(localized: "invite.message %@"), url.absoluteString))) {
                            Text("invite.share")
                        }
                    } footer: {
                        Text(String(format: String(localized: "invite.footer %lld %lld"),
                                    app.config?.refWelcome ?? 3, app.config?.refBonus ?? 10))
                    }
                }

                Section {
                    Button("account.changePassword") { showPassword = true }
                    Link(destination: AppConfig.termsURL) { Text("legal.termsOfUse") }
                    Link(destination: AppConfig.privacyURL) { Text("legal.privacy") }
                    if let support = app.config?.supportEmail, !support.isEmpty, let mail = URL(string: "mailto:\(support)") {
                        Link(destination: mail) { Text("account.support") }
                    }
                    Button("account.logout") { confirmLogout = true }
                }
                .tint(.primary)

                Section {
                    Button("account.delete", role: .destructive) { showDelete = true }
                } footer: {
                    Text(String(format: String(localized: "account.version %@"), AppConfig.appVersion))
                }
            }
            .navigationTitle(Text("tab.account"))
            .refreshable { await app.refreshMe() }
            .sheet(isPresented: $showPassword) { ChangePasswordView() }
            .sheet(isPresented: $showDelete) { DeleteAccountView() }
            .manageSubscriptionsSheet(isPresented: $manageSubscriptions)
            .onChange(of: manageSubscriptions) { _, open in
                if !open { Task { await app.refreshMe() } }
            }
            .confirmationDialog(Text("account.logoutConfirm"), isPresented: $confirmLogout, titleVisibility: .visible) {
                Button("account.logout", role: .destructive) { Task { await app.logout() } }
            }
        }
    }
}

struct PurchasesView: View {
    @State private var payments: [Payment] = []
    @State private var loading = true

    var body: some View {
        List {
            if !loading && payments.isEmpty {
                Text("purchases.empty").foregroundStyle(.secondary)
            }
            ForEach(payments) { p in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(p.pack == "weekly" ? String(localized: "purchases.weekly") : String(format: String(localized: "usage.free %lld"), p.credits)).font(.headline)
                        Spacer()
                        Text(Money.format(cents: p.amountCents, currency: p.currency)).bold()
                    }
                    Text(p.createdAt.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption).foregroundStyle(.secondary)
                    if p.refundedCents > 0 {
                        Text(String(format: String(localized: "purchases.refunded %@"), Money.format(cents: p.refundedCents, currency: p.currency)))
                            .font(.caption).foregroundStyle(.orange)
                    }
                    HStack(spacing: 16) {
                        if let r = p.receiptUrl, let url = URL(string: r) { Link("purchases.receipt", destination: url) }
                        if let i = p.invoicePdf ?? p.invoiceUrl, let url = URL(string: i) { Link("purchases.invoice", destination: url) }
                    }
                    .font(.footnote)
                }
                .padding(.vertical, 2)
            }
        }
        .overlay { if loading { ProgressView() } }
        .navigationTitle(Text("account.purchases"))
        .task {
            defer { loading = false }
            if let r: PaymentsResponse = try? await APIClient.shared.request("/api/me/payments") { payments = r.payments }
        }
    }
}

struct ChangePasswordView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var next = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                SecureField("account.currentPassword", text: $current).textContentType(.password)
                SecureField("account.newPassword", text: $next).textContentType(.newPassword)
                if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            }
            .navigationTitle(Text("account.changePassword"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("common.save") {
                        Task {
                            busy = true
                            defer { busy = false }
                            do {
                                try await app.changePassword(current: current, next: next)
                                app.show(String(localized: "account.passwordChanged"))
                                dismiss()
                            } catch let e as APIError { error = e.errorDescription } catch {}
                        }
                    }
                    .disabled(busy || current.isEmpty || next.count < 8)
                }
            }
        }
    }
}

/// Удаление аккаунта прямо в приложении — обязательное требование App Store (5.1.1(v))
struct DeleteAccountView: View {
    @EnvironmentObject private var app: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("account.deleteWarning")
                }
                Section {
                    SecureField("account.currentPassword", text: $password).textContentType(.password)
                    if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                }
                Section {
                    Button(role: .destructive) {
                        Task {
                            busy = true
                            defer { busy = false }
                            do {
                                try await app.deleteAccount(password: password)
                                dismiss()
                            } catch let e as APIError { error = e.errorDescription } catch {}
                        }
                    } label: {
                        HStack {
                            if busy { ProgressView() }
                            Text("account.deleteForever").bold()
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(busy || password.isEmpty)
                }
            }
            .navigationTitle(Text("account.delete"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("common.cancel") { dismiss() } }
            }
        }
    }
}
