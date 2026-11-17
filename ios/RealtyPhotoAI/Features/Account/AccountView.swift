import SwiftUI

struct AccountView: View {
    @EnvironmentObject private var app: AppModel
    @State private var showStore = false
    @State private var showPassword = false
    @State private var showDelete = false
    @State private var confirmLogout = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        BrandMark(size: 44)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(app.user?.email ?? "").font(.headline)
                            Text(String(format: String(localized: "account.balance %lld"), app.credits))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    Button { showStore = true } label: {
                        Label("store.buy", systemImage: "cart")
                    }
                    NavigationLink { PurchasesView() } label: {
                        Label("account.purchases", systemImage: "doc.text")
                    }
                }

                if let url = app.inviteURL {
                    Section {
                        ShareLink(item: url, message: Text(String(format: String(localized: "invite.message %@"), url.absoluteString))) {
                            Label("invite.share", systemImage: "person.badge.plus")
                        }
                        if let r = app.referrals {
                            LabeledContent("invite.registered", value: "\(r.invited)")
                            LabeledContent("invite.purchased", value: "\(r.paid)")
                        }
                    } header: {
                        Text("invite.title")
                    } footer: {
                        Text(String(format: String(localized: "invite.footer %lld %lld"),
                                    app.config?.refWelcome ?? 3, app.config?.refBonus ?? 10))
                    }
                }

                Section("account.security") {
                    Button { showPassword = true } label: { Label("account.changePassword", systemImage: "key") }
                    Button { confirmLogout = true } label: { Label("account.logout", systemImage: "rectangle.portrait.and.arrow.right") }
                }

                Section("account.info") {
                    Link(destination: AppConfig.termsURL) { Label("legal.terms", systemImage: "doc.plaintext") }
                    Link(destination: AppConfig.privacyURL) { Label("legal.privacy", systemImage: "hand.raised") }
                    Link(destination: AppConfig.legalNoticeURL) { Label("legal.notice", systemImage: "building.columns") }
                    if let support = app.config?.supportEmail, !support.isEmpty, let mail = URL(string: "mailto:\(support)") {
                        Link(destination: mail) { Label("account.support", systemImage: "envelope") }
                    }
                }

                Section {
                    Button(role: .destructive) { showDelete = true } label: {
                        Label("account.delete", systemImage: "trash")
                    }
                } footer: {
                    Text(String(format: String(localized: "account.version %@"), AppConfig.appVersion))
                }
            }
            .navigationTitle(Text("tab.account"))
            .refreshable { await app.refreshMe() }
            .sheet(isPresented: $showStore) { StoreView() }
            .sheet(isPresented: $showPassword) { ChangePasswordView() }
            .sheet(isPresented: $showDelete) { DeleteAccountView() }
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
                        Text(String(format: String(localized: "store.photos %lld"), p.credits)).font(.headline)
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
