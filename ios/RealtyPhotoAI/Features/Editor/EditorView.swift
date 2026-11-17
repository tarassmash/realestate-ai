import SwiftUI
import PhotosUI

/// Один экран: фото → что сделать → обработать → результат
struct EditorView: View {
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var editor: EditorModel

    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showCamera = false
    @State private var loadingPhotos = false

    private let toolColumns = [GridItem(.adaptive(minimum: 104), spacing: 8)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    photosSection
                    toolsSection
                    runButton
                    if !editor.jobs.isEmpty {
                        VStack(spacing: 24) {
                            ForEach(editor.jobs) { LocalJobCard(job: $0) }
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle(Text("tab.edit"))
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { UsageBadge() }
            }
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

    // MARK: - Фото

    private var photosSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if editor.picked.isEmpty {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: 20, matching: .images) {
                    VStack(spacing: 8) {
                        Image(systemName: "photo.badge.plus").font(.largeTitle).foregroundStyle(.secondary)
                        Text("editor.addPhotos").font(.headline)
                        Text("editor.pickHint").font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
                    .background(
                        RoundedRectangle(cornerRadius: 22)
                            .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                            .foregroundStyle(Color.line)
                    )
                }
                .buttonStyle(.plain)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(editor.picked) { photo in
                            Image(uiImage: photo.image)
                                .resizable().scaledToFill()
                                .frame(width: 76, height: 76)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                                .overlay(alignment: .topTrailing) {
                                    Button { editor.remove(photo) } label: {
                                        Image(systemName: "xmark.circle.fill")
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, .black.opacity(0.55))
                                    }
                                    .padding(3)
                                    .accessibilityLabel(Text("common.remove"))
                                }
                        }
                        PhotosPicker(selection: $pickerItems, maxSelectionCount: 20, matching: .images) {
                            Image(systemName: "plus")
                                .frame(width: 76, height: 76)
                                .background(
                                    RoundedRectangle(cornerRadius: 12)
                                        .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                                        .foregroundStyle(Color.line)
                                )
                        }
                        .accessibilityLabel(Text("editor.addPhotos"))
                    }
                }
            }
            HStack {
                if loadingPhotos { ProgressView() }
                Spacer()
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { showCamera = true } label: { Label("editor.camera", systemImage: "camera") }
                        .font(.subheadline)
                        .tint(.primary)
                }
            }
        }
    }

    // MARK: - Инструменты

    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("editor.whatToDo").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            LazyVGrid(columns: toolColumns, alignment: .leading, spacing: 8) {
                ForEach(Preset.all) { preset in
                    ToolChip(preset: preset, selected: editor.preset == preset) { editor.preset = preset }
                }
            }
            if editor.preset.id == "staging" {
                HStack {
                    Picker(selection: $editor.style) {
                        ForEach(StagingStyle.allCases) { Text(LocalizedStringKey($0.titleKey)).tag($0) }
                    } label: { Text("editor.style") }
                    Spacer()
                    Picker(selection: $editor.room) {
                        ForEach(RoomType.allCases) { Text(LocalizedStringKey($0.titleKey)).tag($0) }
                    } label: { Text("editor.room") }
                }
                .tint(.primary)
            }
            if editor.preset.id == "custom" {
                TextField("editor.customPlaceholder", text: $editor.customText, axis: .vertical)
                    .lineLimit(2...5)
                    .padding(12)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private var runButton: some View {
        let count = editor.picked.count
        return Button {
            editor.run(app: app)
        } label: {
            Text(count == 0 ? String(localized: "editor.run") : String(format: String(localized: "editor.runCount %lld"), count))
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(.borderedProminent)
        .tint(.primary)
        .foregroundStyle(Color(uiColor: .systemBackground))
        .controlSize(.large)
        .disabled(count == 0)
    }

    private func loadPicked(_ items: [PhotosPickerItem]) async {
        loadingPhotos = true
        defer { loadingPhotos = false; pickerItems = [] }
        let start = editor.picked.count
        for (i, item) in items.enumerated() {
            if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                editor.add(image, name: "photo_\(start + i + 1)")
            }
        }
    }
}

private struct ToolChip: View {
    let preset: Preset
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(LocalizedStringKey(preset.titleKey))
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .padding(.horizontal, 6)
                .background(selected ? Color.primary : Color(uiColor: .secondarySystemBackground), in: Capsule())
                .foregroundStyle(selected ? Color(uiColor: .systemBackground) : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Остаток фото: «12 / 15» по подписке, «3 бесплатно» или «Подписка»
struct UsageBadge: View {
    @EnvironmentObject private var app: AppModel

    var body: some View {
        Button {
            if !app.isSubscribed { app.showPaywall = true }
        } label: {
            Text(text)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(highlight ? Color.primary : Color(uiColor: .secondarySystemBackground), in: Capsule())
                .foregroundStyle(highlight ? Color(uiColor: .systemBackground) : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(text))
    }

    private var highlight: Bool { !app.isSubscribed && app.credits == 0 }

    private var text: String {
        if let e = app.entitlement, e.subscription.active {
            return String(format: String(localized: "usage.week %lld %lld"), e.usage.remaining, e.usage.limit)
        }
        if app.credits > 0 { return String(format: String(localized: "usage.free %lld"), app.credits) }
        return String(localized: "usage.subscribe")
    }
}
