import SwiftUI
import PhotosUI

struct EditorView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var editor: EditorModel

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var showStore = false
    @State private var showPrompt = false
    @State private var loadingPhotos = false

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if app.credits <= 2 { lowCreditsBanner }
                    photosSection
                    presetsSection
                    qualitySection
                    runButton
                    resultsSection
                }
                .padding()
            }
            .background(Color.appBackground)
            .navigationTitle(Text("tab.edit"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showStore = true } label: { CreditsBadge(credits: app.credits) }
                        .accessibilityLabel(Text("store.title"))
                }
            }
            .sheet(isPresented: $showStore) { StoreView() }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    editor.add(image, name: "IMG_\(Int(Date().timeIntervalSince1970))")
                }
                .ignoresSafeArea()
            }
            .onChange(of: pickerItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await loadPicked(items) }
            }
        }
    }

    // MARK: - Разделы

    private var lowCreditsBanner: some View {
        HStack {
            Text(app.credits > 0 ? String(format: String(localized: "editor.creditsLeft %lld"), app.credits) : String(localized: "editor.noCredits"))
                .font(.subheadline.weight(.semibold))
            Spacer()
            Button("store.buy") { showStore = true }
                .buttonStyle(.borderedProminent)
                .tint(.gold)
                .foregroundStyle(.black)
                .controlSize(.small)
        }
        .padding(12)
        .background(Color.gold.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))
    }

    private var photosSection: some View {
        SectionCard(title: "editor.section.photos") {
            HStack(spacing: 10) {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: 20, matching: .images) {
                    Label("editor.pick", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { showCamera = true } label: {
                        Label("editor.camera", systemImage: "camera")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
            }
            if loadingPhotos { ProgressView().frame(maxWidth: .infinity) }
            if !editor.picked.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(editor.picked) { photo in
                            Image(uiImage: photo.image)
                                .resizable().scaledToFill()
                                .frame(width: 74, height: 74)
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                                .overlay(alignment: .topTrailing) {
                                    Button { editor.remove(photo) } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, .black.opacity(0.6))
                                    }
                                    .padding(3)
                                    .accessibilityLabel(Text("common.remove"))
                                }
                        }
                    }
                }
            } else {
                Text("editor.pickHint").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var presetsSection: some View {
        SectionCard(title: "editor.section.task") {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(Preset.all) { preset in
                    PresetTile(preset: preset, selected: editor.preset == preset) {
                        editor.preset = preset
                    }
                }
            }
            if editor.preset.id == "staging" {
                Picker(selection: $editor.style) {
                    ForEach(StagingStyle.allCases) { Text(LocalizedStringKey($0.titleKey)).tag($0) }
                } label: { Text("editor.style") }
                Picker(selection: $editor.room) {
                    ForEach(RoomType.allCases) { Text(LocalizedStringKey($0.titleKey)).tag($0) }
                } label: { Text("editor.room") }
            }
            if editor.preset.id == "custom" {
                TextField("editor.customPlaceholder", text: $editor.customText, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.roundedBorder)
            }
            if !editor.preset.upscaleOnly {
                DisclosureGroup("editor.showPrompt", isExpanded: $showPrompt) {
                    Text(editor.preset.prompt(style: editor.style, room: editor.room, custom: editor.customText))
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .font(.footnote)
            }
        }
    }

    private var qualitySection: some View {
        SectionCard(title: "editor.section.quality") {
            Picker(selection: $editor.model) {
                ForEach(AIModel.allCases) { Text(LocalizedStringKey($0.titleKey)).tag($0) }
            } label: { Text("editor.model") }
            .pickerStyle(.segmented)
            .disabled(editor.preset.upscaleOnly)

            if editor.model == .pro && !editor.preset.upscaleOnly {
                Picker(selection: $editor.resolution) {
                    ForEach(OutputResolution.allCases) { Text($0.rawValue).tag($0) }
                } label: { Text("editor.resolution") }
                .pickerStyle(.segmented)
                if editor.resolution == .r4K {
                    Text("editor.4kCost").font(.caption).foregroundStyle(.secondary)
                }
            }
            Toggle(isOn: $editor.upscale) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("editor.upscale")
                    Text("editor.upscaleHint").font(.caption).foregroundStyle(.secondary)
                }
            }
            .disabled(editor.preset.upscaleOnly)
            Toggle(isOn: $editor.markStaging) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("editor.mark")
                    Text("editor.markHint").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var runButton: some View {
        let count = editor.picked.count
        let cost = editor.totalCost
        let enough = cost <= app.credits
        return Button {
            if enough { editor.run(app: app) } else { showStore = true }
        } label: {
            Text(count == 0
                 ? String(localized: "editor.run")
                 : enough
                    ? String(format: String(localized: "editor.runCount %lld %lld"), count, cost)
                    : String(format: String(localized: "editor.needCredits %lld"), cost))
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .tint(count > 0 && !enough ? .gold : .brand)
        .foregroundStyle(count > 0 && !enough ? Color.black : Color.white)
        .controlSize(.large)
        .disabled(count == 0)
    }

    @ViewBuilder
    private var resultsSection: some View {
        if !editor.jobs.isEmpty {
            Text("editor.results").font(.title3.bold()).padding(.top, 4)
            ForEach(editor.jobs) { job in
                LocalJobCard(job: job)
            }
        }
    }

    // MARK: - Загрузка из галереи

    private func loadPicked(_ items: [PhotosPickerItem]) async {
        loadingPhotos = true
        defer { loadingPhotos = false; pickerItems = [] }
        for (i, item) in items.enumerated() {
            if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                editor.add(image, name: "photo_\(i + 1)")
            }
        }
    }
}

private struct PresetTile: View {
    let preset: Preset
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: preset.symbol).font(.title3)
                Text(LocalizedStringKey(preset.titleKey)).font(.subheadline.weight(.semibold))
                Text(LocalizedStringKey(preset.subtitleKey)).font(.caption).foregroundStyle(.secondary)
                    .lineLimit(2, reservesSpace: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(selected ? Color.brand.opacity(0.12) : Color.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(selected ? Color.brand : Color.line, lineWidth: selected ? 2 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
