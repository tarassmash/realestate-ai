import SwiftUI

struct HistoryView: View {
    @EnvironmentObject private var app: AppModel
    @AppStorage("markStaging") private var markStaging = true
    @State private var jobs: [Job] = []
    @State private var loading = false
    @State private var canLoadMore = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 14) {
                    if jobs.isEmpty && !loading {
                        ContentUnavailableView {
                            Label("history.empty.title", systemImage: "photo.stack")
                        } description: {
                            Text(error ?? String(localized: "history.empty.text"))
                        }
                        .padding(.top, 60)
                    }
                    ForEach(jobs) { job in
                        HistoryCard(job: job, mark: markStaging) {
                            Task { await delete(job) }
                        }
                    }
                    if canLoadMore {
                        Button("history.more") { Task { await load(reset: false) } }
                            .buttonStyle(.bordered)
                            .padding(.vertical)
                    }
                    if loading { ProgressView().padding() }
                }
                .padding()
            }
            .navigationTitle(Text("tab.history"))
            .refreshable { await load(reset: true) }
            .task { if jobs.isEmpty { await load(reset: true) } }
        }
    }

    private func load(reset: Bool) async {
        loading = true
        defer { loading = false }
        var path = "/api/jobs?limit=40"
        if !reset, let last = jobs.last {
            let iso = ISO8601DateFormatter()
            iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            path += "&before=" + (iso.string(from: last.createdAt).addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")
        }
        do {
            let response: JobsResponse = try await APIClient.shared.request(path)
            jobs = reset ? response.jobs : jobs + response.jobs
            canLoadMore = response.jobs.count == 40
            error = nil
        } catch let err as APIError {
            error = err.errorDescription
        } catch {}
    }

    private func delete(_ job: Job) async {
        let _: OKResponse? = try? await APIClient.shared.request("/api/jobs/\(job.id)", method: "DELETE")
        jobs.removeAll { $0.id == job.id }
    }
}

private struct HistoryCard: View {
    let job: Job
    let mark: Bool
    let onDelete: () -> Void

    private var preset: Preset { Preset.byId(job.preset) }
    private var beforeURL: URL? {
        if job.hasThumb == true { return APIClient.shared.thumbURL(jobId: job.id) }
        return job.resultUrl.map { APIClient.shared.resultURL($0) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if job.isDone, let remote = job.resultUrl {
                BeforeAfterView {
                    RemoteImage(url: beforeURL)
                } after: {
                    RemoteImage(url: APIClient.shared.resultURL(remote))
                }
            } else {
                RemoteImage(url: beforeURL)
                    .frame(maxWidth: .infinity)
                    .aspectRatio(3 / 2, contentMode: .fit)
                    .background(Color.black.opacity(0.85))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay {
                        if job.isRunning {
                            Label("job.processingShort", systemImage: "hourglass")
                                .padding(10).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
            }
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.name ?? "photo").font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text("\(Text(LocalizedStringKey(preset.titleKey))) · \(job.createdAt.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                    if job.isFailed {
                        Text("job.failedNotCounted").font(.caption).foregroundStyle(.orange)
                    }
                }
                Spacer()
                if job.isDone, let remote = job.resultUrl {
                    ResultActions(remote: remote, name: job.name ?? "photo", preset: preset, mark: mark)
                }
                if job.isDone || job.isFailed {
                    Menu {
                        Button(role: .destructive, action: onDelete) { Label("common.remove", systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.title3)
                    }
                    .accessibilityLabel(Text("common.more"))
                }
            }
        }
        .padding(.bottom, 4)
    }
}
